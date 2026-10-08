import { combineRgb } from '@companion-module/base'
import type { sqInstance } from './instance.js'
import { type Level, nrpnDataFromLevel } from './mixer/level.js'

/**
 * Pickup (soft takeover) for hardware faders driving SQ levels, e.g. an Intech
 * Grid fader through "Fader channel level to mix (from value/variable)".
 *
 *   waiting  - the fader isn't at the desk level. Nothing is sent.
 *              LED: below colour (flashing by default) or above colour.
 *   dwelling - the fader is inside the catch band around the desk level.
 *              Still nothing sent. LED: catch colour. If it stays in the band
 *              for the dwell time it latches; if it leaves first (e.g. a quick
 *              sweep through), it goes back to waiting.
 *   tracking - latched: the level follows the fader from where it is, and
 *              stays latched whatever the fader does.
 *              LED: tracking colour, brightness by fader position.
 *
 * Release: only the desk being moved elsewhere (desk surface, another
 * controller, a scene recall) breaks the latch. That's when the desk level is
 * further than the release band from everything sent in the last
 * ECHO_WINDOW_MS (so the SQ's own delayed replies don't count) and stays that
 * way for the release time. Then it goes back to waiting.
 *
 * The bands and times are action options; the LED feedback reads the values
 * the action last used for that level, so the two always agree.
 */

export const PICKUP_LED_FEEDBACK_ID = 'fader_pickup_led'

export const DEFAULT_BAND = 3
export const DEFAULT_DWELL_MS = 1000
export const DEFAULT_FLASH_MS = 250
export const DEFAULT_RELEASE_BAND = 6
export const DEFAULT_RELEASE_MS = 0
/** A release band this wide never releases */
export const NEVER_RELEASE_BAND = 127

export const LEVEL_THRESHOLD_FEEDBACK_ID = 'level_threshold_led'

/** How often LED feedbacks are re-checked (for flashing, and desk changes made elsewhere) */
const TICK_MS = 125
/** How long sent positions count as "ours" when the SQ echoes them back */
const ECHO_WINDOW_MS = 1500

type Phase = 'waiting' | 'dwelling' | 'tracking'

export interface PickupSettings {
	band: number
	dwellMs: number
	releaseBand: number
	releaseMs: number
}

const DEFAULT_SETTINGS: PickupSettings = {
	band: DEFAULT_BAND,
	dwellMs: DEFAULT_DWELL_MS,
	releaseBand: DEFAULT_RELEASE_BAND,
	releaseMs: DEFAULT_RELEASE_MS,
}

interface PickupState {
	phase: Phase
	lastIn: number | undefined
	/** Positions recently sent, to tell our own (possibly delayed) echoes from the desk being moved */
	recentSent: { position: number; at: number }[]
	/** When the desk first went outside the release band, if it has */
	outsideSince: number | undefined
	dwellTimer: NodeJS.Timeout | undefined
	settings: PickupSettings
	/** Sends a fader position to the SQ */
	apply: ((position: number) => void) | undefined
}

export type PickupLed = 'below' | 'above' | 'catch' | 'tracking'

/** The 0-127 fader position of a level on the SQ's audio taper. */
export function levelToPosition(level: Level): number {
	if (level === '-inf') return 0
	const [vc, vf] = nrpnDataFromLevel(Math.max(-89.9, Math.min(10, level)), 'AudioTaper')
	return vc + vf / 100
}

/** A number from typed text or a variable's value, falling back to `fallback` */
export function parseNumber(raw: string, fallback: number, min: number, max: number): number {
	const n = Number(raw.trim())
	if (raw.trim() === '' || Number.isNaN(n)) return fallback
	return Math.max(min, Math.min(max, n))
}

/**
 * A colour from typed text or a variable's value: '#ff0000', 'ff0000',
 * '255,0,0', or a Companion colour number. Falls back to `fallback`.
 */
export function parseColour(raw: string, fallback: number): number {
	const text = raw.trim()
	const hex = /^#?([0-9a-f]{6})$/i.exec(text)
	if (hex) return parseInt(hex[1], 16)
	const rgb = /^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/.exec(text)
	if (rgb) {
		const c = (s: string) => Math.min(255, Number(s))
		return combineRgb(c(rgb[1]), c(rgb[2]), c(rgb[3]))
	}
	if (/^\d+$/.test(text)) return Math.min(0xffffff, Number(text))
	return fallback
}

/** Scale a colour's brightness by `fraction` (0-1) */
export function scaleColour(colour: number, fraction: number): number {
	const f = Math.max(0, Math.min(1, fraction))
	return combineRgb(
		Math.round(((colour >> 16) & 0xff) * f),
		Math.round(((colour >> 8) & 0xff) * f),
		Math.round((colour & 0xff) * f),
	)
}

export class PickupManager {
	readonly #instance: sqInstance
	readonly #states = new Map<string, PickupState>()
	readonly #tick: NodeJS.Timeout

