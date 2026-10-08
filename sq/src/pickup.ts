import { combineRgb } from '@companion-module/base'
import type { sqInstance } from './instance.js'
import { type Level, nrpnDataFromLevel } from './mixer/level.js'

/**
 * Pickup (soft takeover) for hardware faders driving SQ levels, e.g. an Intech
 * Grid fader through "Fader channel level to mix (from value/variable)".
 *
 *   waiting  - the fader hasn't reached the desk level yet. Nothing is sent.
 *              LED: flashing red below the desk level, solid red above it.
 *   catching - the fader reached or swept past the desk level. Held for
 *              CATCH_MS with nothing sent. LED: green.
 *   tracking - after the hold, the level jumps to wherever the fader now is
 *              and follows it. LED: white, from off at 0 to full at 127.
 *
 * If the desk level is changed elsewhere while tracking, it goes back to
 * waiting.
 */

export const PICKUP_LED_FEEDBACK_ID = 'fader_pickup_led'

const CATCH_MS = 1000
const BLINK_MS = 250
/** How close (in 0-127 position steps) counts as "at" the desk level */
const AT_DESK = 1.5
/** How far the desk can be from anything we recently sent before we assume someone else moved it */
const DESK_MOVED = 3
const RECENT_SENT_COUNT = 8

type Phase = 'waiting' | 'catching' | 'tracking'

interface PickupState {
	phase: Phase
	/** The previous incoming position, to spot a sweep across the desk level */
	lastIn: number | undefined
	/** Positions recently sent, to tell our own (possibly delayed) echoes from the desk being moved */
	recentSent: number[]
	catchTimer: NodeJS.Timeout | undefined
	/** Sends a fader position to the SQ */
	apply: ((position: number) => void) | undefined
}

/** The 0-127 fader position of a level on the SQ's audio taper. */
export function levelToPosition(level: Level): number {
	if (level === '-inf') return 0
	const [vc, vf] = nrpnDataFromLevel(Math.max(-89.9, Math.min(10, level)), 'AudioTaper')
	return vc + vf / 100
}

const RED = combineRgb(255, 0, 0)
const GREEN = combineRgb(0, 255, 0)
const BLACK = combineRgb(0, 0, 0)

export class PickupManager {
	readonly #instance: sqInstance
	readonly #states = new Map<string, PickupState>()
	readonly #blinkTimer: NodeJS.Timeout

	constructor(instance: sqInstance) {
		this.#instance = instance
		// Keeps the flashing going and picks up desk level changes made elsewhere
		this.#blinkTimer = setInterval(() => this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID), BLINK_MS)
	}

	destroy(): void {
		clearInterval(this.#blinkTimer)
		for (const state of this.#states.values()) if (state.catchTimer) clearTimeout(state.catchTimer)
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
			state = { phase: 'waiting', lastIn: undefined, recentSent: [], catchTimer: undefined, apply: undefined }
			this.#states.set(key, state)
		}
		return state
	}

	#sent(state: PickupState, position: number): void {
		state.recentSent.push(position)
		if (state.recentSent.length > RECENT_SENT_COUNT) state.recentSent.shift()
	}

	/**
	 * A new fader position has arrived. Returns true if it should be sent to the
	 * SQ now. `apply` is kept so the level can be sent when the catch hold ends.
	 */
	handle(key: string, incoming: number, apply: (position: number) => void): boolean {
		const state = this.#state(key)
		state.apply = apply
		const previous = state.lastIn
		state.lastIn = incoming

		const deskLevel = this.deskLevel(key)
		if (deskLevel === undefined) {
			// Desk level not known: nothing to compare with, so just follow
			state.phase = 'tracking'
		} else {
			const desk = levelToPosition(deskLevel)

			if (state.phase === 'tracking') {
				const ours = [...state.recentSent, incoming]
				if (!ours.some((p) => Math.abs(p - desk) <= DESK_MOVED)) {
					// Moved elsewhere (desk surface, another controller, a scene recall)
					state.phase = 'waiting'
					state.recentSent = []
				}
			}

			if (state.phase === 'waiting') {
				const atDesk = Math.abs(incoming - desk) <= AT_DESK
				const crossed = previous !== undefined && Math.sign(previous - desk) !== Math.sign(incoming - desk)
				if (atDesk || crossed) this.#startCatch(key, state)
			}
		}

		this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID)

		if (state.phase !== 'tracking') return false
		this.#sent(state, incoming)
		return true
	}

	#startCatch(key: string, state: PickupState): void {
		state.phase = 'catching'
		if (state.catchTimer) clearTimeout(state.catchTimer)
		state.catchTimer = setTimeout(() => {
			state.catchTimer = undefined
			if (state.phase !== 'catching') return
			state.phase = 'tracking'
			state.recentSent = []
			// Jump to wherever the fader is now
			if (state.lastIn !== undefined && state.apply) {
				this.#sent(state, state.lastIn)
				state.apply(state.lastIn)
			}
			this.#instance.checkFeedbacks(PICKUP_LED_FEEDBACK_ID)
		}, CATCH_MS)
		this.#states.set(key, state)
	}

	/** The LED colour for a fader currently at `incoming` */
	ledColour(key: string, incoming: number | undefined): number {
		const state = this.#states.get(key)
		const position = incoming ?? state?.lastIn
		const white = () => {
			const v = Math.round((Math.max(0, Math.min(127, position ?? 0)) / 127) * 255)
			return combineRgb(v, v, v)
		}

		if (state?.phase === 'catching') return GREEN
		if (state?.phase === 'tracking') return white()

		const deskLevel = this.deskLevel(key)
		if (deskLevel === undefined || position === undefined) return white()

		const desk = levelToPosition(deskLevel)
		if (Math.abs(position - desk) <= AT_DESK) return GREEN
		if (position > desk) return RED
		const blinkOn = Math.floor(Date.now() / BLINK_MS) % 2 === 0
		return blinkOn ? RED : BLACK
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
