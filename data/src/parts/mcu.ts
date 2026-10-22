import type { CatalogPartInput, PinCap, PinSpecInput } from "@partspilot/shared";
import { gnd, gpio, input, nc, part, pwrIn, pwrOut, reserved } from "../pins";

const USB_SERIAL_NOTE = "Hardware serial is used for USB upload and the Serial Monitor. Use SoftwareSerial on other pins.";

// --- Arduino Uno R3 (ATmega328P, 5 V) ---------------------------------------
const UNO_PWM = new Set([3, 5, 6, 9, 10, 11]);
const unoDigital = (n: number): PinSpecInput => {
  const caps: PinCap[] = UNO_PWM.has(n) ? ["pwm"] : [];
  if (n === 10) caps.push("spi_cs");
  if (n === 11) caps.push("spi_mosi");
  if (n === 12) caps.push("spi_miso");
  if (n === 13) caps.push("spi_sck");
  if (n === 0) caps.push("uart_rx");
  if (n === 1) caps.push("uart_tx");
  const extra = n <= 1 ? reserved("usb_serial", ["input", "output"], USB_SERIAL_NOTE) : n === 13 ? reserved("onboard", [], "Onboard LED L is on D13.") : {};
  return gpio(`D${n}`, 5, 20, caps, { aliases: [String(n), ...(n === 0 ? ["RX"] : n === 1 ? ["TX"] : [])], ...extra });
};

export const arduinoUno = part({
  id: "arduino-uno-r3",
  name: "Arduino Uno R3",
  category: "microcontroller",
  manufacturer: "Arduino",
  buy_query: "Arduino Uno R3",
  aliases: [
    "Arduino Uno",
    "Arduino UNO",
    "Uno R3",
    "UNO",
    "Arduino Uno (Rev3)",
    "Uno R3 CH340",
    "Arduino Uno clone",
    "ATmega328P board",
    "blue Arduino board",
  ],
  profile: {
    role: "mcu",
    languages: ["arduino_cpp"],
    gpio_total_ma: 200,
    self_draw_ma: 50,
    usb_power: { supply_pin: "5V", max_ma: 500 },
    regulators: [
      { in_pin: "VIN", out_pin: "5V" },
      { in_pin: "5V", out_pin: "3.3V" },
    ],
    bridges: [["GND", "GND.2", "GND.3"]],
    pins: [
      ...Array.from({ length: 14 }, (_, n) => unoDigital(n)),
      gpio("A0", 5, 20, ["adc"], { aliases: ["14"] }),
      gpio("A1", 5, 20, ["adc"], { aliases: ["15"] }),
      gpio("A2", 5, 20, ["adc"], { aliases: ["16"] }),
      gpio("A3", 5, 20, ["adc"], { aliases: ["17"] }),
      gpio("A4", 5, 20, ["adc", "i2c_sda"], { aliases: ["18", "SDA"] }),
      gpio("A5", 5, 20, ["adc", "i2c_scl"], { aliases: ["19", "SCL"] }),
      pwrOut("5V", 5, 400, { aliases: ["+5V"] }),
      pwrOut("3.3V", 3.3, 50, { aliases: ["3V3"] }),
      pwrIn("VIN", [7, 12], 0),
      gnd("GND", { aliases: ["GND.1"] }),
      gnd("GND.2"),
      gnd("GND.3"),
      input("RESET", 5.5),
      nc("AREF"),
      nc("IOREF"),
    ],
    wokwi: {
      element: "wokwi-arduino-uno",
      pin_map: {
        ...Object.fromEntries(Array.from({ length: 14 }, (_, n) => [`D${n}`, String(n)])),
        GND: "GND.1",
      },
    },
  },
});

