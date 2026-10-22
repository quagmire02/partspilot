import { describe, expect, it } from "vitest";
import type { Connection, PlannerOutput } from "@partspilot/shared";
import { CURATED_BY_ID, REFERENCE_PROJECTS } from "@partspilot/data";
import { classifyNets, validatePlan } from "../src/index";

const catalog = (id: string) => CURATED_BY_ID.get(id);
const ref = (id: string) => REFERENCE_PROJECTS.find((p) => p.id === id)!.plan;

const w = (...lines: string[]): Connection[] =>
  lines.map((l) => {
    const [a, b] = l.split(/\s+>\s+/) as [string, string];
    const split = (s: string) => ({ ref: s.slice(0, s.indexOf(".")), pin: s.slice(s.indexOf(".") + 1) });
    return { from: split(a), to: split(b) };
  });

function run(plan: Pick<PlannerOutput, "parts" | "connections" | "power_mode">) {
  return validatePlan(plan, catalog);
}
const codes = (plan: Parameters<typeof run>[0]) => run(plan).issues.map((i) => i.code);

function mutate(id: string, f: (p: PlannerOutput) => void): PlannerOutput {
  const p = structuredClone(ref(id));
  f(p);
  return p;
}
const dropWire = (p: PlannerOutput, a: string, b: string) => {
  p.connections = p.connections.filter((c) => !(`${c.from.ref}.${c.from.pin}` === a && `${c.to.ref}.${c.to.pin}` === b));
};

describe("golden: every reference project passes", () => {
  it.each(REFERENCE_PROJECTS.map((p) => [p.id, p.plan] as const))("%s", (_, plan) => {
    const report = run(plan);
    expect(report.issues.map((i) => `${i.code}: ${i.message}`)).toEqual([]);
    expect(report.passed).toBe(true);
  });
});

