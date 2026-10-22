import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CatalogPart, type PartCategory } from "@partspilot/shared";
import { CURATED_PARTS, REFERENCE_PROJECTS } from "../src/index";
import type { FritzingPart } from "./import-fritzing";

const DATA = fileURLToPath(new URL("..", import.meta.url));

/** Families/titles that are PCB-design artefacts or generic connectors, not parts people own. */
const SKIP =
  /schematic|logo|frame|label|\bvia\b|\bhole\b|\bpad\b|copper|jumper \(|solder|mystery|generic ic|pin header|header|ruler|\bnote\b|\bwire\b|bendpoint|power symbol|ground symbol|netlabel|plain vanilla pcb|pcb|molex|hirose|db connector|crystal|oscillator|inductor|eeprom|logic gate|40xx|74xx|shrouded|terminal block|test point|fiducial|standoff|screw|spacer|rectangular|stripboard|perfboard|connector/i;

const CATEGORY_RULES: [RegExp, PartCategory][] = [
  [/microcontroller|arduino|raspberry|esp32|esp8266|picaxe|lilypad|teensy|feather|cpu board|wemos|mbed|basic stamp/i, "microcontroller"],
  [/motor driver|h-bridge|stepper driver|driver ic/i, "motor_driver"],
  [/servo/i, "servo"],
  [/motor|stepper/i, "motor"],
  [/sensor|accelerometer|gyro|thermistor|temperature|humidity|ultrasonic|photo|light dependent|hall|pressure|compass|magnetometer|gps|imu/i, "sensor"],
  [/display|lcd|oled|matrix|segment|tft|e-paper/i, "display"],
  [/bluetooth|wifi|wi-fi|xbee|radio|transceiver|rfid|nfc|gsm|lora|ethernet|ir receiver|infrared/i, "communication"],
  [/battery|cell|coin/i, "battery"],
  [/charger|charging/i, "charger"],
  [/regulator|converter|buck|boost|ldo/i, "regulator"],
  [/level shift|level convert/i, "level_shifter"],
  [/\bled\b|light emitting|neopixel|ws2812/i, "led"],
  [/button|switch|potentiometer|trimpot|keypad|joystick|encoder/i, "input"],
  [/relay/i, "relay"],
  [/buzzer|speaker|piezo|audio|microphone/i, "audio"],
  [/breadboard/i, "breadboard"],
  [/resistor|capacitor|diode|transistor|mosfet|fuse|varistor/i, "passive"],
  [/power|supply|usb/i, "power"],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    .replace(/-+$/g, "");

function categorize(f: FritzingPart): PartCategory {
  const hay = `${f.family ?? ""} ${f.title} ${f.tags.join(" ")}`;
  return CATEGORY_RULES.find(([re]) => re.test(hay))?.[1] ?? "module";
}

/** Distinctive tags: model numbers (letters+digits) or longer words; never generic ones. */
const GENERIC_TAG = /^(sparkfun|adafruit|seeed|fritzing|core|part|breakout|board|module|component|electronic|arduino|ic|chip|dip|smd|tht|basic|kit)$/i;
const distinctive = (t: string) => !GENERIC_TAG.test(t) && t.length <= 60 && (/[a-z]/i.test(t) && /\d/.test(t) ? true : t.length >= 6);

export interface BuiltCatalog {
  parts: CatalogPart[];
  aliases: { part_id: string; alias: string }[];
  references: { id: string; title: string; goal_examples: string[]; plan: unknown }[];
  stats: { curated: number; fritzing: number; merged: number; skipped: number };
}

export function buildCatalog(): BuiltCatalog {
  const fritzing = JSON.parse(readFileSync(`${DATA}/generated/fritzing-core.json`, "utf8")) as { parts: FritzingPart[] };
  const curated = CURATED_PARTS.map((p) => ({ ...p, aliases: [...p.aliases] }));
  const byAlias = new Map<string, CatalogPart>();
  for (const p of curated) for (const a of p.aliases) byAlias.set(norm(a), p);

  const out: CatalogPart[] = [...curated];
  const ids = new Set(curated.map((p) => p.id));
  const stats = { curated: curated.length, fritzing: 0, merged: 0, skipped: 0 };

  for (const f of fritzing.parts) {
    const hay = `${f.family ?? ""} ${f.title}`;
    if (SKIP.test(hay) || f.title.length < 3) {
      stats.skipped++;
      continue;
    }
    // Exact title match only: Fritzing's `type` property is generic ("LED", "Ultrasonic Sensor")
    // and would fold distinct products (LilyPad LED, US-100) into a curated part.
    const twin = byAlias.get(norm(f.title));
    if (twin) {
      if (!twin.aliases.some((a) => norm(a) === norm(f.title))) twin.aliases.push(f.title);
      stats.merged++;
      continue;
    }
    let id = `fz-${slug(f.module_id) || slug(f.title)}`;
    for (let n = 2; ids.has(id); n++) id = `${id.slice(0, 74)}-${n}`;
    ids.add(id);
    const aliases = [f.title, f.type, f.part_number, ...f.tags.filter(distinctive)]
      .filter((a): a is string => Boolean(a && a.trim()))
      .map((a) => a.trim().slice(0, 120));
    const parsed = CatalogPart.safeParse({
      id,
      name: f.title.slice(0, 120),
      category: categorize(f),
      source: "fritzing",
      source_ref: f.module_id.slice(0, 300),
      license: "CC-BY-SA-3.0",
      buy_query: f.title.slice(0, 120),
      aliases: [...new Map(aliases.map((a) => [norm(a), a])).values()].slice(0, 12),
      profile: null,
    });
    if (parsed.success) {
      out.push(parsed.data);
      stats.fritzing++;
    } else {
      stats.skipped++;
    }
  }

  const aliases = out.flatMap((p) => {
    const seen = new Set<string>();
    return p.aliases.flatMap((a) => {
      const key = a.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ part_id: p.id, alias: a }];
    });
  });

  const references = REFERENCE_PROJECTS.map((r) => ({ id: r.id, title: r.title, goal_examples: r.goal_examples, plan: r.plan }));
  return { parts: out, aliases, references, stats };
}
