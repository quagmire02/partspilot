import type { CatalogPartInput } from "@partspilot/shared";
import { contact, gnd, input, output, part, passive, pwrIn, pwrOut } from "../pins";

// --- passives ----------------------------------------------------------------------

const resistor = (label: string, ohm: number, slug = label.toLowerCase()) =>
  part({
    id: `resistor-${slug}`,
    name: `${label}Ω Resistor (1/4 W)`,
    category: "passive",
    buy_query: `${label} ohm resistor 1/4W`,
    aliases: [`${label} resistor`, `${label} ohm`, `${label}Ω`, "resistor"],
    profile: {
      role: "passive",
      resistance_ohm: ohm,
      pins: [passive("1"), passive("2")],
      wokwi: { element: "wokwi-resistor", attrs: { value: String(ohm) } },
    },
  });

export const r220 = resistor("220", 220);
export const r330 = resistor("330", 330);
export const r1k = resistor("1k", 1000);
export const r2k = resistor("2k", 2000);
export const r4k7 = resistor("4.7k", 4700, "4k7");
export const r10k = resistor("10k", 10000);

export const divider = part({
  id: "voltage-divider-5v-3v3",
  name: "Voltage Divider 1 kΩ + 2 kΩ (5 V → 3.3 V)",
  category: "passive",
  buy_query: "1k 2k resistor",
  aliases: ["voltage divider", "resistor divider", "5V to 3.3V divider"],
  profile: {
    role: "level_shifter",
    kit: [
      { part_id: "resistor-1k", qty: 1 },
      { part_id: "resistor-2k", qty: 1 },
    ],
    pins: [input("IN", 5.5, { draw_ma: 2 }), output("OUT", 3.3), gnd("GND")],
  },
});

export const levelShifter = part({
  id: "logic-level-shifter-4ch",
  name: "4-Channel Bi-Directional Logic Level Shifter (BSS138)",
  category: "level_shifter",
  buy_query: "4 channel logic level converter BSS138",
  aliases: ["logic level converter", "level shifter", "BSS138 level shifter", "3.3V 5V converter", "TXS0108"],
  profile: {
    role: "level_shifter",
    bridges: [["GND", "GND.2"]],
    pins: [
      pwrIn("HV", [3.3, 5.5], 0),
      pwrIn("LV", [1.8, 3.6], 0),
      gnd("GND"),
      gnd("GND.2"),
      ...[1, 2, 3, 4].flatMap((n) => [
        { name: `HV${n}`, kind: "bidir" as const, out_v_from: "HV", max_in_v: 5.5 },
        { name: `LV${n}`, kind: "bidir" as const, out_v_from: "LV", max_in_v: 3.6 },
      ]),
    ],
  },
});

export const diode1n4007 = part({
  id: "diode-1n4007",
  name: "1N4007 Rectifier Diode",
  category: "passive",
  buy_query: "1N4007 diode",
  aliases: ["1N4007", "diode", "flyback diode", "rectifier diode", "1N4001"],
  profile: { role: "passive", pins: [passive("A", { aliases: ["anode"] }), passive("K", { aliases: ["cathode", "C"] })] },
});

export const cap100uf = part({
  id: "capacitor-100uf-25v",
  name: "100 µF 25 V Electrolytic Capacitor",
  category: "passive",
  buy_query: "100uF 25V electrolytic capacitor",
  aliases: ["100uF capacitor", "electrolytic capacitor", "capacitor"],
  profile: { role: "passive", pins: [passive("+"), passive("-")] },
});

// --- power sources -----------------------------------------------------------------------

const battery = (p: {
  id: string;
  name: string;
  v: number;
  ma: number;
  chemistry: "alkaline" | "nimh" | "lipo" | "li_ion";
  protectedCell: boolean;
  aliases: string[];
}) =>
  part({
    id: p.id,
    name: p.name,
    category: "battery",
    buy_query: p.name,
    aliases: p.aliases,
    profile: {
      role: "power_source",
      battery: { chemistry: p.chemistry, nominal_v: p.v, protected: p.protectedCell },
      pins: [pwrOut("+", p.v, p.ma, { aliases: ["VCC", "red", "BAT+"] }), gnd("-", { aliases: ["GND", "black", "BAT-"] })],
    },
  });

