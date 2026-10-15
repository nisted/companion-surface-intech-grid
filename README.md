# companion-surface-intech-grid

Bitfocus Companion 5 surface module for Intech Studio Grid controllers (any mix of modules: EF44, PBF4, EN16,
PO16, BU16, PB44, TEK2, VSN1, VSN2, TEK1, OCTV), over USB MIDI. See [HELP.md](./companion/HELP.md) for
setup and use, and [LICENSE](./LICENSE).

## Development

`corepack enable && yarn install`, then `yarn build` (or `yarn dev` to rebuild on change). `yarn package`
makes the `.tgz` that Companion imports (Modules → Import module package). The Build workflow on GitHub does
the same on every push and attaches the package to a release for `v*` tags.

- `src/` — the surface module (`@companion-surface/base` 1.3)
- `grid/companion-setup.lua` — the script each Grid module runs (also printed in HELP.md)

Structure and MIDI handling are based on [bitfocus/companion-surface-midi](https://github.com/bitfocus/companion-surface-midi)
(MIT). Grid element and hardware tables come from Intech Studio's grid-protocol and grid-firmware.
