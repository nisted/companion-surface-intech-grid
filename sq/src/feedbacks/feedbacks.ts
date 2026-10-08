import { combineRgb, type CompanionFeedbackDefinition, type DropdownChoice } from '@companion-module/base'
import type { Choices } from '../choices.js'
import { type FeedbackDefinitions, type FeedbackId, MuteFeedbackId, PickupLedFeedbackId } from './feedback-ids.js'
import type { sqInstance } from '../instance.js'
import { getLevelType, sourceSinkOptions } from '../actions/level.js'
import { splitNRPN } from '../mixer/nrpn/nrpn.js'
import { pickupFor } from '../pickup.js'
import type { Mixer } from '../mixer/mixer.js'
import type { InputOutputType } from '../mixer/model.js'
import { calculateMuteNRPN } from '../mixer/nrpn/mute.js'

const WHITE = combineRgb(255, 255, 255)
const CARMINE_RED = combineRgb(153, 0, 51)

export function getFeedbacks(instance: sqInstance, mixer: Mixer, choices: Choices): FeedbackDefinitions<FeedbackId> {
	function muteFeedback(label: string, type: InputOutputType, choices: DropdownChoice[]): CompanionFeedbackDefinition {
		return {
			type: 'boolean',
			name: `Mute ${label}`,
			description: 'Change colour',
			options: [
				{
					type: 'dropdown',
					label,
					id: 'channel',
					default: 0,
					choices,
					minChoicesForSearch: 0,
				},
			],
			defaultStyle: {
				color: WHITE,
				bgcolor: CARMINE_RED,
			},
			callback: ({ options }, _context) => {
				const nrpn = calculateMuteNRPN(mixer.model, type, Number(options.channel))
				return mixer.muted(nrpn)
			},
		}
	}

	return {
		[MuteFeedbackId.MuteInputChannel]: muteFeedback('Input', 'inputChannel', choices.inputChannels),
		[MuteFeedbackId.MuteLR]: muteFeedback('LR', 'lr', [{ label: `LR`, id: 0 }]),
		[MuteFeedbackId.MuteMix]: muteFeedback('Aux', 'mix', choices.mixes),
		[MuteFeedbackId.MuteGroup]: muteFeedback('Group', 'group', choices.groups),
		[MuteFeedbackId.MuteMatrix]: muteFeedback('Matrix', 'matrix', choices.matrixes),
		[MuteFeedbackId.MuteDCA]: muteFeedback('DCA', 'dca', choices.dcas),
		[MuteFeedbackId.MuteFXReturn]: muteFeedback('FX Return', 'fxReturn', choices.fxReturns),
		[MuteFeedbackId.MuteFXSend]: muteFeedback('FX Send', 'fxSend', choices.fxSends),
		[MuteFeedbackId.MuteMuteGroup]: muteFeedback('MuteGroup', 'muteGroup', choices.muteGroups),
		[PickupLedFeedbackId]: {
			type: 'advanced',
			name: 'Grid fader pickup LED',
			description:
				'Background colour for a fader using pickup mode: flashing red below the desk level, solid red above, green while catching, then white by fader position',
			options: [
				...sourceSinkOptions('Input channel', 'inputChannels', 'Mix', 'mixesAndLR', choices),
				{
					type: 'textinput',
					label: 'Fader value',
					id: 'value',
					default: '',
					useVariables: true,
				},
			],
			callback: async ({ options }, context) => {
				const levelType = getLevelType(instance, mixer.model, options, ['inputChannel', 'mix-or-lr'])
				if (levelType === null) return {}
				const { MSB, LSB } = splitNRPN(levelType.nrpn)
				const raw = (await context.parseVariablesInString(String(options.value ?? ''))).trim()
				const n = Number(raw)
				const incoming = raw === '' || Number.isNaN(n) ? undefined : n
				return { bgcolor: pickupFor(instance).ledColour(`${MSB}.${LSB}`, incoming) }
			},
		},
	}
}