export const aa4 = battery({ id: "battery-holder-4xaa", name: "4×AA Battery Holder (6 V)", v: 6, ma: 1000, chemistry: "alkaline", protectedCell: true, aliases: ["4xAA battery holder", "AA battery pack", "battery box", "4 AA batteries"] });
export const nine = battery({ id: "battery-9v", name: "9 V Battery with Snap Connector", v: 9, ma: 300, chemistry: "alkaline", protectedCell: true, aliases: ["9V battery", "PP3", "9 volt battery", "battery snap"] });
export const holder2x18650 = battery({ id: "battery-holder-2x18650", name: "2×18650 Battery Holder (7.4 V Li-ion)", v: 7.4, ma: 3000, chemistry: "li_ion", protectedCell: false, aliases: ["18650 battery holder", "2S 18650", "18650 batteries"] });
export const lipo2s = battery({ id: "lipo-2s-1000mah", name: "2S 7.4 V 1000 mAh LiPo Battery", v: 7.4, ma: 5000, chemistry: "lipo", protectedCell: false, aliases: ["2S LiPo", "7.4V LiPo", "LiPo battery", "RC battery"] });
export const lipo1s = battery({ id: "lipo-1s-1000mah", name: "1S 3.7 V 1000 mAh LiPo Battery (unprotected)", v: 3.7, ma: 1000, chemistry: "lipo", protectedCell: false, aliases: ["1S LiPo", "3.7V LiPo", "LiPo pouch cell", "lithium polymer battery"] });
export const cell18650p = battery({ id: "li-ion-18650-protected", name: "18650 Li-ion Cell 3.7 V (protected)", v: 3.7, ma: 2000, chemistry: "li_ion", protectedCell: true, aliases: ["18650", "18650 cell", "protected 18650", "li-ion battery"] });

const adapter = (id: string, v: number, ma: number) =>
  part({
    id,
    name: `${v} V ${ma / 1000} A DC Power Adapter (barrel jack)`,
    category: "power",
    buy_query: `${v}V ${ma / 1000}A DC power adapter 5.5x2.1`,
    aliases: [`${v}V adapter`, `${v}V power supply`, "wall adapter", "DC adapter"],
    profile: { role: "power_source", pins: [pwrOut("+", v, ma, { aliases: ["VCC"] }), gnd("-", { aliases: ["GND"] })] },
  });

export const adapter12v = adapter("dc-adapter-12v-2a", 12, 2000);
export const adapter5v = adapter("dc-adapter-5v-2a", 5, 2000);

export const lm2596 = part({
  id: "lm2596-buck-converter",
  name: "LM2596 DC-DC Buck Converter Module (set to 5 V)",
  category: "regulator",
  buy_query: "LM2596 buck converter module",
  aliases: ["LM2596", "buck converter", "step-down converter", "DC-DC step down"],
  profile: {
    role: "regulator",
    self_draw_ma: 5,
    regulators: [{ in_pin: "IN+", out_pin: "OUT+" }],
    bridges: [["IN-", "OUT-"]],
    pins: [pwrIn("IN+", [4.5, 40], 0), gnd("IN-"), pwrOut("OUT+", 5, 2000), gnd("OUT-")],
  },
});

export const ams1117 = part({
  id: "ams1117-3v3-module",
  name: "AMS1117 3.3 V Regulator Module",
  category: "regulator",
  buy_query: "AMS1117 3.3V regulator module",
  aliases: ["AMS1117", "AMS1117-3.3", "3.3V regulator", "LDO 3.3V"],
  profile: {
    role: "regulator",
    self_draw_ma: 5,
    regulators: [{ in_pin: "IN", out_pin: "OUT" }],
    pins: [pwrIn("IN", [4.5, 12], 0, { aliases: ["VIN"] }), gnd("GND"), pwrOut("OUT", 3.3, 800, { aliases: ["VOUT", "3.3V"] })],
  },
});

export const tp4056Protected = part({
  id: "tp4056-charger-protected",
  name: "TP4056 Li-ion Charger Module with Protection (USB-C)",
  category: "charger",
  buy_query: "TP4056 charger module with protection USB-C",
  aliases: ["TP4056", "TP4056 with protection", "lithium charger module", "DW01 charger"],
  profile: {
    role: "charger",
    charger: { chemistry: ["li_ion", "lipo"], protection: true },
    regulators: [{ in_pin: "B+", out_pin: "OUT+" }],
    bridges: [["IN-", "B-", "OUT-"]],
    pins: [pwrIn("IN+", [4.5, 5.5], 0), gnd("IN-"), pwrIn("B+", [2.5, 4.3], 0, { aliases: ["BAT+"] }), gnd("B-", { aliases: ["BAT-"] }), pwrOut("OUT+", 3.7, 2000), gnd("OUT-")],
  },
});