	constructor(instance: sqInstance) {
		this.#instance = instance
		this.#tick = setInterval(() => {
			for (const [key, state] of this.#states) this.#checkRelease(key, state)
			this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID, LEVEL_THRESHOLD_FEEDBACK_ID)
		}, TICK_MS)
	}

	destroy(): void {
		clearInterval(this.#tick)
		for (const state of this.#states.values()) if (state.dwellTimer) clearTimeout(state.dwellTimer)
		this.#states.clear()
	}

	/** The desk's current level for a level NRPN key "MSB.LSB", if the SQ has reported it */
	deskLevel(key: string): Level | undefined {
		const current = this.#instance.getVariableValue(`level_${key}`)
		return current === '-inf' ? '-inf' : typeof current === 'number' ? current : undefined
	}

	#state(key: string): PickupState {
		let state = this.#states.get(key)
		if (!state) {
			state = {
				phase: 'waiting',
				lastIn: undefined,
				recentSent: [],
				outsideSince: undefined,
				dwellTimer: undefined,
				settings: { ...DEFAULT_SETTINGS },
				apply: undefined,
			}
			this.#states.set(key, state)
		}
		return state
	}

	#sent(state: PickupState, position: number): void {
		const now = Date.now()
		state.recentSent.push({ position, at: now })
		// Keep the window, but always the last one sent
		while (state.recentSent.length > 1 && now - state.recentSent[0].at > ECHO_WINDOW_MS) state.recentSent.shift()
	}

	/** While latched: release only if the desk has been moved elsewhere (see the top of this file) */
	#checkRelease(key: string, state: PickupState): void {
		if (state.phase !== 'tracking') return
		const { releaseBand, releaseMs } = state.settings
		const deskLevel = this.deskLevel(key)
		if (deskLevel === undefined || releaseBand >= NEVER_RELEASE_BAND || state.recentSent.length === 0) {
			state.outsideSince = undefined
			return
		}

		const now = Date.now()
		const desk = levelToPosition(deskLevel)
		const ours = state.recentSent.filter((s, i) => i === state.recentSent.length - 1 || now - s.at <= ECHO_WINDOW_MS)
		const outside = !ours.some((s) => Math.abs(s.position - desk) <= releaseBand)
		if (!outside) {
			state.outsideSince = undefined
			return
		}

		state.outsideSince ??= now
		if (now - state.outsideSince >= releaseMs) {
			state.phase = 'waiting'
			state.recentSent = []
			state.outsideSince = undefined
			this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID)
		}
	}

	#inBand(state: PickupState, key: string, position: number): boolean {
		const deskLevel = this.deskLevel(key)
		if (deskLevel === undefined) return true
		return Math.abs(position - levelToPosition(deskLevel)) <= state.settings.band
	}

	#stopDwell(state: PickupState): void {
		if (state.dwellTimer) clearTimeout(state.dwellTimer)
		state.dwellTimer = undefined
	}

	/**
	 * A new fader position has arrived. Returns true if it should be sent to the
	 * SQ now. `apply` is kept so the level can be sent when the dwell completes.
	 */
	handle(key: string, incoming: number, settings: PickupSettings, apply: (position: number) => void): boolean {
		const state = this.#state(key)
		state.apply = apply
		state.settings = settings
		state.lastIn = incoming

		const deskLevel = this.deskLevel(key)
		if (deskLevel === undefined) {
			// Desk level not known: nothing to compare with, so just follow
			this.#stopDwell(state)
			state.phase = 'tracking'
		} else {
			this.#checkRelease(key, state)
		}

		if (state.phase !== 'tracking') {
			if (this.#inBand(state, key, incoming)) {
				if (state.phase === 'waiting') this.#startDwell(key, state)
			} else {
				// Left the band before the dwell finished: no latch
				this.#stopDwell(state)
				state.phase = 'waiting'
			}
		}

		this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID)

		if (state.phase !== 'tracking') return false
		this.#sent(state, incoming)
		return true
	}

	#startDwell(key: string, state: PickupState): void {
		this.#stopDwell(state)
		state.phase = 'dwelling'
		state.dwellTimer = setTimeout(() => {
			state.dwellTimer = undefined
			if (state.phase !== 'dwelling') return
			if (state.lastIn === undefined || !this.#inBand(state, key, state.lastIn)) {
				// The desk moved away during the dwell
				state.phase = 'waiting'
			} else {
				// Latch, and start from where the fader is
				state.phase = 'tracking'
				state.recentSent = []
				state.outsideSince = undefined
				this.#sent(state, state.lastIn)
				state.apply?.(state.lastIn)
			}
			this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID)
		}, state.settings.dwellMs)
	}

	/** Which LED state to show for a fader currently at `incoming` */
	ledState(key: string, incoming: number | undefined): { led: PickupLed; position: number } {
		const state = this.#states.get(key)
		const position = Math.max(0, Math.min(127, incoming ?? state?.lastIn ?? 0))

		if (state?.phase === 'tracking') return { led: 'tracking', position }
		if (state?.phase === 'dwelling') return { led: 'catch', position }

		const deskLevel = this.deskLevel(key)
		if (deskLevel === undefined || (incoming === undefined && state?.lastIn === undefined)) {
			return { led: 'tracking', position }
		}

		const desk = levelToPosition(deskLevel)
		const band = state?.settings.band ?? DEFAULT_BAND
		if (Math.abs(position - desk) <= band) return { led: 'catch', position }
		return { led: position > desk ? 'above' : 'below', position }
	}
}

const managers = new WeakMap<sqInstance, PickupManager>()

/** The pickup manager for a connection, created on first use */
export function pickupFor(instance: sqInstance): PickupManager {
	let manager = managers.get(instance)
	if (!manager) {
		manager = new PickupManager(instance)
		managers.set(instance, manager)
	}
	return manager
}

/** Stop a connection's pickup timers */
export function destroyPickup(instance: sqInstance): void {
	managers.get(instance)?.destroy()
	managers.delete(instance)
}
