# companion-surface-intech-grid

Bitfocus Companion 5 surface module for Intech Studio Grid controllers, over USB MIDI.

- `src/` — the Companion surface module (TypeScript, `@companion-surface/base` 1.3)
- `grid/companion-setup.lua` — script to paste into each Grid module's System → Setup event
- `companion/HELP.md` — user help shown in Companion

Build: push to GitHub; the **Build** workflow produces `companion-surface-intech-grid-*.tgz` as an artifact (and attaches it to a release for `v*` tags). In Companion: Modules → **Import module package** → choose the .tgz, then add the Intech Studio Grid surface integration.

Local build: `corepack enable && yarn install && yarn package`.

Structure and MIDI handling are based on [bitfocus/companion-surface-midi](https://github.com/bitfocus/companion-surface-midi) (MIT). Grid element and hardware tables come from Intech Studio's grid-protocol and grid-firmware.
