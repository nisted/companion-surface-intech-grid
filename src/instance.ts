import {
	type CardGenerator,
	createModuleLogger,
	type ModuleLogger,
	parseColor,
	type RgbColor,
	type SurfaceContext,
	type SurfaceDrawProps,
	type SurfaceInstance,
} from '@companion-surface/base'
import type { Input, Output } from '@julusian/midi/lazy'
import { elementKey, type ControlInfo, type GridLayout } from './layout.js'
import { inputNames, outputNames } from './midi-ports.js'
import {
	CMD_EVENT,
	CMD_HELLO,
	KIND_ABSOLUTE,
	KIND_BUTTON,
	KIND_RELATIVE,
	ledMessage,
	parseSysex,
} from './protocol.js'

/** Bigger jumps than this from an encoder are a reset, not a turn */
const MAX_ENCODER_STEP = 16

export class GridSurface implements SurfaceInstance {
	readonly #logger: ModuleLogger
	readonly #surfaceId: string
	readonly #context: SurfaceContext
	readonly #input: Input
	readonly #output: Output
	readonly #inputName: string
	readonly #outputName: string
	readonly #layout: GridLayout

	readonly #colours = new Map<string, RgbColor>()
	readonly #lastAbsolute = new Map<string, number>()
	readonly #carry = new Map<string, number>()
	#brightness = 100
	#faderStep = 1
	#checkTimer: NodeJS.Timeout | undefined

	readonly #onSysex = (bytes: Buffer) => this.#handleSysex(bytes)

	get surfaceId(): string {
		return this.#surfaceId
	}
	get productName(): string {
		return this.#layout.description
	}

	constructor(
		surfaceId: string,
		context: SurfaceContext,
		input: Input,
		output: Output,
		inputName: string,
		outputName: string,
		layout: GridLayout,
	) {
		this.#logger = createModuleLogger(`Grid/${surfaceId}`)
		this.#surfaceId = surfaceId
		this.#context = context
		this.#input = input
		this.#output = output
		this.#inputName = inputName
		this.#outputName = outputName
		this.#layout = layout
	}

	async init(): Promise<void> {
		this.#input.on('sysex', this.#onSysex)
		this.#checkTimer = setInterval(() => this.#checkPorts(), 2000)
		await this.blank()
	}

	async close(): Promise<void> {
		if (this.#checkTimer) clearInterval(this.#checkTimer)
		this.#input.off('sysex', this.#onSysex)
		await this.blank().catch(() => null)
		for (const port of [this.#input, this.#output]) {
			try {
				port.closePort()
				port.destroy()
			} catch {
				/* already gone */
			}
		}
	}

	async updateConfig(config: Record<string, any>): Promise<void> {
		const step = Number(config?.faderStep)
		this.#faderStep = Number.isFinite(step) && step >= 1 ? Math.round(step) : 1
	}

	async ready(): Promise<void> {}

	async setBrightness(percent: number): Promise<void> {
		this.#brightness = Math.max(0, Math.min(100, percent))
		for (const controlId of this.#layout.byControl.keys()) this.#writeLed(controlId)
	}

	async blank(): Promise<void> {
		this.#colours.clear()
		for (const controlId of this.#layout.byControl.keys()) this.#writeLed(controlId)
	}

	async draw(_signal: AbortSignal, drawProps: SurfaceDrawProps): Promise<void> {
		this.#colours.set(drawProps.controlId, parseColor(drawProps.color))
		this.#writeLed(drawProps.controlId)
	}

	async showStatus(_signal: AbortSignal, _cards: CardGenerator, _message: string): Promise<void> {
		// No screen to show it on
	}

	#writeLed(controlId: string): void {
		const info = this.#layout.byControl.get(controlId)
		if (!info || !this.#output.isPortOpen()) return
		const c = this.#colours.get(controlId) ?? { r: 0, g: 0, b: 0 }
		const s = this.#brightness / 100
		try {
			this.#output.sendMessage(ledMessage(info.x, info.y, info.element, c.r * s, c.g * s, c.b * s))
		} catch (e) {
			this.#logger.warn(`LED write failed: ${e}`)
		}
	}

	#handleSysex(bytes: Buffer): void {
		const msg = parseSysex(bytes)
		if (!msg) return

		if (msg.cmd === CMD_HELLO) {
			const known = this.#layout.modules.some((m) => m.x === msg.x && m.y === msg.y && m.hwcfg === msg.hwcfg)
			if (!known) {
				// A module was added or moved: reconnect so Companion picks up the new layout
				this.#context.disconnect(new Error('Grid modules changed'))
				return
			}
			// A module restarted and lost its colours
			for (const info of this.#layout.byControl.values()) {
				if (info.x === msg.x && info.y === msg.y) this.#writeLed(info.controlId)
			}
			return
		}

		if (msg.cmd !== CMD_EVENT) return
		const info = this.#layout.byElement.get(elementKey(msg.x, msg.y, msg.element))
		if (!info) return

		switch (msg.kind) {
			case KIND_BUTTON:
				if (msg.value > 0) this.#context.keyDownById(info.controlId)
				else this.#context.keyUpById(info.controlId)
				break
			case KIND_RELATIVE: {
				const delta = msg.value - 64
				if (Math.abs(delta) <= MAX_ENCODER_STEP) this.#rotate(info, delta)
				break
			}
			case KIND_ABSOLUTE:
				this.#absolute(info, msg.value)
				break
		}
	}

	#absolute(info: ControlInfo, value: number): void {
		if (info.variableId) this.#context.sendVariableValue(info.variableId, value)

		const last = this.#lastAbsolute.get(info.controlId)
		this.#lastAbsolute.set(info.controlId, value)
		if (last === undefined) return // first reading, nothing to compare with

		// faders turn into rotate steps, so they follow the page like encoders do
		const total = (this.#carry.get(info.controlId) ?? 0) + (value - last)
		const steps = Math.trunc(total / this.#faderStep)
		this.#carry.set(info.controlId, total - steps * this.#faderStep)
		this.#rotate(info, steps)
	}

	#rotate(info: ControlInfo, steps: number): void {
		for (let i = 0; i < Math.abs(steps); i++) {
			if (steps > 0) this.#context.rotateRightById(info.controlId)
			else this.#context.rotateLeftById(info.controlId)
		}
	}

	#checkPorts(): void {
		let reason: string | null = null
		if (!this.#input.isPortOpen() || !this.#output.isPortOpen()) reason = 'MIDI port closed'
		else if (!inputNames().includes(this.#inputName)) reason = 'Grid unplugged'
		else if (!outputNames().includes(this.#outputName)) reason = 'Grid unplugged'
		if (!reason) return
		if (this.#checkTimer) clearInterval(this.#checkTimer)
		this.#checkTimer = undefined
		this.#context.disconnect(new Error(reason))
	}
}
