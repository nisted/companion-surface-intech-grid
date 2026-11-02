import type { DetectionSurfaceInfo, OpenSurfaceResult, SurfaceContext, SurfacePlugin } from '@companion-surface/base'
import { Input, Output } from '@julusian/midi/lazy'
import { GridSurface } from './instance.js'
import { buildLayout, type GridModule } from './layout.js'
import { inputNames, isGridPort, outputNames, pairedOutput } from './midi-ports.js'
import { CMD_HELLO, parseSysex, whoMessage } from './protocol.js'

/** How long to listen for modules announcing themselves when opening */
const DISCOVERY_MS = 1500

export interface GridPortInfo {
	inputName: string
	outputName: string
}

function closeQuietly(...ports: Array<Input | Output>): void {
	for (const port of ports) {
		try {
			port.closePort()
			port.destroy()
		} catch {
			/* empty */
		}
	}
}

/** Ask every module on the Grid to say what it is and where it sits */
async function discoverModules(input: Input, output: Output): Promise<GridModule[]> {
	const found = new Map<string, GridModule>()
	const onSysex = (bytes: Buffer) => {
		const msg = parseSysex(bytes)
		if (msg?.cmd === CMD_HELLO) {
			found.set(`${msg.x},${msg.y}`, { x: msg.x, y: msg.y, hwcfg: msg.hwcfg, elementCount: msg.elementCount })
		}
	}
	input.on('sysex', onSysex)
	try {
		output.sendMessage(whoMessage())
		await new Promise((r) => setTimeout(r, DISCOVERY_MS / 2))
		output.sendMessage(whoMessage()) // a second ask, in case the first was missed
		await new Promise((r) => setTimeout(r, DISCOVERY_MS / 2))
	} finally {
		input.off('sysex', onSysex)
	}
	return [...found.values()]
}

const GridPlugin: SurfacePlugin<GridPortInfo> = {
	init: async (): Promise<void> => {},
	destroy: async (): Promise<void> => {},

	scanForSurfaces: async (): Promise<DetectionSurfaceInfo<GridPortInfo>[]> => {
		const inputs = inputNames()
		const outputs = outputNames()
		const found: DetectionSurfaceInfo<GridPortInfo>[] = []
		for (const inputName of inputs.filter(isGridPort)) {
			const outputName = pairedOutput(inputName, inputs, outputs)
			if (!outputName) continue
			found.push({
				deviceHandle: `grid:${inputName}`,
				surfaceId: `intech-grid:${inputName}`,
				description: `Intech Grid (${inputName})`,
				pluginInfo: { inputName, outputName },
			})
		}
		return found
	},

	openSurface: async (surfaceId: string, info: GridPortInfo, context: SurfaceContext): Promise<OpenSurfaceResult> => {
		const input = new Input()
		const output = new Output()
		try {
			const inIndex = inputNames().indexOf(info.inputName)
			const outIndex = outputNames().indexOf(info.outputName)
			if (inIndex < 0 || outIndex < 0) throw new Error('Grid MIDI port not found')
			input.ignoreTypes(false, true, true) // let SysEx through
			input.openPort(inIndex)
			output.openPort(outIndex)

			const modules = await discoverModules(input, output)
			if (modules.length === 0) {
				throw new Error(
					'No Grid modules answered. Add the Companion setup script to each module (see the module help), ' +
						'and close Grid Editor or anything else using the Grid MIDI port.',
				)
			}
			const layout = buildLayout(modules)

			return {
				surface: new GridSurface(surfaceId, context, input, output, info.inputName, info.outputName, layout),
				registerProps: {
					brightness: true,
					surfaceLayout: layout.surfaceLayout,
					transferVariables: layout.variables,
					pincodeMap: null,
					location: info.inputName,
					configFields: [
						{
							id: 'faderStep',
							type: 'number',
							label: 'Fader/pot movement per rotate step',
							description:
								'Faders and pots fire a rotate left/right on their button as they move (0-127 over full travel). ' +
								'1 = every step; higher = fewer, coarser steps.',
							default: 1,
							min: 1,
							max: 32,
						},
						{
							id: 'valueIntervalMs',
							type: 'number',
							label: 'Fader value update interval (ms)',
							description:
								'Fader/pot value variables update at most this often; the final position is always sent. ' +
								"Companion runs a variable trigger at most every 50 ms, so above 50 avoids its 'Rate limited' warning. 0 = every change.",
							default: 60,
							min: 0,
							max: 1000,
						},
						{
							id: 'crew',
							type: 'static-text',
							label: "Psst. This one's got mates. 🍹",
							value:
								"Intech Grid is part of a little crew of Companion modules: some brand new, some old favourites given a good tweak. Want to know who else is in the crew, or grab the freshest version of each one? It's all here: " +
								'https://github.com/nisted/companion-modules',
						},
					],
				},
			}
		} catch (e) {
			closeQuietly(input, output)
			throw e
		}
	},
}

export default GridPlugin
