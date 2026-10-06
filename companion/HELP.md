# Intech Studio Grid

Turns a Grid controller — any mix of modules (EF44, PBF4, EN16, PO16, BU16, PB44, TEK2, VSN1, VSN2, TEK1, OCTV) — into one Companion surface over USB MIDI. Companion lays the modules out the way they are chained, and each control is a normal Companion button, so it follows pages like a Stream Deck.

## What each control does

| Grid control | In Companion |
| --- | --- |
| Button / key | Press and release |
| Encoder or endless knob | Rotate left/right; push = press |
| Fader or pot | Rotate left/right as it moves, **and** its 0-127 value as a surface variable |
| LED | Shows the button's background colour |

Rotate actions only fire if the button has **Enable rotary actions** ticked.

Fader values appear in the surface's settings as variables (one per fader/pot) which you can link to a custom variable. The **Fader/pot movement per rotate step** setting makes faders coarser (e.g. 8 = 16 steps over full travel).

## Setting up the Grid (once per module)

1. In Grid Editor, reset the module to its default configuration (the default profile).
2. Select the module's **System** element (the utility button) and open its **Setup** event.
3. Add a **Code** block and paste in the script from `grid/companion-setup.lua` in this module's repository.
4. **Store** the configuration.
5. Repeat for every module in the chain.
6. Close Grid Editor — the Grid's MIDI port can only be used by one program at a time on Windows. Also remove any Generic MIDI connection in Companion that used the Grid.

The script makes each module announce its type and position, send its controls to Companion, and take LED colours back. It relies on each element's default actions, so leave those in place.

## Linking with a Stream Deck

To make the Grid follow the same page as a Stream Deck, put both in the same **surface group** in Companion's Surfaces tab.

## Notes

- Adding, removing or moving a module makes the surface reconnect with the new layout.
- Layouts for modules other than EF44 are based on Intech's element lists; the arrangement inside a module may not match the panel exactly.
- Requires Companion 5.0.
