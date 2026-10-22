import type { CatalogPart, PinSpec } from "@partspilot/shared";

const CAP_ABBR: Record<string, string> = {
  pwm: "pwm",
  adc: "adc",
  dac: "dac",
  i2c_sda: "sda",
  i2c_scl: "scl",
  spi_mosi: "mosi",
  spi_miso: "miso",
  spi_sck: "sck",
  spi_cs: "cs",
  uart_tx: "tx",
  uart_rx: "rx",
  touch: "touch",
};

function describePin(p: PinSpec): string {
  switch (p.kind) {
    case "gpio": {
      const flags = p.caps.filter((c) => c !== "digital").map((c) => CAP_ABBR[c] ?? c);
      if (p.input_only) flags.push("input-only");
      if (p.reserved?.blocked.length) flags.push(`avoid:${p.reserved.reason}`);
      return flags.length ? `${p.name}[${flags.join(",")}]` : p.name;
    }
    case "power_in":
      return `${p.name}(power in ${p.range_v?.[0]}-${p.range_v?.[1]}V${p.draw_ma ? ` ~${p.draw_ma}mA` : ""})`;
    case "power_out":
      return `${p.name}(power out ${p.supply_v}V max ${p.max_ma}mA)`;
    case "ground":
      return `${p.name}(GND)`;
    case "input":
      return `${p.name}(in ≤${p.max_in_v}V${p.requires.length ? ` needs ${p.requires.map((c) => CAP_ABBR[c] ?? c).join("/")}` : ""})`;
    case "output":
      return `${p.name}(out ${p.logic_v ? `${p.logic_v}V` : `level=${p.out_v_from}`})`;
    case "analog_out":
      return `${p.name}(analog out, needs adc)`;
    case "bidir":
      return `${p.name}(${p.bus ?? "io"} ${p.logic_v ? `${p.logic_v}V` : `level=${p.out_v_from}`} ≤${p.max_in_v}V)`;
    case "driver_out":
      return `${p.name}(driver out ≤${p.max_ma}mA)`;
    case "load":
      return `${p.name}(load terminal)`;
    case "contact":
      return `${p.name}(switch contact)`;
    case "passive":
      return p.name;
    default:
      return "";
  }
}

/** One line per part: id | name | role | key facts | pins. Hazardous parts are never offered. */
export function describePart(c: CatalogPart): string | null {
  const pr = c.profile;
  if (!pr || pr.hazards.length) return null;
  const facts: string[] = [];
  if (pr.role === "mcu") {
    const g = pr.pins.find((p) => p.kind === "gpio");
    if (g) facts.push(`logic ${g.logic_v}V (inputs max ${g.max_in_v}V), ${g.max_ma}mA per pin`);
    facts.push(`code: ${pr.languages.join("/")}`);
    if (pr.usb_power) facts.push(`USB powers ${pr.usb_power.supply_pin}`);
  }
  if (pr.load) facts.push(`${pr.load.kind} ~${pr.load.current_ma}mA: needs a driver`);
  if (pr.led) facts.push(`LED Vf ${pr.led.vf}V max ${pr.led.max_ma}mA: needs series resistor`);
  if (pr.resistance_ohm) facts.push(`${pr.resistance_ohm}Ω`);
  if (pr.battery) facts.push(`${pr.battery.nominal_v}V ${pr.battery.chemistry}${pr.battery.protected ? "" : " (unprotected)"}`);
  if (pr.kit.length) facts.push(`built from ${pr.kit.map((k) => `${k.qty}× ${k.part_id}`).join(" + ")}`);
  if (pr.role === "consumable") facts.push("no wiring");
  const pins = pr.pins.filter((p) => p.kind !== "nc").map(describePin).filter(Boolean).join(" ");
  const notes = pr.pins
    .filter((p) => p.reserved?.blocked.length)
    .map((p) => `${p.name}: ${p.reserved!.note}`)
    .slice(0, 4)
    .join(" ");
  return [c.id, c.name, pr.role, facts.join("; "), pins ? `pins: ${pins}` : "", notes ? `notes: ${notes}` : ""].filter(Boolean).join(" | ");
}

export function describeAllowedParts(parts: CatalogPart[]): string {
  return parts
    .map(describePart)
    .filter((l): l is string => l !== null)
    .join("\n");
}
