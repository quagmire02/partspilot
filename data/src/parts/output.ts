import type { CatalogPartInput, PartProfileInput } from "@partspilot/shared";
import { bidir, bidirFrom, gnd, i2c, input, output, part, passive, pwrIn } from "../pins";

// --- displays ------------------------------------------------------------------

export const lcd1602i2c = part({
  id: "lcd1602-i2c",
  name: "LCD1602 16×2 Character Display with I2C Backpack (PCF8574)",
  category: "display",
  buy_query: "LCD1602 I2C module PCF8574",
  aliases: ["LCD1602", "16x2 LCD", "I2C LCD", "LCD 1602 I2C", "PCF8574 LCD", "1602A"],
  profile: {
    role: "display",
    pins: [
      gnd("GND"),
      pwrIn("VCC", [4.5, 5.5], 30),
      bidirFrom("SDA", "VCC", 5.5, i2c),
      bidirFrom("SCL", "VCC", 5.5, i2c),
    ],
    wokwi: { element: "wokwi-lcd1602", attrs: { pins: "i2c" } },
  },
});

export const lcd2004i2c = part({
  id: "lcd2004-i2c",
  name: "LCD2004 20×4 Character Display with I2C Backpack",
  category: "display",
  buy_query: "LCD2004 I2C module",
  aliases: ["LCD2004", "20x4 LCD", "2004A I2C"],
  profile: {
    role: "display",
    pins: [gnd("GND"), pwrIn("VCC", [4.5, 5.5], 40), bidirFrom("SDA", "VCC", 5.5, i2c), bidirFrom("SCL", "VCC", 5.5, i2c)],
    wokwi: { element: "wokwi-lcd2004", attrs: { pins: "i2c" } },
  },
});

export const ssd1306 = part({
  id: "oled-ssd1306-128x64-i2c",
  name: "0.96\" OLED Display 128×64 I2C (SSD1306)",
  category: "display",
  buy_query: "0.96 inch OLED SSD1306 I2C 128x64",
  aliases: ["SSD1306", "OLED display", "0.96 OLED", "128x64 OLED", "I2C OLED"],
  profile: {
    role: "display",
    pins: [gnd("GND"), pwrIn("VCC", [3.3, 5], 20), bidirFrom("SCL", "VCC", 5.5, i2c), bidirFrom("SDA", "VCC", 5.5, i2c)],
    wokwi: { element: "wokwi-ssd1306", pin_map: { VCC: "VIN", SCL: "CLK", SDA: "DATA" } },
  },
});

export const tm1637 = part({
  id: "tm1637-4digit-display",
  name: "TM1637 4-Digit 7-Segment Display Module",
  category: "display",
  buy_query: "TM1637 4 digit display module",
  aliases: ["TM1637", "4 digit display", "7 segment display module", "clock display"],
  profile: {
    role: "display",
    pins: [input("CLK", 5.5), bidirFrom("DIO", "VCC", 5.5), pwrIn("VCC", [3.3, 5.5], 30), gnd("GND")],
  },
});

export const max7219 = part({
  id: "max7219-8x8-matrix",
  name: "MAX7219 8×8 LED Dot Matrix Module",
  category: "display",
  buy_query: "MAX7219 8x8 dot matrix module",
  aliases: ["MAX7219", "LED matrix", "8x8 matrix", "dot matrix"],
  profile: {
    role: "display",
    pins: [pwrIn("VCC", [4, 5.5], 150), gnd("GND"), input("DIN", 5.5), input("CS", 5.5), input("CLK", 5.5)],
  },
});

const neopixel = (id: string, name: string, n: number, wokwi: NonNullable<PartProfileInput["wokwi"]>, aliases: string[]) =>
  part({
    id,
    name,
    category: "led",
    buy_query: name,
    aliases: ["NeoPixel", "WS2812B", ...aliases],
    profile: {
      role: "indicator",
      pins: [
        pwrIn("VCC", [3.5, 5.3], 30 * n, { aliases: ["5V", "VDD", "+5V"] }),
        gnd("GND", { aliases: ["VSS"] }),
        input("DIN", 5.5, { aliases: ["DI", "IN"] }),
        output("DOUT", 5, { aliases: ["DO", "OUT"] }),
      ],
      wokwi,
    },
  });

export const neopixelStick8 = neopixel("neopixel-stick-8", "WS2812B NeoPixel Stick (8 LEDs)", 8, { element: "wokwi-neopixel-matrix", attrs: { rows: "1", cols: "8" }, pin_map: {} }, ["NeoPixel stick", "8 LED strip"]);
export const neopixelRing12 = neopixel("neopixel-ring-12", "WS2812B NeoPixel Ring (12 LEDs)", 12, { element: "wokwi-led-ring", attrs: { pixels: "12" }, pin_map: {} }, ["NeoPixel ring 12", "LED ring 12"]);
export const neopixelRing16 = neopixel("neopixel-ring-16", "WS2812B NeoPixel Ring (16 LEDs)", 16, { element: "wokwi-led-ring", attrs: { pixels: "16" }, pin_map: {} }, ["NeoPixel ring 16", "LED ring 16"]);

// --- LEDs --------------------------------------------------------------------------

const led5mm = (color: string, vf: number, hex: string) =>
  part({
    id: `led-5mm-${color}`,
    name: `5 mm ${color[0]!.toUpperCase()}${color.slice(1)} LED`,
    category: "led",
    buy_query: `5mm ${color} LED`,
    aliases: [`${color} LED`, `5mm ${color} LED`, "LED", `${hex} LED`],
    profile: {
      role: "indicator",
      led: { vf, max_ma: 20 },
      pins: [passive("A", { aliases: ["anode", "+", "long leg"] }), passive("C", { aliases: ["K", "cathode", "-", "short leg"] })],
      wokwi: { element: "wokwi-led", attrs: { color } },
    },
  });

