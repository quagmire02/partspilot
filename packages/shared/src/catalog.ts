import { z } from "zod";

export const PartId = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "part ids are lowercase kebab-case");
export type PartId = z.infer<typeof PartId>;

export const PartCategory = z.enum([
  "microcontroller",
  "motor_driver",
  "motor",
  "servo",
  "sensor",
  "display",
  "communication",
  "power",
  "regulator",
  "battery",
  "charger",
  "level_shifter",
  "passive",
  "led",
  "input",
  "relay",
  "audio",
  "breadboard",
  "wire",
  "module",
  "other",
]);
export type PartCategory = z.infer<typeof PartCategory>;

/**
 * Electrical role of a pin. The rule engine reasons only over these kinds.
 *  - gpio:       MCU pin whose direction is set by firmware
 *  - input:      peripheral logic input that must be driven (e.g. L298N IN1, servo signal)
 *  - output:     peripheral logic output that drives its net (e.g. HC-SR04 ECHO)
 *  - analog_out: peripheral analog output (sensor AO, potentiometer wiper module)
 *  - bidir:      open-drain / bidirectional line (I2C SDA, DHT data, level shifter channel)
 *  - power_in:   consumes supply current
 *  - power_out:  supplies current (battery +, regulator out, board 5V/3V3)
 *  - ground
 *  - driver_out: switched high-current output (motor driver OUTx, MOSFET drain)
 *  - load:       terminal of a load that needs a driver (motor, relay coil, solenoid)
 *  - passive:    conductive terminal without logic semantics (resistor, button, pot, LED)
 *  - contact:    isolated switch contact (relay module COM/NO/NC)
 *  - nc:         not connected
 */
export const PinKind = z.enum([
  "gpio",
  "input",
  "output",
  "analog_out",
  "bidir",
  "power_in",
  "power_out",
  "ground",
  "driver_out",
  "load",
  "passive",
  "contact",
  "nc",
]);
export type PinKind = z.infer<typeof PinKind>;

export const PinCap = z.enum([
  "digital",
  "pwm",
  "adc",
  "dac",
  "i2c_sda",
  "i2c_scl",
  "spi_mosi",
  "spi_miso",
  "spi_sck",
  "spi_cs",
  "uart_tx",
  "uart_rx",
  "touch",
]);
export type PinCap = z.infer<typeof PinCap>;

export const PinMode = z.enum(["input", "output"]);
export type PinMode = z.infer<typeof PinMode>;

export const PinReservation = z.object({
  reason: z.enum(["flash", "boot_strap", "usb_serial", "onboard", "other"]),
  /** Modes in which using this pin is blocked. Empty = informational only. */
  blocked: z.array(PinMode),
  note: z.string().max(200),
});
export type PinReservation = z.infer<typeof PinReservation>;

export const PinSpec = z.object({
  name: z.string().min(1).max(24),
  aliases: z.array(z.string().min(1).max(24)).default([]),
  kind: PinKind,
  caps: z.array(PinCap).default([]),
  /** Capabilities the connected MCU pin must offer (e.g. a PWM enable input). */
  requires: z.array(PinCap).default([]),
  /** Output-high level for gpio/output/analog_out/bidir pins, volts. */
  logic_v: z.number().positive().max(60).optional(),
  /** Highest voltage the pin tolerates as an input, volts. */
  max_in_v: z.number().positive().max(60).optional(),
  /** Max current: gpio/output source-sink limit, power_out supply limit, driver_out limit (mA). */
  max_ma: z.number().positive().max(100000).optional(),
  /** Nominal output voltage of a power_out pin. */
  supply_v: z.number().positive().max(60).optional(),
  /** Accepted supply window for a power_in pin. */
  range_v: z.tuple([z.number().nonnegative(), z.number().positive()]).optional(),
  /** Typical current drawn through a power_in pin, or from the driving pin for an input (mA). */
  draw_ma: z.number().nonnegative().max(100000).optional(),
  /**
   * Output level follows this supply pin's net voltage: driver_out pins (motor supply) and
   * logic outputs of modules powered at either 3.3 V or 5 V (DHT22 data, I2C pull-ups).
   */
  out_v_from: z.string().max(24).optional(),
  input_only: z.boolean().default(false),
  reserved: PinReservation.optional(),
  /** Shared-bus membership; several devices may share a bus pin. */
  bus: z.enum(["i2c", "spi", "uart", "onewire"]).optional(),
});
export type PinSpec = z.infer<typeof PinSpec>;
export type PinSpecInput = z.input<typeof PinSpec>;

