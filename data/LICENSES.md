# Data licenses and attribution

| Data | Source | License |
|------|--------|---------|
| `generated/fritzing-core.json`, Fritzing-derived rows in `seed/catalog.sql` (`source = 'fritzing'`) | [Fritzing parts library](https://github.com/fritzing/fritzing-parts) — part titles, families, tags, connector names | CC-BY-SA 3.0 Unported. © Friends-of-Fritzing e.V. and contributors |
| `generated/kicad-pins.json` (pin names/electrical types used to cross-check profiles) | [KiCad symbol libraries](https://gitlab.com/kicad/libraries/kicad-symbols) | CC-BY-SA 4.0 with the KiCad libraries exception |
| Curated part profiles (`src/parts/*`) and reference projects (`src/reference/*`) | PartsPilot, informed by manufacturer datasheets, Fritzing and KiCad | CC-BY-SA 4.0 (share-alike, compatible with the sources above) |
| Diagram pin names (`src/wokwi-pins.ts`) | [@wokwi/elements](https://github.com/wokwi/wokwi-elements) 1.9.2 | MIT |

Share-alike applies to the catalog data, not to PartsPilot's code. The desktop app's
About screen credits Fritzing and KiCad.

Regenerate:

```bash
pnpm --filter @partspilot/data import:fritzing
pnpm --filter @partspilot/data import:kicad
pnpm --filter @partspilot/data build:seed
```