// --- Arduino Nano (ATmega328P, 5 V) ------------------------------------------
export const arduinoNano = part({
  id: "arduino-nano-v3",
  name: "Arduino Nano V3",
  category: "microcontroller",
  manufacturer: "Arduino",
  buy_query: "Arduino Nano V3 ATmega328P",
  aliases: ["Arduino Nano", "Nano V3", "Nano", "Arduino Nano CH340", "Nano ATmega328P"],
  profile: {
    role: "mcu",
    languages: ["arduino_cpp"],
    gpio_total_ma: 200,
    self_draw_ma: 30,
    usb_power: { supply_pin: "5V", max_ma: 500 },
    regulators: [
      { in_pin: "VIN", out_pin: "5V" },
      { in_pin: "5V", out_pin: "3V3" },
    ],
    bridges: [["GND", "GND.2"]],
    pins: [
      ...Array.from({ length: 14 }, (_, n) => unoDigital(n)),
      gpio("A0", 5, 20, ["adc"], { aliases: ["14"] }),
      gpio("A1", 5, 20, ["adc"], { aliases: ["15"] }),
      gpio("A2", 5, 20, ["adc"], { aliases: ["16"] }),
      gpio("A3", 5, 20, ["adc"], { aliases: ["17"] }),
      gpio("A4", 5, 20, ["adc", "i2c_sda"], { aliases: ["18", "SDA"] }),
      gpio("A5", 5, 20, ["adc", "i2c_scl"], { aliases: ["19", "SCL"] }),
      gpio("A6", 5, 1, ["adc"], { input_only: true, caps: ["adc"], ...reserved("other", ["output"], "A6/A7 are analog-input only.") }),
      gpio("A7", 5, 1, ["adc"], { input_only: true, caps: ["adc"], ...reserved("other", ["output"], "A6/A7 are analog-input only.") }),
      pwrOut("5V", 5, 400, { aliases: ["+5V"] }),
      pwrOut("3V3", 3.3, 50, { aliases: ["3.3V"] }),
      pwrIn("VIN", [7, 12], 0),
      gnd("GND", { aliases: ["GND.1"] }),
      gnd("GND.2"),
      input("RESET", 5.5),
      nc("AREF"),
    ],
    wokwi: {
      element: "wokwi-arduino-nano",
      pin_map: {
        ...Object.fromEntries(Array.from({ length: 14 }, (_, n) => [`D${n}`, String(n)])),
        GND: "GND.1",
        "3V3": "3.3V",
      },
    },
  },
});

// --- Arduino Mega 2560 R3 ------------------------------------------------------
const MEGA_PWM = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46]);
const megaDigital = (n: number): PinSpecInput => {
  const caps: PinCap[] = MEGA_PWM.has(n) ? ["pwm"] : [];
  const uart: Record<number, PinCap> = { 0: "uart_rx", 1: "uart_tx", 14: "uart_tx", 15: "uart_rx", 16: "uart_tx", 17: "uart_rx", 18: "uart_tx", 19: "uart_rx" };
  if (uart[n]) caps.push(uart[n]!);
  if (n === 20) caps.push("i2c_sda");
  if (n === 21) caps.push("i2c_scl");
  if (n === 50) caps.push("spi_miso");
  if (n === 51) caps.push("spi_mosi");
  if (n === 52) caps.push("spi_sck");
  if (n === 53) caps.push("spi_cs");
  const extra = n <= 1 ? reserved("usb_serial", ["input", "output"], USB_SERIAL_NOTE) : {};
  const alias = n === 20 ? ["SDA"] : n === 21 ? ["SCL"] : [];
  return gpio(`D${n}`, 5, 20, caps, { aliases: [String(n), ...alias], ...extra });
};

