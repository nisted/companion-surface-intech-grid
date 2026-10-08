import type {
	CompanionInputFieldDropdown,
	CompanionInputFieldTextInput,
	CompanionMigrationAction,
	CompanionOptionValues,
} from '@companion-module/base'
import type { ActionDefinitions } from './actionid.js'
import type { Choices } from '../choices.js'
import { getFadeParameters } from './fading.js'
import type { sqInstance } from '../instance.js'
import { LR, tryUpgradeMixOrLRArrayEncoding, tryUpgradeMixOrLROptionEncoding } from '../mixer/lr.js'
import type { Mixer } from '../mixer/mixer.js'
import type { Model } from '../mixer/model.js'
import type { NRPN } from '../mixer/nrpn/nrpn.js'
import { type Level, levelFromNRPNData } from '../mixer/level.js'
import {
	DEFAULT_BAND,
	DEFAULT_DWELL_MS,
	DEFAULT_RELEASE_BAND,
	DEFAULT_RELEASE_MS,
	NEVER_RELEASE_BAND,
	parseNumber,
	pickupFor,
} from '../pickup.js'
import { splitNRPN } from '../mixer/nrpn/nrpn.js'
import {
	LevelNRPNCalculator,
	type SinkForMixAndLRInSinkForNRPN,
	type SourceForSourceInMixAndLRForNRPN,
	type SourceSinkForNRPN,
} from '../mixer/nrpn/source-to-sink.js'
import { toMixOrLR, toSourceOrSink } from './to-source-or-sink.js'

/**
 * Action IDs for all actions that alter the level of a mixer source in a mixer
 * sink.
 */
export enum LevelActionId {
	InputChannelLevelInMixOrLR = 'chlev_to_mix',
	GroupLevelInMixOrLR = 'grplev_to_mix',
	FXReturnLevelInMixOrLR = 'fxrlev_to_mix',
	FXReturnLevelInGroup = 'fxrlev_to_grp',
	InputChannelLevelInFXSend = 'chlev_to_fxs',
	GroupLevelInFXSend = 'grplev_to_fxs',
	FXReturnLevelInFXSend = 'fxrlev_to_fxs',
	MixOrLRLevelInMatrix = 'mixlev_to_mtx',
	GroupLevelInMatrix = 'grplev_to_mtx',
	InputChannelLevelInMixOrLRFromValue = 'chlev_to_mix_value',
}

/**
 * Turn a value typed in (or produced by a variable) into a level.
 *
 * 'position' takes a fader position 0-127 (such as an Intech Grid fader value)
 * and gives the level at that position on the SQ's own fader, using the SQ's
 * audio taper, so a hardware fader and the SQ fader line up.
 */
function valueToLevel(raw: string, valueType: unknown): Level | null {
	const text = raw.trim().toLowerCase()
	if (valueType === 'db') {
		if (text === '-inf') return '-inf'
		const db = Number(text)
		if (text === '' || Number.isNaN(db)) return null
		return db <= -90 ? '-inf' : db > 10 ? 10 : db
	}

	const n = Number(text)
	if (text === '' || Number.isNaN(n)) return null
	const position = Math.max(0, Math.min(127, Math.round(n)))
	if (position === 0) return '-inf'
	return levelFromNRPNData(position, 0, 'AudioTaper')
}


const ObsoleteFXReturnLevelinFXSendId = 'fxslev_to_fxs'

/**
 * The action id for setting the level of an FX return in an FX send used to
 * contain a typo: it claimed to be an "FX Send to FX Send" level.  Update the
 * id to fix the typo.
 *
 * @param action
 *   The action to potentially upgrade.
 * @returns
 *   True iff the action was an FX Return to FX Send level action and its action
 *   ID was corrected.
 */
export function tryFixFXRLevelInFXSIdTypo(action: CompanionMigrationAction): boolean {
	if (action.actionId !== ObsoleteFXReturnLevelinFXSendId) {
		return false
	}

	action.actionId = LevelActionId.FXReturnLevelInFXSend
	return true
}

