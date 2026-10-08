import type { SurfaceInputVariable, SurfaceSchemaLayoutDefinition } from '@companion-surface/base'
import { type ElementKind, moduleTypeFromHwcfg } from './grid-types.js'

export interface GridModule {
	x: number
	y: number
	hwcfg: number
	elementCount: number
}

export interface ControlInfo {
	controlId: string
	x: number
	y: number
	element: number
	kind: ElementKind
	/** For pots and faders: the surface variable carrying the 0-127 value */
	variableId?: string
}

export interface GridLayout {
	/** Changes whenever the modules or their positions change */
	signature: string
	modules: GridModule[]
	description: string
	surfaceLayout: SurfaceSchemaLayoutDefinition
	variables: SurfaceInputVariable[]
	byControl: Map<string, ControlInfo>
	byElement: Map<string, ControlInfo>
}

export function elementKey(x: number, y: number, element: number): string {
	return `${x},${y},${element}`
}

const pos = (n: number) => (n < 0 ? `n${-n}` : `${n}`)

export function signatureOf(modules: GridModule[]): string {
	return modules
		.map((m) => `${m.x},${m.y},${m.hwcfg}`)
		.sort()
		.join(';')
}

/**
 * Lay the modules out in Companion the way they sit on the desk:
 * Grid's x grows to the right and y grows upwards (north), Companion rows grow downwards.
 */
export function buildLayout(modules: GridModule[]): GridLayout {
	const types = modules.map((m) => ({ m, t: moduleTypeFromHwcfg(m.hwcfg, m.elementCount) }))
	const minX = Math.min(...modules.map((m) => m.x))
	const maxY = Math.max(...modules.map((m) => m.y))
	const cellW = Math.max(...types.map(({ t }) => t.width))
	const cellH = Math.max(...types.map(({ t }) => t.height))

	const surfaceLayout: SurfaceSchemaLayoutDefinition = {
		stylePresets: { default: { colors: 'hex' } },
		controls: {},
	}
	const variables: SurfaceInputVariable[] = []
	const byControl = new Map<string, ControlInfo>()
	const byElement = new Map<string, ControlInfo>()

	for (const { m, t } of types) {
		const baseRow = (maxY - m.y) * cellH
		const baseCol = (m.x - minX) * cellW
		const prefix = modules.length > 1 ? `${t.name} (${m.x},${m.y})` : t.name
		const counts: Partial<Record<ElementKind, number>> = {}
		for (const el of t.elements) {
			const number = (counts[el.kind] = (counts[el.kind] ?? 0) + 1)
			const row = baseRow + el.row
			const column = baseCol + el.column
			const controlId = `${row}/${column}`
			const info: ControlInfo = { controlId, x: m.x, y: m.y, element: el.index, kind: el.kind }
			if (el.kind === 'pot' || el.kind === 'fader') {
				info.variableId = `x${pos(m.x)}_y${pos(m.y)}_${el.kind}${el.index}`
				variables.push({
					id: info.variableId,
					type: 'input',
					name: `${prefix} ${el.kind} ${number} value`,
					description: '0-127',
				})
			}
			surfaceLayout.controls[controlId] = { row, column }
			byControl.set(controlId, info)
			byElement.set(elementKey(m.x, m.y, el.index), info)
		}
	}

	const names = types.map(({ t }) => t.name)
	return {
		signature: signatureOf(modules),
		modules,
		description: `Grid: ${names.join(' + ')}`,
		surfaceLayout,
		variables,
		byControl,
		byElement,
	}
}