export const arduinoMega = part({
  id: "arduino-mega-2560-r3",
  name: "Arduino Mega 2560 R3",
  category: "microcontroller",
  manufacturer: "Arduino",
  buy_query: "Arduino Mega 2560 R3",
  aliases: ["Arduino Mega", "Mega 2560", "MEGA2560", "ATmega2560 board"],
  profile: {
    role: "mcu",
    languages: ["arduino_cpp"],
    gpio_total_ma: 400,
    self_draw_ma: 80,
    usb_power: { supply_pin: "5V", max_ma: 500 },
    regulators: [
      { in_pin: "VIN", out_pin: "5V" },
      { in_pin: "5V", out_pin: "3.3V" },
    ],
    bridges: [["GND", "GND.2", "GND.3", "GND.4", "GND.5"]],
    pins: [
      ...Array.from({ length: 54 }, (_, n) => megaDigital(n)),
      ...Array.from({ length: 16 }, (_, n) => gpio(`A${n}`, 5, 20, ["adc"], { aliases: [String(54 + n)] })),
      pwrOut("5V", 5, 400, { aliases: ["+5V"] }),
      pwrOut("3.3V", 3.3, 50, { aliases: ["3V3"] }),
      pwrIn("VIN", [7, 12], 0),
      gnd("GND", { aliases: ["GND.1"] }),
      gnd("GND.2"),
      gnd("GND.3"),
      gnd("GND.4"),
      gnd("GND.5"),
      input("RESET", 5.5),
      nc("AREF"),
      nc("IOREF"),
    ],
    wokwi: {
      element: "wokwi-arduino-mega",
      pin_map: {
        ...Object.fromEntries(Array.from({ length: 54 }, (_, n) => [`D${n}`, String(n)])),
        GND: "GND.1",
      },
    },
  },
});

// --- ESP32 DevKit V1 (ESP32-WROOM-32, 30 pin, 3.3 V, NOT 5 V tolerant) --------
const esp = (name: string, gpioNo: number, caps: PinCap[], extra: Partial<PinSpecInput> = {}) =>
  gpio(name, 3.3, 20, caps, { aliases: [`GPIO${gpioNo}`, `IO${gpioNo}`, String(gpioNo)], ...extra });
const ESP_IN_ONLY = { input_only: true, ...reserved("other", ["output"], "GPIO34-39 are input-only (no output, no pull-ups).") };