const LevelSetSourceOptionId = 'input'
const LevelSetSinkOptionId = 'assign'

/**
 * The LR mix used to be identified using the number `99` in options.  This
 * function attempts to upgrade assign actions (*only* level actions: other
 * action types are upgraded by similar functions in their action-defining
 * files) that identify the LR mix in this fashion to use the constant string
 * `'lr'`, i.e. `LR`.
 *
 * @param action
 *   An action to potentially ugprade.
 * @returns
 *   True iff the action was a level action containing an identification of the
 *   LR mix that was rewritten to use `'lr'`.
 */
export function tryUpgradeLevelMixOrLREncoding(action: CompanionMigrationAction): boolean {
	switch (action.actionId) {
		case LevelActionId.InputChannelLevelInMixOrLR as string:
		case LevelActionId.GroupLevelInMixOrLR as string:
		case LevelActionId.FXReturnLevelInMixOrLR as string:
			return tryUpgradeMixOrLRArrayEncoding(action, LevelSetSinkOptionId)
		case LevelActionId.MixOrLRLevelInMatrix as string:
			return tryUpgradeMixOrLROptionEncoding(action, LevelSetSourceOptionId)
		default:
			return false
	}
}

type LevelType = {
	source: number
	sink: number
	sourceSinkType: SourceSinkForNRPN<'level'>
	nrpn: NRPN<'level'>
}

type SourceToMixOrLR = [SourceForSourceInMixAndLRForNRPN<'level'>, 'mix-or-lr']
type MixOrLRToSink = ['mix-or-lr', SinkForMixAndLRInSinkForNRPN<'level'>]

export function getLevelType(
	instance: sqInstance,
	model: Model,
	options: CompanionOptionValues,
	srcSnkType: SourceSinkForNRPN<'level'>,
): LevelType | null
export function getLevelType(
	instance: sqInstance,
	model: Model,
	options: CompanionOptionValues,
	srcSnkType: SourceToMixOrLR,
): LevelType | null
export function getLevelType(
	instance: sqInstance,
	model: Model,
	options: CompanionOptionValues,
	srcSnkType: MixOrLRToSink,
): LevelType | null
export function getLevelType(
	instance: sqInstance,
	model: Model,
	options: CompanionOptionValues,
	srcSnkType: SourceSinkForNRPN<'level'> | SourceToMixOrLR | MixOrLRToSink,
): LevelType | null {
	let sourceSinkType: SourceSinkForNRPN<'level'>
	let source, sink
	if (srcSnkType[0] === 'mix-or-lr') {
		const src = toMixOrLR(instance, model, options[LevelSetSourceOptionId])
		if (src === null) {
			return null
		}

		sink = toSourceOrSink(instance, model, options[LevelSetSinkOptionId], srcSnkType[1])
		if (sink === null) {
			return null
		}

		sourceSinkType = [src === LR ? 'lr' : 'mix', srcSnkType[1]]
		source = src === LR ? 0 : src
	} else if (srcSnkType[1] === 'mix-or-lr') {
		source = toSourceOrSink(instance, model, options[LevelSetSourceOptionId], srcSnkType[0])
		if (source === null) {
			return null
		}

		const snk = toMixOrLR(instance, model, options[LevelSetSinkOptionId])
		if (snk === null) {
			return null
		}

		sourceSinkType = [srcSnkType[0], snk === LR ? 'lr' : 'mix']
		sink = snk === LR ? 0 : snk
	} else {
		source = toSourceOrSink(instance, model, options[LevelSetSourceOptionId], srcSnkType[0])
		if (source === null) {
			return null
		}

		sink = toSourceOrSink(instance, model, options[LevelSetSinkOptionId], srcSnkType[1])
		if (sink === null) {
			return null
		}

		sourceSinkType = srcSnkType
	}

	const calc = LevelNRPNCalculator.get(model, sourceSinkType)

	return {
		source,
		sink,
		sourceSinkType,
		nrpn: calc.calculate(source, sink),
	}
}