describe("blocking rules", () => {
  it("5 V output into a 3.3 V input needs a level shifter or divider", () => {
    const p = mutate("rc-car-bluetooth-uno", (p) => {
      p.parts = p.parts.filter((x) => x.ref !== "DIV1");
      p.connections = p.connections.filter((c) => c.from.ref !== "DIV1" && c.to.ref !== "DIV1");
      p.connections.push(...w("U1.D3 > U3.RXD"));
    });
    const r = run(p);
    expect(r.passed).toBe(false);
    const issue = r.issues.find((i) => i.code === "voltage_mismatch")!;
    expect(issue.message).toContain("U3.RXD");
    expect(issue.hint).toMatch(/level shifter|divider/);
  });

  it("a series resistor does not make 5 V safe for an ESP32 pin", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "esp32-devkit-v1", qty: 1, purpose: "" },
          { ref: "U2", part_id: "hc-sr04-ultrasonic", qty: 1, purpose: "" },
          { ref: "R1", part_id: "resistor-1k", qty: 1, purpose: "" },
        ],
        connections: w("U1.VIN > U2.VCC", "U2.GND > U1.GND", "U1.D5 > U2.TRIG", "U2.ECHO > R1.1", "R1.2 > U1.D18"),
      }),
    ).toContain("voltage_mismatch");
  });

  it("a motor on a GPIO requires a driver", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
          { ref: "M1", part_id: "tt-dc-gear-motor", qty: 1, purpose: "" },
        ],
        connections: w("U1.D9 > M1.M+", "M1.M- > U1.GND"),
      }),
    ).toContain("driver_required");
  });

  it("a bare relay coil on a GPIO requires a driver", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
          { ref: "K1", part_id: "relay-srd-05vdc-bare", qty: 1, purpose: "" },
        ],
        connections: w("U1.D7 > K1.COIL1", "K1.COIL2 > U1.GND"),
      }),
    ).toContain("driver_required");
  });

  it("separate power domains need a common ground", () => {
    const p = mutate("rc-car-bluetooth-uno", (p) => dropWire(p, "U2.GND", "U1.GND"));
    expect(codes(p)).toContain("no_common_ground");
  });

  it("a module without its GND wired is blocked", () => {
    const p = mutate("ultrasonic-distance-uno", (p) => dropWire(p, "U1.GND", "U2.GND"));
    expect(codes(p)).toContain("missing_ground");
  });

  it("a 9 V battery cannot run two motors plus the Uno", () => {
    const p = mutate("rc-car-bluetooth-uno", (p) => {
      p.parts.find((x) => x.ref === "B1")!.part_id = "battery-9v";
    });
    const issue = run(p).issues.find((i) => i.code === "power_budget_exceeded")!;
    expect(issue.message).toMatch(/300 mA/);
  });

  it("battery mode without a battery has no power source", () => {
    const p = mutate("rc-car-bluetooth-uno", (p) => {
      p.parts = p.parts.filter((x) => x.ref !== "B1");
      p.connections = p.connections.filter((c) => c.from.ref !== "B1" && c.to.ref !== "B1");
    });
    expect(codes(p)).toContain("no_power_source");
  });

  it("USB cannot power a 16-LED NeoPixel ring at full draw", () => {
    const p = mutate("neopixel-ring-uno", (p) => {
      p.parts.find((x) => x.ref === "L1")!.part_id = "neopixel-ring-16";
    });
    expect(codes(p)).toContain("power_budget_exceeded");
  });

  it("an LED needs a series resistor", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
          { ref: "D1", part_id: "led-5mm-red", qty: 1, purpose: "" },
        ],
        connections: w("U1.D13 > D1.A", "D1.C > U1.GND"),
      }),
    ).toContain("led_needs_resistor");
  });

  it("an active buzzer draws more than a GPIO may source", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
          { ref: "BZ1", part_id: "buzzer-active-5v", qty: 1, purpose: "" },
        ],
        connections: w("U1.D8 > BZ1.+", "BZ1.- > U1.GND"),
      }),
    ).toContain("pin_current_exceeded");
  });

  it("one pin cannot serve two parts", () => {
    const p = mutate("rc-car-bluetooth-uno", (p) => {
      p.parts.push({ ref: "M3", part_id: "sg90-micro-servo", qty: 1, purpose: "" });
      p.connections.push(...w("U1.D5 > M3.PWM", "U1.5V > M3.V+", "M3.GND > U1.GND"));
    });
    expect(codes(p)).toContain("pin_reused");
  });

  it("I2C devices may share the bus pins", () => {
    expect(run(ref("rtc-clock-lcd-uno")).passed).toBe(true);
  });

  it("input-only ESP32 pins cannot drive an LED", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "esp32-devkit-v1", qty: 1, purpose: "" },
          { ref: "R1", part_id: "resistor-220", qty: 1, purpose: "" },
          { ref: "D1", part_id: "led-5mm-red", qty: 1, purpose: "" },
        ],
        connections: w("U1.D34 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND"),
      }),
    ).toContain("input_only_as_output");
  });

  it("reserved pins (Uno serial) are blocked", () => {
    const p = mutate("blink-led-uno", (p) => {
      p.connections[0] = w("U1.D1 > R1.1")[0]!;
    });
    expect(codes(p)).toContain("reserved_pin");
  });

  it("PWM-only inputs must land on PWM pins; I2C on I2C pins", () => {
    const p = mutate("rc-car-bluetooth-uno", (p) => {
      p.connections = p.connections.map((c) => (c.to.ref === "U2" && c.to.pin === "ENA" ? { ...c, from: { ref: "U1", pin: "D4" } } : c));
    });
    expect(codes(p)).toContain("pin_capability");
    const q = mutate("oled-thermometer-esp32", (p) => {
      p.connections = p.connections.map((c) => (c.to.ref === "U3" && c.to.pin === "SDA" ? { ...c, from: { ref: "U1", pin: "D27" } } : c));
    });
    expect(codes(q)).toContain("pin_capability");
  });

  it("module supply voltage must be in range", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [
          { ref: "U1", part_id: "esp32-devkit-v1", qty: 1, purpose: "" },
          { ref: "U2", part_id: "hc-sr04-ultrasonic", qty: 1, purpose: "" },
        ],
        connections: w("U1.3V3 > U2.VCC", "U2.GND > U1.GND", "U1.D5 > U2.TRIG"),
      }),
    ).toContain("supply_voltage_out_of_range");
  });

  it("shorts and back-fed rails are blocked", () => {
    expect(
      codes({
        power_mode: "usb",
        parts: [{ ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" }],
        connections: w("U1.5V > U1.GND"),
      }),
    ).toContain("short_circuit");
    const p = mutate("rc-car-bluetooth-uno", (p) => {
      p.power_mode = "usb";
      p.connections.push(...w("U2.5V > U1.5V"));
    });
    expect(codes(p)).toContain("power_sources_shorted");
  });

  it("drivers need every supply pin powered", () => {
    expect(
      codes({
        power_mode: "battery",
        parts: [
          { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
          { ref: "U2", part_id: "tb6612fng-motor-driver", qty: 1, purpose: "" },
          { ref: "B1", part_id: "battery-holder-2x18650", qty: 1, purpose: "" },
          { ref: "M1", part_id: "tt-dc-gear-motor", qty: 1, purpose: "" },
        ],
        connections: w(
          "B1.+ > U2.VM", "B1.+ > U1.VIN", "B1.- > U2.GND", "U2.GND > U1.GND",
          "U1.D5 > U2.PWMA", "U1.D7 > U2.AIN1", "U1.D8 > U2.AIN2", "U1.D9 > U2.STBY",
          "U2.AO1 > M1.M+", "U2.AO2 > M1.M-",
        ),
      }),
    ).toContain("part_unpowered");
  });

  it("a level shifter makes a 5 V LCD safe for an ESP32", () => {
    const base = {
      power_mode: "usb" as const,
      parts: [
        { ref: "U1", part_id: "esp32-devkit-v1", qty: 1, purpose: "" },
        { ref: "U2", part_id: "lcd1602-i2c", qty: 1, purpose: "" },
      ],
    };
    expect(codes({ ...base, connections: w("U1.VIN > U2.VCC", "U2.GND > U1.GND", "U1.D21 > U2.SDA", "U1.D22 > U2.SCL") })).toContain("voltage_mismatch");
    const shifted = run({
      ...base,
      parts: [...base.parts, { ref: "U3", part_id: "logic-level-shifter-4ch", qty: 1, purpose: "" }],
      connections: w(
        "U1.VIN > U2.VCC", "U2.GND > U1.GND",
        "U1.VIN > U3.HV", "U1.3V3 > U3.LV", "U3.GND > U1.GND.2",
        "U1.D21 > U3.LV1", "U3.HV1 > U2.SDA", "U1.D22 > U3.LV2", "U3.HV2 > U2.SCL",
      ),
    });
    expect(shifted.issues.map((i) => i.message)).toEqual([]);
  });
});

describe("structure and refusals", () => {
  it("rejects unknown parts and pins with repair hints", () => {
    const r = run({
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
        { ref: "X9", part_id: "flux-capacitor", qty: 1, purpose: "" },
      ],
      connections: w("U1.D99 > U1.GND"),
    });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["unknown_part", "unknown_pin"]));
    expect(r.issues.find((i) => i.code === "unknown_pin")!.hint).toContain("D13");
  });

  it.each([
    ["mains-power-cord", "refuse_mains"],
    ["high-voltage-arc-generator", "refuse_weapon"],
  ])("refuses builds with %s", (partId, code) => {
    const r = run({
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", qty: 1, purpose: "" },
        { ref: "X1", part_id: partId, qty: 1, purpose: "" },
      ],
      connections: [],
    });
    expect(r).toMatchObject({ passed: false, refused: true });
    expect(r.issues.map((i) => i.code)).toContain(code);
  });

  it("refuses charging an unprotected LiPo without a protection board, allows a protected charger", () => {
    const plan = (charger: string) => ({
      power_mode: "battery" as const,
      parts: [
        { ref: "U1", part_id: "esp32-devkit-v1", qty: 1, purpose: "" },
        { ref: "U2", part_id: charger, qty: 1, purpose: "" },
        { ref: "B1", part_id: "lipo-1s-1000mah", qty: 1, purpose: "" },
      ],
      connections: w("B1.+ > U2.B+", "B1.- > U2.B-"),
    });
    expect(run(plan("tp4056-charger-basic"))).toMatchObject({ refused: true });
    expect(run(plan("tp4056-charger-protected")).refused).toBe(false);
  });
});

