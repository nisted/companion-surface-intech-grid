/**
 * Intech Studio Grid module types and where their controls sit.
 *
 * Element indexes and types come from Intech's grid-protocol (moduleElements),
 * hardware ids from grid-firmware (grid_protocol.h). The top nibble of the
 * hardware id identifies the module type across all hardware revisions.
 *
 * Each module is drawn as a block of cells in Companion. Positions within the
 * block follow the physical panel as closely as a grid allows.
 */

/** pot/fader: absolute 0-127. encoder/endless: relative, with push. button: press only. */
export type ElementKind = 'button' | 'encoder' | 'endless' | 'pot' | 'fader'

export interface ElementPlacement {
	index: number
	kind: ElementKind
	row: number
	column: number
}

export interface ModuleTypeInfo {
	name: string
	width: number
	height: number
	elements: ElementPlacement[]
}

function rowMajor(kind: ElementKind, count: number, firstIndex = 0, firstRow = 0, width = 4): ElementPlacement[] {
	return Array.from({ length: count }, (_, i) => ({
		index: firstIndex + i,
		kind,
		row: firstRow + Math.floor(i / width),
		column: i % width,
	}))
}

const PO16: ModuleTypeInfo = { name: 'PO16', width: 4, height: 4, elements: rowMajor('pot', 16) }
const BU16: ModuleTypeInfo = { name: 'BU16', width: 4, height: 4, elements: rowMajor('button', 16) }
const EN16: ModuleTypeInfo = { name: 'EN16', width: 4, height: 4, elements: rowMajor('encoder', 16) }

const PBF4: ModuleTypeInfo = {
	name: 'PBF4',
	width: 4,
	height: 4,
	elements: [...rowMajor('pot', 4, 0, 0), ...rowMajor('fader', 4, 4, 1), ...rowMajor('button', 4, 8, 3)],
}

const EF44: ModuleTypeInfo = {
	name: 'EF44',
	width: 4,
	height: 4,
	elements: [...rowMajor('encoder', 4, 0, 0), ...rowMajor('fader', 4, 4, 1)],
}

const PB44: ModuleTypeInfo = {
	name: 'PB44',
	width: 4,
	height: 4,
	elements: [...rowMajor('pot', 8, 0, 0), ...rowMajor('button', 8, 8, 2)],
}

const OCTV: ModuleTypeInfo = {
	name: 'OCTV',
	width: 4,
	height: 6,
	elements: [...rowMajor('encoder', 8, 0, 0), ...rowMajor('button', 13, 8, 2)],
}

// TEK2: 8 keys above two endless knobs
const TEK2: ModuleTypeInfo = {
	name: 'TEK2',
	width: 4,
	height: 4,
	elements: [
		...rowMajor('button', 8, 0, 0),
		{ index: 8, kind: 'endless', row: 2, column: 1 },
		{ index: 9, kind: 'endless', row: 2, column: 2 },
	],
}

// VSN1 / TEK1: 4 small keys under the screen, 1 endless knob, 8 keys
function vsn1(name: string): ModuleTypeInfo {
	return {
		name,
		width: 4,
		height: 4,
		elements: [
			...rowMajor('button', 8, 0, 2),
			{ index: 8, kind: 'endless', row: 1, column: 1 },
			...rowMajor('button', 4, 9, 0),
		],
	}
}

// VSN2: two screens, each with 4 small keys (index 12 and 17 are the screens), 8 keys
const VSN2: ModuleTypeInfo = {
	name: 'VSN2',
	width: 4,
	height: 4,
	elements: [...rowMajor('button', 4, 8, 0), ...rowMajor('button', 4, 13, 1), ...rowMajor('button', 8, 0, 2)],
}

const BY_NIBBLE: Record<number, ModuleTypeInfo> = {
	0x00: PO16,
	0x10: TEK2,
	0x20: EF44,
	0x30: vsn1('VSN1L'),
	0x40: PBF4,
	0x50: vsn1('VSN1R'),
	0x70: VSN2,
	0x80: BU16,
	0x90: PB44,
	0xc0: EN16,
	0xd0: OCTV,
	0xe0: vsn1('TEK1'),
}

/** The layout for a module, from its hardware id. Unknown modules get a plain block of controls. */
export function moduleTypeFromHwcfg(hwcfg: number, elementCount: number): ModuleTypeInfo {
	const known = BY_NIBBLE[hwcfg & 0xf0]
	if (known) return known
	const count = Math.max(1, Math.min(elementCount, 32))
	return {
		name: `Unknown (${hwcfg})`,
		width: 4,
		height: Math.ceil(count / 4),
		elements: rowMajor('button', count),
	}
}