export function sourceSinkOptions(
	sourceLabel: string,
	sourceChoices: keyof Choices,
	sinkLabel: string,
	sinkChoices: keyof Choices,
	choices: Choices,
): [CompanionInputFieldDropdown, CompanionInputFieldDropdown] {
	return [
		{
			type: 'dropdown',
			label: sourceLabel,
			id: LevelSetSourceOptionId,
			default: 0,
			choices: choices[sourceChoices],
			minChoicesForSearch: 0,
		},
		{
			type: 'dropdown',
			label: sinkLabel,
			id: LevelSetSinkOptionId,
			default: 0,
			choices: choices[sinkChoices],
			minChoicesForSearch: 0,
		},
	]
}

const ChannelOptionId = 'channel'
const MixOptionId = 'mix'

const CHANNEL_TIP = 'Input channel number as on the desk, e.g. 16 (CH 16 also works). Can be a variable, e.g. $(custom:grid_ch).'
const MIX_TIP = 'LR for the main mix, or an aux/mix number, e.g. 3 (Mix 3 also works). Can be a variable, e.g. $(custom:grid_mix).'

/**
 * Input channel and mix as text boxes, so each can be typed or come from a
 * variable (dropdowns can't take variables in this module API).
 */
export function channelMixOptions(): CompanionInputFieldTextInput[] {
	return [
		{ type: 'textinput', label: 'Input channel', id: ChannelOptionId, default: '1', useVariables: true, tooltip: CHANNEL_TIP },
		{ type: 'textinput', label: 'Mix', id: MixOptionId, default: 'LR', useVariables: true, tooltip: MIX_TIP },
	]
}

const reportedBad = new Set<string>()

/** Options with the zero-based channel/mix the level code expects, from the text boxes */
export async function resolveChannelMix(
	instance: sqInstance,
	options: CompanionOptionValues,
	context: { parseVariablesInString(text: string): Promise<string> },
): Promise<CompanionOptionValues | null> {
	const channelText = (await context.parseVariablesInString(String(options[ChannelOptionId] ?? ''))).trim()
	const mixText = (await context.parseVariablesInString(String(options[MixOptionId] ?? ''))).trim()
	const channel = Number(channelText.replace(/^ch\s*/i, ''))
	const mixNumber = Number(mixText.replace(/^(mix|aux)\s*/i, ''))
	const isLR = /^lr$/i.test(mixText)
	if (!(Number.isInteger(channel) && channel >= 1) || !(isLR || (Number.isInteger(mixNumber) && mixNumber >= 1))) {
		const msg = `Input channel "${channelText}" / mix "${mixText}" not understood (channel: a number like 16; mix: LR or a number)`
		if (!reportedBad.has(msg)) {
			reportedBad.add(msg)
			instance.log('warn', msg)
		}
		return null
	}
	return { ...options, [LevelSetSourceOptionId]: channel - 1, [LevelSetSinkOptionId]: isLR ? LR : mixNumber - 1 }
}

const GridLevelActionIds: readonly string[] = ['chlev_to_mix_value']
export const GridLevelFeedbackIds: readonly string[] = ['fader_pickup_led', 'level_threshold_led']

/**
 * Upgrade: the Grid action/feedbacks used channel/mix dropdowns (zero-based
 * 'input'/'assign'), briefly with a "from text/variables" tick box. Move them
 * to the 'channel'/'mix' text boxes.
 */
export function tryMoveGridChannelMixToText(item: { options: CompanionOptionValues }): boolean {
	const o = item.options
	if (o[ChannelOptionId] !== undefined) return false
	if (o.useVars === true && o.inputVar !== undefined) {
		o[ChannelOptionId] = String(o.inputVar)
		o[MixOptionId] = String(o.mixVar ?? 'LR')
	} else {
		const input = Number(o[LevelSetSourceOptionId] ?? 0)
		const assign = o[LevelSetSinkOptionId]
		o[ChannelOptionId] = String((Number.isInteger(input) ? input : 0) + 1)
		o[MixOptionId] = assign === LR || assign === undefined ? 'LR' : String(Number(assign) + 1)
	}
	for (const k of ['useVars', 'inputVar', 'mixVar', LevelSetSourceOptionId, LevelSetSinkOptionId]) delete o[k]
	return true
}

