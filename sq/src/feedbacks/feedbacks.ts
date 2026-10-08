import { combineRgb, type CompanionFeedbackDefinition, type DropdownChoice } from '@companion-module/base'
import type { Choices } from '../choices.js'
import {
	type FeedbackDefinitions,
	type FeedbackId,
	LevelThresholdFeedbackId,
	MuteFeedbackId,
	PickupLedFeedbackId,
} from './feedback-ids.js'
import type { sqInstance } from '../instance.js'
import { channelMixOptions, getLevelType, resolveChannelMix } from '../actions/level.js'
import { splitNRPN } from '../mixer/nrpn/nrpn.js'
import { DEFAULT_FLASH_MS, parseColour, parseNumber, pickupFor, scaleColour } from '../pickup.js'
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
				'Background colour for a fader using pickup mode. Colours can be typed (#ff0000 or 255,0,0) or come from a variable.',
			options: [
				...channelMixOptions(),
				{
					type: 'textinput',
					label: 'Fader value',
					id: 'value',
					default: '',
					useVariables: true,
				},
				{
					type: 'textinput',
					label: 'Below desk level: colour',
					id: 'belowColour',
					default: '#ff0000',
					useVariables: true,
					tooltip: 'Colour while the fader is below the desk level',
				},
				{
					type: 'checkbox',
					label: 'Below desk level: flash',
					id: 'belowFlash',
					default: true,
				},
				{
					type: 'textinput',
					label: 'Above desk level: colour',
					id: 'aboveColour',
					default: '#ff0000',
					useVariables: true,
					tooltip: 'Colour while the fader is above the desk level',
				},
				{
					type: 'checkbox',
					label: 'Above desk level: flash',
					id: 'aboveFlash',
					default: false,
				},
				{
					type: 'textinput',
					label: 'Catching: colour',
					id: 'catchColour',
					default: '#00ff00',
					useVariables: true,
					tooltip: 'Colour while the fader is in the catch band, before it latches',
				},
				{
					type: 'textinput',
					label: 'Tracking: colour',
					id: 'trackingColour',
					default: '#ffffff',
					useVariables: true,
					tooltip: 'Colour once latched; brightness follows the fader, off at 0, full at 127',
				},
				{
					type: 'textinput',
					label: 'Flash speed (ms per on/off)',
					id: 'flashMs',
					default: String(DEFAULT_FLASH_MS),
					useVariables: true,
				},
			],
			callback: async ({ options }, context) => {
				const resolved = await resolveChannelMix(instance, options, context)
				if (resolved === null) return {}
				const levelType = getLevelType(instance, mixer.model, resolved, ['inputChannel', 'mix-or-lr'])
				if (levelType === null) return {}
				const { MSB, LSB } = splitNRPN(levelType.nrpn)
				const text = async (id: string) => (await context.parseVariablesInString(String(options[id] ?? ''))).trim()

				const raw = await text('value')
				const n = Number(raw)
				const incoming = raw === '' || Number.isNaN(n) ? undefined : n
				const { led, position } = pickupFor(instance).ledState(`${MSB}.${LSB}`, incoming)

				const flashMs = parseNumber(await text('flashMs'), DEFAULT_FLASH_MS, 50, 5000)
				const flashOff = Math.floor(Date.now() / flashMs) % 2 === 1
				const BLACK = combineRgb(0, 0, 0)

				switch (led) {
					case 'below':
						return { bgcolor: options.belowFlash && flashOff ? BLACK : parseColour(await text('belowColour'), combineRgb(255, 0, 0)) }
					case 'above':
						return { bgcolor: options.aboveFlash && flashOff ? BLACK : parseColour(await text('aboveColour'), combineRgb(255, 0, 0)) }
					case 'catch':
						return { bgcolor: parseColour(await text('catchColour'), combineRgb(0, 255, 0)) }
					case 'tracking':
						return { bgcolor: scaleColour(parseColour(await text('trackingColour'), combineRgb(255, 255, 255)), position / 127) }
				}
			},
		},
		[LevelThresholdFeedbackId]: {
			type: 'advanced',
			name: 'Level at target LED',
			description:
				"Background colour while a channel's level is within a band either side of a target dB. One target each: add it several times for several targets (Companion's feedback order decides which wins).",
			options: [
				...channelMixOptions(),
				{
					type: 'textinput',
					label: 'Target (dB, or -inf)',
					id: 'target',
					default: '0',
					useVariables: true,
				},
				{
					type: 'textinput',
					label: 'Band (± dB either side of the target)',
					id: 'targetBand',
					default: '0.5',
					useVariables: true,
				},
				{
					type: 'textinput',
					label: 'Colour',
					id: 'colour',
					default: '#0000ff',
					useVariables: true,
					tooltip: '#0000ff, 0,0,255, or a variable',
				},
				{
					type: 'checkbox',
					label: 'Flash',
					id: 'flash',
					default: false,
				},
				{
					type: 'textinput',
					label: 'Flash speed (ms per on/off)',
					id: 'flashMs',
					default: String(DEFAULT_FLASH_MS),
					useVariables: true,
				},
				{
					type: 'textinput',
					label: 'Flash off colour (blank = show what is underneath)',
					id: 'offColour',
					default: '',
					useVariables: true,
				},
			],
			callback: async ({ options }, context) => {
				const resolved = await resolveChannelMix(instance, options, context)
				if (resolved === null) return {}
				const levelType = getLevelType(instance, mixer.model, resolved, ['inputChannel', 'mix-or-lr'])
				if (levelType === null) return {}
				const { MSB, LSB } = splitNRPN(levelType.nrpn)
				const text = async (id: string) => (await context.parseVariablesInString(String(options[id] ?? ''))).trim()

				const level = pickupFor(instance).deskLevel(`${MSB}.${LSB}`)
				if (level === undefined) return {}
				const numeric = level === '-inf' ? -90 : level
				const targetText = (await text('target')).toLowerCase()
				const target = targetText === '-inf' ? -90 : parseNumber(targetText, 0, -90, 10)
				const band = parseNumber(await text('targetBand'), 0.5, 0, 100)
				if (Math.abs(numeric - target) > band) return {}

				if (options.flash === true) {
					const flashMs = parseNumber(await text('flashMs'), DEFAULT_FLASH_MS, 50, 5000)
					if (Math.floor(Date.now() / flashMs) % 2 === 1) {
						const off = await text('offColour')
						return off === '' ? {} : { bgcolor: parseColour(off, combineRgb(0, 0, 0)) }
					}
				}
				return { bgcolor: parseColour(await text('colour'), combineRgb(0, 0, 255)) }
			},
		},
	}
}
