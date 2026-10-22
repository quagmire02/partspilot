import { CatalogPart } from "@partspilot/shared";
import { MCU_PARTS } from "./parts/mcu";
import { DRIVER_AND_LOAD_PARTS } from "./parts/drivers";
import { SENSOR_PARTS } from "./parts/sensors";
import { OUTPUT_AND_COMM_PARTS } from "./parts/output";
import { POWER_AND_PASSIVE_PARTS } from "./parts/power";

export { KICAD_REFS } from "./kicad-refs";
export { WOKWI_PINS } from "./wokwi-pins";
export { REFERENCE_PROJECTS, type ReferenceProject } from "./reference/index";

/** Curated catalog: every part has an electrical profile the rule engine can check. */
export const CURATED_PARTS: CatalogPart[] = [
  ...MCU_PARTS,
  ...DRIVER_AND_LOAD_PARTS,
  ...SENSOR_PARTS,
  ...OUTPUT_AND_COMM_PARTS,
  ...POWER_AND_PASSIVE_PARTS,
].map((p) => CatalogPart.parse(p));

export const CURATED_BY_ID: ReadonlyMap<string, CatalogPart> = new Map(CURATED_PARTS.map((p) => [p.id, p]));
