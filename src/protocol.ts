/**
 * The SysEx messages between Companion and the Grid setup script (grid/companion-setup.lua).
 *
 * Every message is: F0 7D 43 47 <command> <payload...> F7
 * (7D = non-commercial manufacturer id, 43 47 = "CG"). Positions are sent +64
 * so modules left of / below the USB-connected one (negative x/y) fit in 7 bits.
 *
 * Grid -> Companion
 *   01 HELLO  x y hwcfgHi hwcfgLo elementCount   a module announcing itself
 *   02 EVENT  x y element kind value              kind 0=button 1=relative 2=absolute
 * Companion -> Grid
 *   10 LED    x y element r g b                   colour, 7 bits per channel
 *   11 WHO                                        every module replies with HELLO
 */

const HEADER = [0xf0, 0x7d, 0x43, 0x47] as const
const OFFSET = 64

export const CMD_HELLO = 0x01
export const CMD_EVENT = 0x02
const CMD_LED = 0x10
const CMD_WHO = 0x11

export const KIND_BUTTON = 0
export const KIND_RELATIVE = 1
export const KIND_ABSOLUTE = 2

export interface HelloMessage {
	cmd: typeof CMD_HELLO
	x: number
	y: number
	hwcfg: number
	elementCount: number
}

export interface EventMessage {
	cmd: typeof CMD_EVENT
	x: number
	y: number
	element: number
	kind: number
	value: number
}

export function parseSysex(bytes: ArrayLike<number>): HelloMessage | EventMessage | null {
	if (bytes.length < 11) return null
	for (let i = 0; i < HEADER.length; i++) if (bytes[i] !== HEADER[i]) return null

	const cmd = bytes[4]
	const x = bytes[5] - OFFSET
	const y = bytes[6] - OFFSET
	if (cmd === CMD_HELLO) {
		return { cmd, x, y, hwcfg: bytes[7] * 128 + bytes[8], elementCount: bytes[9] }
	}
	if (cmd === CMD_EVENT) {
		return { cmd, x, y, element: bytes[7], kind: bytes[8], value: bytes[9] }
	}
	return null
}

export function ledMessage(x: number, y: number, element: number, r: number, g: number, b: number): number[] {
	const c = (v: number) => Math.max(0, Math.min(127, Math.round(v) >> 1))
	return [...HEADER, CMD_LED, x + OFFSET, y + OFFSET, element & 0x7f, c(r), c(g), c(b), 0xf7]
}

export function whoMessage(): number[] {
	return [...HEADER, CMD_WHO, 0xf7]
}