export const ledRed = led5mm("red", 2.0, "red");
export const ledGreen = led5mm("green", 2.2, "green");
export const ledYellow = led5mm("yellow", 2.1, "yellow");
export const ledBlue = led5mm("blue", 3.0, "blue");
export const ledWhite = led5mm("white", 3.0, "white");

// --- audio -------------------------------------------------------------------------

export const piezoPassive = part({
  id: "buzzer-passive-piezo",
  name: "Passive Piezo Buzzer",
  category: "audio",
  buy_query: "passive piezo buzzer",
  aliases: ["piezo buzzer", "passive buzzer", "buzzer", "piezo speaker"],
  profile: {
    role: "indicator",
    pins: [input("+", 5.5, { aliases: ["1", "SIG"], draw_ma: 5 }), gnd("-", { aliases: ["2", "GND"] })],
    wokwi: { element: "wokwi-buzzer", pin_map: { "+": "2", "-": "1" } },
  },
});

export const buzzerActive = part({
  id: "buzzer-active-5v",
  name: "5V Active Buzzer (TMB12A05)",
  category: "audio",
  buy_query: "5V active buzzer TMB12A05",
  aliases: ["active buzzer", "5V buzzer", "TMB12A05", "beeper"],
  profile: {
    role: "indicator",
    pins: [input("+", 5.5, { draw_ma: 30 }), gnd("-", { aliases: ["GND"] })],
    wokwi: { element: "wokwi-buzzer", pin_map: { "+": "2", "-": "1" } },
  },
});

// --- communication ---------------------------------------------------------------------

export const hc05 = part({
  id: "hc-05-bluetooth",
  name: "HC-05 Bluetooth Serial Module",
  category: "communication",
  buy_query: "HC-05 Bluetooth module",
  aliases: ["HC-05", "HC05", "Bluetooth module", "bluetooth serial", "ZS-040"],
  profile: {
    role: "comm",
    pins: [
      pwrIn("VCC", [3.6, 6], 40),
      gnd("GND"),
      output("TXD", 3.3, { aliases: ["TX"] }),
      input("RXD", 3.6, { aliases: ["RX"] }),
      output("STATE", 3.3),
      input("EN", 3.6, { aliases: ["KEY"] }),
    ],
  },
});

export const hc06 = part({
  id: "hc-06-bluetooth",
  name: "HC-06 Bluetooth Serial Module",
  category: "communication",
  buy_query: "HC-06 Bluetooth module",
  aliases: ["HC-06", "HC06", "Bluetooth slave module"],
  profile: {
    role: "comm",
    pins: [pwrIn("VCC", [3.6, 6], 40), gnd("GND"), output("TXD", 3.3, { aliases: ["TX"] }), input("RXD", 3.6, { aliases: ["RX"] })],
  },
});

export const nrf24 = part({
  id: "nrf24l01-module",
  name: "nRF24L01+ 2.4 GHz Transceiver Module",
  category: "communication",
  buy_query: "nRF24L01+ module",
  aliases: ["NRF24L01", "nRF24L01+", "2.4GHz transceiver", "NRF24"],
  profile: {
    role: "comm",
    pins: [
      gnd("GND"),
      pwrIn("VCC", [1.9, 3.6], 15),
      input("CE", 5.25),
      input("CSN", 5.25),
      input("SCK", 5.25, { requires: ["spi_sck"] }),
      input("MOSI", 5.25, { requires: ["spi_mosi"] }),
      output("MISO", 3.3, { requires: ["spi_miso"] }),
      output("IRQ", 3.3),
    ],
  },
});

export const microSd = part({
  id: "micro-sd-module",
  name: "Micro SD Card Module (SPI, 5 V)",
  category: "module",
  buy_query: "micro SD card module SPI",
  aliases: ["micro SD module", "SD card module", "TF card module", "SD card reader"],
  profile: {
    role: "module",
    pins: [gnd("GND"), pwrIn("VCC", [4.5, 5.5], 30), output("MISO", 3.3, { requires: ["spi_miso"] }), input("MOSI", 5.5, { requires: ["spi_mosi"] }), input("SCK", 5.5, { requires: ["spi_sck"] }), input("CS", 5.5)],
    wokwi: { element: "wokwi-microsd-card", pin_map: { MISO: "DO", MOSI: "DI" } },
  },
});

export const ds3231 = part({
  id: "ds3231-rtc",
  name: "DS3231 Real-Time Clock Module",
  category: "module",
  buy_query: "DS3231 RTC module",
  aliases: ["DS3231", "RTC module", "real time clock", "ZS-042"],
  profile: {
    role: "module",
    pins: [
      gnd("GND"),
      pwrIn("VCC", [2.3, 5.5], 1),
      bidirFrom("SDA", "VCC", 5.5, i2c),
      bidirFrom("SCL", "VCC", 5.5, i2c),
      bidir("SQW", 3.3, 5.5),
      output("32K", 3.3),
    ],
  },
});

export const OUTPUT_AND_COMM_PARTS: CatalogPartInput[] = [
  lcd1602i2c,
  lcd2004i2c,
  ssd1306,
  tm1637,
  max7219,
  neopixelStick8,
  neopixelRing12,
  neopixelRing16,
  ledRed,
  ledGreen,
  ledYellow,
  ledBlue,
  ledWhite,
  piezoPassive,
  buzzerActive,
  hc05,
  hc06,
  nrf24,
  microSd,
  ds3231,
];