export const esp32DevkitV1 = part({
  id: "esp32-devkit-v1",
  name: "ESP32 DevKit V1 (ESP32-WROOM-32)",
  category: "microcontroller",
  manufacturer: "Espressif",
  buy_query: "ESP32 DevKit V1 ESP32-WROOM-32 30 pin",
  aliases: ["ESP32", "ESP32 DevKit", "ESP32-WROOM-32", "ESP-WROOM-32", "DOIT ESP32 DEVKIT V1", "ESP32 dev board", "NodeMCU-32S"],
  profile: {
    role: "mcu",
    languages: ["arduino_cpp", "micropython"],
    gpio_total_ma: 200,
    self_draw_ma: 150,
    usb_power: { supply_pin: "VIN", max_ma: 500 },
    regulators: [{ in_pin: "VIN", out_pin: "3V3" }],
    bridges: [["GND", "GND.2"]],
    pins: [
      esp("D13", 13, ["pwm", "adc", "touch"]),
      esp("D12", 12, ["pwm", "adc", "touch"], reserved("boot_strap", ["input"], "Strapping pin (flash voltage): must be LOW at boot. Do not pull up.")),
      esp("D14", 14, ["pwm", "adc", "touch"]),
      esp("D27", 27, ["pwm", "adc", "touch"]),
      esp("D26", 26, ["pwm", "adc", "dac"]),
      esp("D25", 25, ["pwm", "adc", "dac"]),
      esp("D33", 33, ["pwm", "adc", "touch"]),
      esp("D32", 32, ["pwm", "adc", "touch"]),
      esp("D35", 35, ["adc"], ESP_IN_ONLY),
      esp("D34", 34, ["adc"], ESP_IN_ONLY),
      esp("VN", 39, ["adc"], ESP_IN_ONLY),
      esp("VP", 36, ["adc"], ESP_IN_ONLY),
      esp("D15", 15, ["pwm", "adc", "touch"], reserved("boot_strap", [], "Strapping pin: prints boot log when HIGH; fine for outputs.")),
      esp("D2", 2, ["pwm", "adc", "touch"], reserved("boot_strap", ["input"], "Strapping pin + onboard LED: must be LOW/floating to flash.")),
      esp("D4", 4, ["pwm", "adc", "touch"]),
      esp("RX2", 16, ["pwm", "uart_rx"], { aliases: ["GPIO16", "IO16", "16", "D16"] }),
      esp("TX2", 17, ["pwm", "uart_tx"], { aliases: ["GPIO17", "IO17", "17", "D17"] }),
      esp("D5", 5, ["pwm", "spi_cs"], reserved("boot_strap", [], "Strapping pin: outputs PWM at boot; fine for most outputs.")),
      esp("D18", 18, ["pwm", "spi_sck"]),
      esp("D19", 19, ["pwm", "spi_miso"]),
      esp("D21", 21, ["pwm", "i2c_sda"], { aliases: ["GPIO21", "IO21", "21", "SDA"] }),
      esp("RX0", 3, ["uart_rx"], { aliases: ["GPIO3", "3", "RX"], ...reserved("usb_serial", ["input", "output"], USB_SERIAL_NOTE) }),
      esp("TX0", 1, ["uart_tx"], { aliases: ["GPIO1", "1", "TX"], ...reserved("usb_serial", ["input", "output"], USB_SERIAL_NOTE) }),
      esp("D22", 22, ["pwm", "i2c_scl"], { aliases: ["GPIO22", "IO22", "22", "SCL"] }),
      esp("D23", 23, ["pwm", "spi_mosi"]),
      pwrIn("VIN", [4.5, 12], 0, { aliases: ["5V"] }),
      pwrOut("3V3", 3.3, 400, { aliases: ["3.3V"] }),
      gnd("GND", { aliases: ["GND.1"] }),
      gnd("GND.2"),
      input("EN", 3.6),
    ],
    wokwi: { element: "wokwi-esp32-devkit-v1", pin_map: { GND: "GND.1" } },
  },
});

// --- ESP8266 NodeMCU v3 (ESP-12E, 3.3 V) ------------------------------------
const nmcu = (name: string, gpioNo: number, caps: PinCap[], extra: Partial<PinSpecInput> = {}) =>
  gpio(name, 3.3, 12, caps, { aliases: [`GPIO${gpioNo}`, String(gpioNo)], ...extra });
const NMCU_STRAP = (note: string) => reserved("boot_strap", ["input", "output"], note);

export const nodemcuV3 = part({
  id: "nodemcu-esp8266-v3",
  name: "NodeMCU ESP8266 V3 (ESP-12E)",
  category: "microcontroller",
  manufacturer: "Espressif",
  buy_query: "NodeMCU ESP8266 V3 CH340",
  aliases: ["NodeMCU", "ESP8266", "ESP-12E", "NodeMCU V3", "Lolin NodeMCU", "ESP8266 NodeMCU"],
  profile: {
    role: "mcu",
    languages: ["arduino_cpp", "micropython"],
    gpio_total_ma: 100,
    self_draw_ma: 80,
    usb_power: { supply_pin: "VIN", max_ma: 500 },
    regulators: [{ in_pin: "VIN", out_pin: "3V3" }],
    bridges: [["GND", "GND.2"]],
    pins: [
      nmcu("D0", 16, [], { caps: ["digital"] }),
      nmcu("D1", 5, ["pwm", "i2c_scl"], { aliases: ["GPIO5", "5", "SCL"] }),
      nmcu("D2", 4, ["pwm", "i2c_sda"], { aliases: ["GPIO4", "4", "SDA"] }),
      nmcu("D3", 0, ["pwm"], NMCU_STRAP("GPIO0 selects flash mode at boot; leave it free.")),
      nmcu("D4", 2, ["pwm"], NMCU_STRAP("GPIO2 must be HIGH at boot (onboard LED); leave it free.")),
      nmcu("D5", 14, ["pwm", "spi_sck"]),
      nmcu("D6", 12, ["pwm", "spi_miso"]),
      nmcu("D7", 13, ["pwm", "spi_mosi"]),
      nmcu("D8", 15, ["pwm", "spi_cs"], NMCU_STRAP("GPIO15 must be LOW at boot; leave it free.")),
      nmcu("RX", 3, ["uart_rx"], reserved("usb_serial", ["input", "output"], USB_SERIAL_NOTE)),
      nmcu("TX", 1, ["uart_tx"], reserved("usb_serial", ["input", "output"], USB_SERIAL_NOTE)),
      gpio("A0", 3.3, 1, ["adc"], { input_only: true, caps: ["adc"], ...reserved("other", ["output"], "A0 is analog input only (0-3.3 V on NodeMCU).") }),
      pwrIn("VIN", [4.5, 10], 0, { aliases: ["5V", "VU"] }),
      pwrOut("3V3", 3.3, 300, { aliases: ["3.3V"] }),
      gnd("GND"),
      gnd("GND.2"),
      input("RST", 3.6),
    ],
  },
});