export const tp4056Basic = part({
  id: "tp4056-charger-basic",
  name: "TP4056 Li-ion Charger Module (no protection)",
  category: "charger",
  buy_query: "TP4056 charger module",
  aliases: ["TP4056 basic", "TP4056 without protection", "micro USB lithium charger"],
  profile: {
    role: "charger",
    charger: { chemistry: ["li_ion", "lipo"], protection: false },
    bridges: [["IN-", "B-"]],
    pins: [pwrIn("IN+", [4.5, 5.5], 0), gnd("IN-"), pwrIn("B+", [2.5, 4.3], 0, { aliases: ["BAT+"] }), gnd("B-", { aliases: ["BAT-"] })],
  },
});

// --- hazardous (refused by the rule engine) -------------------------------------------

export const mainsCord = part({
  id: "mains-power-cord",
  name: "Mains Power Cord (110-240 V AC)",
  category: "power",
  buy_query: "mains power cord",
  aliases: ["mains cable", "AC power cord", "wall plug cable", "power cable 230V"],
  profile: { role: "power_source", hazards: ["mains"], pins: [contact("L"), contact("N"), contact("PE")] },
});

export const hlkPm01 = part({
  id: "hlk-pm01-ac-dc",
  name: "HLK-PM01 AC-DC 5 V Module (mains input)",
  category: "power",
  buy_query: "HLK-PM01",
  aliases: ["HLK-PM01", "AC-DC module", "220V to 5V module"],
  profile: { role: "regulator", hazards: ["mains"], pins: [contact("AC1"), contact("AC2"), pwrOut("+Vo", 5, 600), gnd("-Vo")] },
});

export const acBulb = part({
  id: "ac-bulb-socket-e27",
  name: "E27 Light Bulb Socket (mains)",
  category: "other",
  buy_query: "E27 lamp socket",
  aliases: ["light bulb", "lamp socket", "AC lamp", "E27 socket"],
  profile: { role: "actuator", hazards: ["mains"], pins: [contact("L"), contact("N")] },
});

export const hvArc = part({
  id: "high-voltage-arc-generator",
  name: "High-Voltage Arc Generator Module",
  category: "module",
  buy_query: "high voltage generator module",
  aliases: ["high voltage generator", "arc generator", "400kV module", "HV module", "taser module"],
  profile: { role: "module", hazards: ["high_voltage", "weapon"], pins: [pwrIn("IN+", [3.6, 6], 2000), gnd("IN-"), contact("HV1"), contact("HV2")] },
});

// --- consumables (no electrical role) -----------------------------------------------

const consumable = (id: string, name: string, aliases: string[], category: CatalogPartInput["category"] = "wire") =>
  part({ id, name, category, buy_query: name, aliases, profile: { role: "consumable", pins: [] } });

export const breadboard = consumable("breadboard-830", "830-Point Solderless Breadboard", ["breadboard", "solderless breadboard", "MB-102", "half breadboard"], "breadboard");
export const jumpersMM = consumable("jumper-wires-male-male", "Male-to-Male Jumper Wires (40 pcs)", ["jumper wires", "dupont wires", "male to male jumpers"]);
export const jumpersMF = consumable("jumper-wires-male-female", "Male-to-Female Jumper Wires (40 pcs)", ["male to female jumpers", "dupont male female"]);
export const chassis2wd = consumable("robot-car-chassis-2wd", "2WD Robot Car Chassis (frame, wheels, caster)", ["robot chassis", "2WD chassis", "car chassis kit", "robot car kit frame"], "other");
export const usbCableB = consumable("usb-cable-a-b", "USB-A to USB-B Cable", ["USB cable", "Arduino USB cable", "printer cable"]);

export const POWER_AND_PASSIVE_PARTS: CatalogPartInput[] = [
  r220,
  r330,
  r1k,
  r2k,
  r4k7,
  r10k,
  divider,
  levelShifter,
  diode1n4007,
  cap100uf,
  aa4,
  nine,
  holder2x18650,
  lipo2s,
  lipo1s,
  cell18650p,
  adapter12v,
  adapter5v,
  lm2596,
  ams1117,
  tp4056Protected,
  tp4056Basic,
  mainsCord,
  hlkPm01,
  acBulb,
  hvArc,
  breadboard,
  jumpersMM,
  jumpersMF,
  chassis2wd,
  usbCableB,
];