describe("power analysis numbers", () => {
  it("computes the RC car's supply tree and current budget", async () => {
    const { buildNetlist, indexPins } = await import("../src/netlist");
    const { analyzePower } = await import("../src/power");
    const plan = ref("rc-car-bluetooth-uno");
    const parts = new Map(
      plan.parts.map((p) => {
        const c = catalog(p.part_id)!;
        return [p.ref, { ref: p.ref, part: c, profile: c.profile!, pinIndex: indexPins(c.profile!) }];
      }),
    );
    const pw = analyzePower(buildNetlist(parts, plan.connections), plan.power_mode);
    const byKey = new Map(pw.sources.map((s) => [s.key, s]));
    expect(byKey.get("B1.+")).toMatchObject({ origin: "battery", voltage: 7.4 });
    expect(byKey.get("U1.5V")).toMatchObject({ origin: "regulator", voltage: 5 });
    expect(byKey.has("U1.3.3V")).toBe(true);
    // 2 motors × 250 + L298N 36 + Uno 50 + HC-05 40 + divider input 0
    expect(Math.round(pw.demandOfKey("B1.+"))).toBe(626);
    expect(Math.round(pw.demandOfKey("U1.5V"))).toBe(40);
  });
});

describe("net classification", () => {
  it("names ground and powered rails for the diagram", () => {
    const nets = classifyNets(ref("rc-car-bluetooth-uno"), catalog);
    const kinds = new Map(nets.map((n) => [n.name, n.kind]));
    expect(kinds.get("GND")).toBe("ground");
    expect(kinds.get("7.4V")).toBe("power");
    expect(kinds.get("5V")).toBe("power");
    expect(nets.some((n) => n.kind === "load")).toBe(true);
  });
});
