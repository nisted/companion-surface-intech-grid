import { Input, Output } from '@julusian/midi/lazy'

const GRID_PORT = /grid|intech/i

let _input: Input | undefined
let _output: Output | undefined

/** Port names, with ' 1', ' 2'... added when several ports share a name (several Grids) */
function numbered(names: string[]): string[] {
	const out: string[] = []
	for (const name of names) {
		let n = name
		let i = 0
		while (out.includes(n)) n = `${name} ${++i}`
		out.push(n)
	}
	return out
}

export function inputNames(): string[] {
	try {
		_input ??= new Input()
		const input = _input
		return numbered(Array.from({ length: input.getPortCount() }, (_, i) => input.getPortName(i)))
	} catch {
		return []
	}
}

export function outputNames(): string[] {
	try {
		_output ??= new Output()
		const output = _output
		return numbered(Array.from({ length: output.getPortCount() }, (_, i) => output.getPortName(i)))
	} catch {
		return []
	}
}

export function isGridPort(name: string): boolean {
	return GRID_PORT.test(name)
}

/**
 * The output that goes with a Grid input. Usually it has the same name; on
 * Windows/ALSA the in/out names can differ slightly, so fall back to the Grid
 * output in the same position.
 */
export function pairedOutput(inputName: string, inputs: string[], outputs: string[]): string | undefined {
	if (outputs.includes(inputName)) return inputName
	const gridOutputs = outputs.filter(isGridPort)
	const gridInputs = inputs.filter(isGridPort)
	return gridOutputs[gridInputs.indexOf(inputName)] ?? gridOutputs[0]
}