// --- Raspberry Pi Pico (RP2040, 3.3 V) ---------------------------------------
const pico = (n: number): PinSpecInput => {
  const caps: PinCap[] = ["pwm"];
  if ([0, 4, 8, 12, 16, 20].includes(n)) caps.push("i2c_sda");
  if ([1, 5, 9, 13, 17, 21].includes(n)) caps.push("i2c_scl");
  if ([0, 12, 16].includes(n)) caps.push("uart_tx");
  if ([1, 13, 17].includes(n)) caps.push("uart_rx");
  if (n === 16) caps.push("spi_miso");
  if (n === 17) caps.push("spi_cs");
  if (n === 18) caps.push("spi_sck");
  if (n === 19) caps.push("spi_mosi");
  if (n >= 26) caps.push("adc");
  const aliases = [`GPIO${n}`, String(n), ...(n >= 26 ? [`ADC${n - 26}`, `GPIO${n}_ADC${n - 26}`] : [])];
  return gpio(`GP${n}`, 3.3, 12, caps, { aliases });
};

export const raspberryPiPico = part({
  id: "raspberry-pi-pico",
  name: "Raspberry Pi Pico (RP2040)",
  category: "microcontroller",
  manufacturer: "Raspberry Pi",
  buy_query: "Raspberry Pi Pico RP2040",
  aliases: ["Raspberry Pi Pico", "Pi Pico", "RP2040", "Pico", "RPI-RP2"],
  profile: {
    role: "mcu",
    languages: ["micropython", "arduino_cpp"],
    gpio_total_ma: 50,
    self_draw_ma: 25,
    usb_power: { supply_pin: "VBUS", max_ma: 500 },
    regulators: [
      { in_pin: "VSYS", out_pin: "3V3" },
      { in_pin: "VBUS", out_pin: "3V3" },
    ],
    bridges: [["GND", "GND.2", "GND.3", "GND.4"]],
    pins: [
      ...[...Array.from({ length: 23 }, (_, n) => n), 26, 27, 28].map(pico),
      pwrIn("VSYS", [1.8, 5.5], 0),
      pwrIn("VBUS", [4.5, 5.5], 0),
      pwrOut("3V3", 3.3, 300, { aliases: ["3V3(OUT)", "3.3V"] }),
      gnd("GND"),
      gnd("GND.2"),
      gnd("GND.3"),
      gnd("GND.4"),
      input("RUN", 3.6),
      nc("3V3_EN"),
      nc("ADC_VREF"),
    ],
  },
});

export const MCU_PARTS: CatalogPartInput[] = [arduinoUno, arduinoNano, arduinoMega, esp32DevkitV1, nodemcuV3, raspberryPiPico];
