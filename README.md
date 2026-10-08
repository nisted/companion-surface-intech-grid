# companion-surface-intech-grid

Bitfocus Companion 5 surface module for Intech Studio Grid controllers, over USB MIDI.

- `src/` — the Companion surface module (TypeScript, `@companion-surface/base` 1.3)
- `grid/companion-setup.lua` — script to paste into each Grid module's System → Setup event
- `companion/HELP.md` — user help shown in Companion

Build: push to GitHub; the **Build** workflow produces `companion-surface-intech-grid-*.tgz` as an artifact (and attaches it to a release for `v*` tags). In Companion: Modules → **Import module package** → choose the .tgz, then add the Intech Studio Grid surface integration.

Local build: `corepack enable && yarn install && yarn package`.

Structure and MIDI handling are based on [bitfocus/companion-surface-midi](https://github.com/bitfocus/companion-surface-midi) (MIT). Grid element and hardware tables come from Intech Studio's grid-protocol and grid-firmware.

## Patched Allen & Heath SQ module (`sq/`)

`sq/` is the official [companion-module-allenheath-sq](https://github.com/bitfocus/companion-module-allenheath-sq) v3.1.0 (MIT), versioned `3.1.1-grid.4`, with one added action: **Fader channel level to mix (from value/variable)**, with an optional pickup mode (latches after the fader dwells in a catch band around the desk level; band and dwell configurable or from variables), plus a **Grid fader pickup LED** feedback with configurable colours. It sets a channel's level from a number or variable — either a fader position 0–127 (mapped along the SQ's own fader taper, so a Grid fader and the SQ fader line up) or a dB value.

## Downloads

The Build workflow publishes two artifacts:

- **companion-nige-modules-bundle** — one `.tgz` holding every module listed in `bundle-modules.txt`. In Companion: Modules → **Import offline module bundle**. Companion installs each module version it doesn't already have and skips ones it does (so bump a module's version when you change it).
- **companion-nige-modules** — the same modules as separate packages. In Companion: Modules → **Import module package**, one `.tgz` at a time.

Use the bundle with **Import offline module bundle** only: given to **Import module package**, Companion rejects it with "Doesn't look like a valid module, missing manifest", because that option expects a single module with `companion/manifest.json` at the top of the archive.

To add another desk module: put it in its own folder with a `package.json` and `yarn package` script, and add the folder to `bundle-modules.txt`.