export function tryUpgradeGridLevelAction(action: CompanionMigrationAction): boolean {
	return GridLevelActionIds.includes(action.actionId) && tryMoveGridChannelMixToText(action)
}

/**
 * Generate action definitions for setting the levels of sources in sinks: input
 * channels in mixes, mixes in LR, and so on and so forth.
 *
 * @param instance
 *   The instance for which actions are being generated.
 * @param mixer
 *   The mixer object to use when executing the actions.
 * @param choices
 *   Option choices for use in the actions.
 * @param levelOption
 *   An action option specifying all levels a source in a sink can be set to.
 * @param fadingOption
 *   An action option specifying various fade times over which the set to level
 *   should take place.
 * @returns
 *   The set of all level action definitions.
 */
export function levelActions(
	instance: sqInstance,
	mixer: Mixer,
	choices: Choices,
	levelOption: CompanionInputFieldDropdown,
	fadingOption: CompanionInputFieldDropdown,
): ActionDefinitions<LevelActionId> {
	const model = mixer.model

	return {
		[LevelActionId.InputChannelLevelInMixOrLRFromValue]: {
			name: 'Fader channel level to mix (from value/variable)',
			description: 'Sets the level from a number or variable, e.g. an Intech Grid fader value',
			options: [
				...channelMixOptions(),
				{
					type: 'textinput',
					label: 'Value',
					id: 'value',
					default: '',
					useVariables: true,
				},
				{
					type: 'dropdown',
					label: 'Value is',
					id: 'valueType',
					default: 'position',
					choices: [
						{ id: 'position', label: 'Fader position 0-127 (e.g. Grid fader)' },
						{ id: 'db', label: 'Level in dB (-inf, or -90 to +10)' },
					],
				},
				{
					type: 'checkbox',
					label: 'Pickup mode',
					id: 'pickup',
					default: false,
					tooltip:
						"Don't change the level until the fader sits within the catch band of the desk's current level for the dwell time, then stay latched until the desk is moved elsewhere. A quick sweep through doesn't latch. Show the state with the 'Grid fader pickup LED' feedback. Fader positions only.",
					isVisible: (options) => options.valueType !== 'db',
				},
				{
					type: 'textinput',
					label: 'Catch band (± fader steps, of 127)',
					id: 'pickupBand',
					default: String(DEFAULT_BAND),
					useVariables: true,
					tooltip: 'How close to the desk level counts as caught. A number, or a variable.',
					isVisible: (options) => options.valueType !== 'db' && options.pickup === true,
				},
				{
					type: 'textinput',
					label: 'Dwell time (ms)',
					id: 'pickupDwell',
					default: String(DEFAULT_DWELL_MS),
					useVariables: true,
					tooltip: 'How long the fader must stay in the catch band before it takes over. A number, or a variable.',
					isVisible: (options) => options.valueType !== 'db' && options.pickup === true,
				},
				{
					type: 'textinput',
					label: 'Release band (± fader steps, of 127)',
					id: 'pickupReleaseBand',
					default: String(DEFAULT_RELEASE_BAND),
					useVariables: true,
					tooltip: `Once latched, only a desk-side move bigger than this lets go (the fader itself never does). ${NEVER_RELEASE_BAND} = never let go. A number, or a variable.`,
					isVisible: (options) => options.valueType !== 'db' && options.pickup === true,
				},
				{
					type: 'textinput',
					label: 'Release time (ms)',
					id: 'pickupReleaseTime',
					default: String(DEFAULT_RELEASE_MS),
					useVariables: true,
					tooltip: 'How long the desk must stay beyond the release band before it lets go. 0 = straight away. A number, or a variable.',
					isVisible: (options) => options.valueType !== 'db' && options.pickup === true,
				},
			],
			callback: async ({ options }, context) => {
				const resolved = await resolveChannelMix(instance, options, context)
				if (resolved === null) return
				const levelType = getLevelType(instance, model, resolved, ['inputChannel', 'mix-or-lr'])
				if (levelType === null) {
					return
				}
				const {
					source: inputChannel,
					sink: mix,
					sourceSinkType: { 1: sinkType },
				} = levelType

				const raw = await context.parseVariablesInString(String(options.value ?? ''))
				const level = valueToLevel(raw, options.valueType)
				if (level === null) {
					instance.log('warn', `Fader value "${raw}" isn't a number, ignoring`)
					return
				}

				const send = (to: Level) => {
					if (sinkType === 'lr') {
						mixer.fadeInputChannelLevelInLR(inputChannel, to, to, 0)
					} else {
						mixer.fadeInputChannelLevelInMix(inputChannel, mix, to, to, 0)
					}
				}

				if (options.pickup === true && options.valueType !== 'db') {
					const { MSB, LSB } = splitNRPN(levelType.nrpn)
					const incoming = Math.max(0, Math.min(127, Number(raw.trim())))
					const sendPosition = (position: number) => {
						const to = valueToLevel(String(position), 'position')
						if (to !== null) send(to)
					}
					const band = parseNumber(
						await context.parseVariablesInString(String(options.pickupBand ?? '')),
						DEFAULT_BAND,
						0,
						64,
					)
					const dwellMs = parseNumber(
						await context.parseVariablesInString(String(options.pickupDwell ?? '')),
						DEFAULT_DWELL_MS,
						0,
						10000,
					)
					const releaseBand = parseNumber(
						await context.parseVariablesInString(String(options.pickupReleaseBand ?? '')),
						DEFAULT_RELEASE_BAND,
						0,
						NEVER_RELEASE_BAND,
					)
					const releaseMs = parseNumber(
						await context.parseVariablesInString(String(options.pickupReleaseTime ?? '')),
						DEFAULT_RELEASE_MS,
						0,
						60000,
					)
					const settings = { band, dwellMs, releaseBand, releaseMs }
					if (!pickupFor(instance).handle(`${MSB}.${LSB}`, incoming, settings, sendPosition)) return
				}

				send(level)
			},
		},
		[LevelActionId.InputChannelLevelInMixOrLR]: {
			name: 'Fader channel level to mix',
			options: [
				...sourceSinkOptions('Input channel', 'inputChannels', 'Mix', 'mixesAndLR', choices),
				levelOption,
				fadingOption,
			],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['inputChannel', 'mix-or-lr'])
				if (levelType === null) {
					return
				}
				const {
					source: inputChannel,
					sink: mix,
					sourceSinkType: { 1: sinkType },
					nrpn,
				} = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				if (sinkType === 'lr') {
					mixer.fadeInputChannelLevelInLR(inputChannel, start, end, fadeTimeMs)
				} else {
					mixer.fadeInputChannelLevelInMix(inputChannel, mix, start, end, fadeTimeMs)
				}
			},
		},
		[LevelActionId.GroupLevelInMixOrLR]: {
			name: 'Fader group level to mix',
			options: [...sourceSinkOptions('Group', 'groups', 'Mix', 'mixesAndLR', choices), levelOption, fadingOption],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['group', 'mix-or-lr'])
				if (levelType === null) {
					return
				}
				const {
					source: group,
					sink: mix,
					sourceSinkType: { 1: sinkType },
					nrpn,
				} = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				if (sinkType === 'lr') {
					mixer.fadeGroupLevelInLR(group, start, end, fadeTimeMs)
				} else {
					mixer.fadeGroupLevelInMix(group, mix, start, end, fadeTimeMs)
				}
			},
		},
		[LevelActionId.FXReturnLevelInMixOrLR]: {
			name: 'Fader FX return level to mix',
			options: [
				...sourceSinkOptions('FX return', 'fxReturns', 'Mix', 'mixesAndLR', choices),
				levelOption,
				fadingOption,
			],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['fxReturn', 'mix-or-lr'])
				if (levelType === null) {
					return
				}
				const {
					source: fxReturn,
					sink: mix,
					sourceSinkType: { 1: sinkType },
					nrpn,
				} = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				if (sinkType === 'lr') {
					mixer.fadeFXReturnLevelInLR(fxReturn, start, end, fadeTimeMs)
				} else {
					mixer.fadeFXReturnLevelInMix(fxReturn, mix, start, end, fadeTimeMs)
				}
			},
		},
		[LevelActionId.FXReturnLevelInGroup]: {
			name: 'Fader FX return level to group',
			options: [
				{
					type: 'static-text',
					id: 'invalid',
					label: 'Invalid operation!',
					value: 'FX returns can only be assigned to groups, not have their levels set in them.',
				},
			],
			callback: async () => {
				instance.log('warn', 'The "Fader FX return level to group" operation is invalid.  Don\'t use this action!')
			},
		},
		[LevelActionId.InputChannelLevelInFXSend]: {
			name: 'Fader channel level to FX send',
			options: [
				...sourceSinkOptions('Input channel', 'inputChannels', 'FX Send', 'fxSends', choices),
				levelOption,
				fadingOption,
			],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['inputChannel', 'fxSend'])
				if (levelType === null) {
					return
				}
				const { source: inputChannel, sink: fxSend, nrpn } = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				mixer.fadeInputChannelLevelInFXSend(inputChannel, fxSend, start, end, fadeTimeMs)
			},
		},
		[LevelActionId.GroupLevelInFXSend]: {
			name: 'Fader group level to FX send',
			options: [...sourceSinkOptions('Group', 'groups', 'FX Send', 'fxSends', choices), levelOption, fadingOption],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['group', 'fxSend'])
				if (levelType === null) {
					return
				}
				const { source: group, sink: fxSend, nrpn } = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				mixer.fadeGroupLevelInFXSend(group, fxSend, start, end, fadeTimeMs)
			},
		},
		[LevelActionId.FXReturnLevelInFXSend]: {
			name: 'Fader FX return level to FX send',
			options: [
				...sourceSinkOptions('FX return', 'fxReturns', 'FX Send', 'fxSends', choices),
				levelOption,
				fadingOption,
			],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['fxReturn', 'fxSend'])
				if (levelType === null) {
					return
				}
				const { source: fxReturn, sink: fxSend, nrpn } = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				mixer.fadeFXReturnLevelInFXSend(fxReturn, fxSend, start, end, fadeTimeMs)
			},
		},
		[LevelActionId.MixOrLRLevelInMatrix]: {
			name: 'Fader mix level to matrix',
			options: [...sourceSinkOptions('Mix', 'mixesAndLR', 'Matrix', 'matrixes', choices), levelOption, fadingOption],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['mix-or-lr', 'matrix'])
				if (levelType === null) {
					return
				}
				const {
					source: mix,
					sourceSinkType: [sourceType],
					sink: matrix,
					nrpn,
				} = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				if (sourceType === 'lr') {
					mixer.fadeLRLevelInMatrix(matrix, start, end, fadeTimeMs)
				} else {
					mixer.fadeMixLevelInMatrix(mix, matrix, start, end, fadeTimeMs)
				}
			},
		},
		[LevelActionId.GroupLevelInMatrix]: {
			name: 'Fader group level to matrix',
			options: [...sourceSinkOptions('Group', 'groups', 'Matrix', 'matrixes', choices), levelOption, fadingOption],
			callback: async ({ options }) => {
				const levelType = getLevelType(instance, model, options, ['group', 'matrix'])
				if (levelType === null) {
					return
				}
				const { source: group, sink: matrix, nrpn } = levelType

				const fade = getFadeParameters(instance, options, nrpn)
				if (fade === null) {
					return
				}
				const { start, end, fadeTimeMs } = fade

				mixer.fadeGroupLevelInMatrix(group, matrix, start, end, fadeTimeMs)
			},
		},
	}
}