export const PartRole = z.enum([
  "mcu",
  "driver",
  "sensor",
  "actuator",
  "display",
  "comm",
  "power_source",
  "regulator",
  "level_shifter",
  "passive",
  "input_device",
  "indicator",
  "module",
  "charger",
  "consumable",
]);
export type PartRole = z.infer<typeof PartRole>;

export const Hazard = z.enum(["mains", "high_voltage", "weapon", "heating", "laser"]);
export type Hazard = z.infer<typeof Hazard>;

export const CodeLanguage = z.enum(["arduino_cpp", "micropython"]);
export type CodeLanguage = z.infer<typeof CodeLanguage>;

export const PartProfile = z.object({
  role: PartRole,
  pins: z.array(PinSpec).max(120),
  /** Groups of pins that are the same node inside the part (e.g. the three GNDs of an Uno). */
  bridges: z.array(z.array(z.string()).min(2)).default([]),
  /** Present when the part itself is a load that must be switched by a driver. */
  load: z
    .object({
      kind: z.enum(["motor", "relay_coil", "solenoid", "high_current_led", "pump", "fan"]),
      current_ma: z.number().positive(),
      stall_ma: z.number().positive().optional(),
    })
    .optional(),
  /** power_in pins whose current includes the loads on this part's driver outputs. */
  passes_load_current: z.array(z.string()).default([]),
  /** Regulators (incl. MCU boards): output pin is powered when the input pin's net is. */
  regulators: z
    .array(z.object({ in_pin: z.string(), out_pin: z.string() }))
    .default([]),
  /** MCU boards: supply pin that is powered by USB when the plan runs on USB power. */
  usb_power: z.object({ supply_pin: z.string(), max_ma: z.number().positive() }).optional(),
  /** Aggregate GPIO current limit for MCUs (mA). */
  gpio_total_ma: z.number().positive().optional(),
  /** Quiescent draw of the part itself (mA), used for budget when not on a pin. */
  self_draw_ma: z.number().nonnegative().default(0),
  resistance_ohm: z.number().positive().optional(),
  led: z.object({ vf: z.number().positive(), max_ma: z.number().positive() }).optional(),
  battery: z
    .object({
      chemistry: z.enum(["alkaline", "nimh", "lipo", "li_ion", "lead_acid", "usb_bank"]),
      nominal_v: z.number().positive(),
      protected: z.boolean(),
    })
    .optional(),
  charger: z
    .object({
      chemistry: z.array(z.enum(["lipo", "li_ion", "nimh", "lead_acid"])),
      protection: z.boolean(),
    })
    .optional(),
  hazards: z.array(Hazard).default([]),
  /** Composite parts (e.g. a resistor divider) are bought and stocked as these parts. */
  kit: z.array(z.object({ part_id: PartId, qty: z.number().int().min(1) })).default([]),
  languages: z.array(CodeLanguage).default([]),
  /** Diagram mapping to a wokwi-elements tag; absent → generic labelled box. */
  wokwi: z
    .object({
      element: z.string().regex(/^wokwi-[a-z0-9-]+$/),
      attrs: z.record(z.string(), z.string()).default({}),
      /** profile pin name → wokwi element pin name (identity when absent). */
      pin_map: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
});
export type PartProfile = z.infer<typeof PartProfile>;
export type PartProfileInput = z.input<typeof PartProfile>;

export const CatalogPart = z.object({
  id: PartId,
  /** Exact product name shown to users. */
  name: z.string().min(2).max(120),
  category: PartCategory,
  manufacturer: z.string().max(80).nullable().default(null),
  aliases: z.array(z.string().min(1).max(120)).max(60).default([]),
  source: z.enum(["fritzing", "kicad", "curated"]),
  source_ref: z.string().max(300).nullable().default(null),
  license: z.string().max(60).nullable().default(null),
  /** Search phrase used to build buy links. */
  buy_query: z.string().min(2).max(120),
  profile: PartProfile.nullable().default(null),
});
export type CatalogPart = z.infer<typeof CatalogPart>;
export type CatalogPartInput = z.input<typeof CatalogPart>;

export const CatalogSearchItem = z.object({
  part_id: PartId,
  name: z.string(),
  category: PartCategory,
  has_profile: z.boolean(),
});
export type CatalogSearchItem = z.infer<typeof CatalogSearchItem>;
