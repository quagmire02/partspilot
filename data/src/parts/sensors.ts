import type { CatalogPartInput } from "@partspilot/shared";
import { analogFrom, bidir, bidirFrom, gnd, i2c, input, nc, output, outputFrom, part, passive, pwrIn } from "../pins";

export const hcsr04 = part({
  id: "hc-sr04-ultrasonic",
  name: "HC-SR04 Ultrasonic Distance Sensor",
  category: "sensor",
  buy_query: "HC-SR04 ultrasonic sensor",
  aliases: ["HC-SR04", "HCSR04", "ultrasonic sensor", "ultrasonic distance sensor", "sonar sensor"],
  profile: {
    role: "sensor",
    pins: [
      pwrIn("VCC", [4.5, 5.5], 15),
      input("TRIG", 5.5, { aliases: ["Trig", "TRIGGER"] }),
      output("ECHO", 5, { aliases: ["Echo"] }),
      gnd("GND"),
    ],
    wokwi: { element: "wokwi-hc-sr04" },
  },
});

export const pirHcsr501 = part({
  id: "hc-sr501-pir",
  name: "HC-SR501 PIR Motion Sensor",
  category: "sensor",
  buy_query: "HC-SR501 PIR motion sensor",
  aliases: ["HC-SR501", "PIR sensor", "motion sensor", "PIR motion sensor", "infrared motion sensor"],
  profile: {
    role: "sensor",
    pins: [pwrIn("VCC", [4.5, 20], 1), output("OUT", 3.3, { aliases: ["SIG"] }), gnd("GND")],
    wokwi: { element: "wokwi-pir-motion-sensor" },
  },
});

export const dht22 = part({
  id: "dht22-sensor",
  name: "DHT22 (AM2302) Temperature & Humidity Sensor",
  category: "sensor",
  buy_query: "DHT22 AM2302 temperature humidity sensor",
  aliases: ["DHT22", "AM2302", "white humidity sensor", "temperature humidity sensor DHT22"],
  profile: {
    role: "sensor",
    pins: [
      pwrIn("VCC", [3.3, 6], 2, { aliases: ["+", "VDD"] }),
      bidirFrom("DATA", "VCC", 6, { aliases: ["SDA", "OUT", "DAT"], bus: "onewire" }),
      nc("NC"),
      gnd("GND", { aliases: ["-"] }),
    ],
    wokwi: { element: "wokwi-dht22", pin_map: { DATA: "SDA" } },
  },
});

export const dht11 = part({
  id: "dht11-module",
  name: "DHT11 Temperature & Humidity Sensor Module",
  category: "sensor",
  buy_query: "DHT11 temperature humidity sensor module",
  aliases: ["DHT11", "blue humidity sensor", "KY-015", "temperature humidity sensor DHT11"],
  profile: {
    role: "sensor",
    pins: [
      pwrIn("VCC", [3.3, 5.5], 2, { aliases: ["+"] }),
      bidirFrom("DATA", "VCC", 5.5, { aliases: ["S", "OUT", "DAT"], bus: "onewire" }),
      gnd("GND", { aliases: ["-"] }),
    ],
    wokwi: { element: "wokwi-dht22", pin_map: { DATA: "SDA" } },
  },
});

export const ds18b20 = part({
  id: "ds18b20-waterproof",
  name: "DS18B20 Waterproof Temperature Probe",
  category: "sensor",
  manufacturer: "Maxim",
  buy_query: "DS18B20 waterproof temperature sensor probe",
  aliases: ["DS18B20", "temperature probe", "waterproof temperature sensor", "18B20"],
  profile: {
    role: "sensor",
    pins: [
      pwrIn("VDD", [3, 5.5], 2, { aliases: ["VCC", "red"] }),
      bidirFrom("DQ", "VDD", 5.5, { aliases: ["DATA", "yellow"], bus: "onewire" }),
      gnd("GND", { aliases: ["black"] }),
    ],
  },
});

export const soilCapacitive = part({
  id: "soil-moisture-capacitive-v1-2",
  name: "Capacitive Soil Moisture Sensor v1.2",
  category: "sensor",
  buy_query: "capacitive soil moisture sensor v1.2",
  aliases: ["soil moisture sensor", "capacitive soil sensor", "Capacitive Soil Moisture Sensor v1.2", "moisture sensor"],
  profile: {
    role: "sensor",
    pins: [pwrIn("VCC", [3.3, 5.5], 5), gnd("GND"), { name: "AOUT", kind: "analog_out", logic_v: 3, requires: ["adc"], aliases: ["AO", "A0", "SIG"] }],
  },
});

export const ldrModule = part({
  id: "ldr-light-sensor-module",
  name: "LDR Light Sensor Module (LM393)",
  category: "sensor",
  buy_query: "LDR photoresistor light sensor module LM393",
  aliases: ["light sensor module", "photoresistor module", "LDR module", "KY-018", "light dependent resistor module"],
  profile: {
    role: "sensor",
    pins: [pwrIn("VCC", [3.3, 5], 5), gnd("GND"), outputFrom("DO", "VCC", { aliases: ["D0"] }), analogFrom("AO", "VCC", { aliases: ["A0"] })],
    wokwi: { element: "wokwi-photoresistor-sensor" },
  },
});

export const ldr = part({
  id: "ldr-photoresistor-gl5528",
  name: "GL5528 Photoresistor (LDR)",
  category: "sensor",
  buy_query: "GL5528 photoresistor LDR",
  aliases: ["photoresistor", "LDR", "GL5528", "light dependent resistor", "photocell"],
  profile: { role: "passive", pins: [passive("1"), passive("2")] },
});

export const potentiometer = part({
  id: "potentiometer-10k",
  name: "10 kΩ Rotary Potentiometer",
  category: "input",
  buy_query: "10k potentiometer",
  aliases: ["potentiometer", "10k pot", "pot", "knob", "B10K", "rotary potentiometer"],
  profile: {
    role: "input_device",
    pins: [passive("VCC", { aliases: ["1", "end1"] }), passive("SIG", { aliases: ["W", "wiper", "2"], requires: ["adc"] }), passive("GND", { aliases: ["3", "end2"] })],
    wokwi: { element: "wokwi-potentiometer" },
  },
});

export const mpu6050 = part({
  id: "mpu6050-gy521",
  name: "MPU-6050 Accelerometer/Gyro Module (GY-521)",
  category: "sensor",
  buy_query: "MPU6050 GY-521 module",
  aliases: ["MPU6050", "MPU-6050", "GY-521", "accelerometer gyroscope", "6-axis IMU"],
  profile: {
    role: "sensor",
    pins: [
      pwrIn("VCC", [3.3, 5], 4),
      gnd("GND"),
      bidir("SCL", 3.3, 5.5, i2c),
      bidir("SDA", 3.3, 5.5, i2c),
      bidir("XDA", 3.3, 3.6),
      bidir("XCL", 3.3, 3.6),
      input("AD0", 5.5),
      output("INT", 3.3),
    ],
    wokwi: { element: "wokwi-mpu6050" },
  },
});

export const bmp280 = part({
  id: "bmp280-3v3-module",
  name: "BMP280 Pressure Sensor Module (3.3 V)",
  category: "sensor",
  buy_query: "BMP280 module 3.3V GY-BMP280",
  aliases: ["BMP280", "GY-BMP280", "barometer sensor", "pressure sensor"],
  profile: {
    role: "sensor",
    pins: [pwrIn("VCC", [1.8, 3.6], 1), gnd("GND"), bidir("SCL", 3.3, 3.6, i2c), bidir("SDA", 3.3, 3.6, i2c), input("CSB", 3.6), input("SDO", 3.6)],
  },
});

export const irReceiver = part({
  id: "ir-receiver-vs1838b",
  name: "VS1838B Infrared Receiver",
  category: "sensor",
  buy_query: "VS1838B IR receiver",
  aliases: ["VS1838B", "IR receiver", "infrared receiver", "TSOP1838", "1838 IR"],
  profile: {
    role: "sensor",
    pins: [outputFrom("OUT", "VCC", { aliases: ["DAT", "S", "Y"] }), gnd("GND", { aliases: ["G", "-"] }), pwrIn("VCC", [2.7, 5.5], 1, { aliases: ["R", "+"] })],
    wokwi: { element: "wokwi-ir-receiver", pin_map: { OUT: "DAT" } },
  },
});

export const irRemote = part({
  id: "ir-remote-nec-21key",
  name: "21-Key IR Remote Control (NEC)",
  category: "input",
  buy_query: "21 key IR remote control NEC",
  aliases: ["IR remote", "remote control", "infrared remote", "car mp3 remote"],
  profile: { role: "input_device", pins: [] },
});

export const rc522 = part({
  id: "rfid-rc522",
  name: "RFID-RC522 13.56 MHz Reader Module",
  category: "sensor",
  buy_query: "RC522 RFID module 13.56MHz",
  aliases: ["RC522", "MFRC522", "RFID reader", "RFID-RC522", "NFC reader 13.56MHz"],
  profile: {
    role: "sensor",
    pins: [
      pwrIn("3.3V", [3, 3.6], 26, { aliases: ["3V3", "VCC"] }),
      input("RST", 3.6),
      gnd("GND"),
      output("IRQ", 3.3),
      output("MISO", 3.3, { requires: ["spi_miso"] }),
      input("MOSI", 3.6, { requires: ["spi_mosi"] }),
      input("SCK", 3.6, { requires: ["spi_sck"] }),
      input("SDA", 3.6, { aliases: ["SS", "NSS", "CS"] }),
    ],
  },
});

export const ky040 = part({
  id: "rotary-encoder-ky040",
  name: "KY-040 Rotary Encoder Module",
  category: "input",
  buy_query: "KY-040 rotary encoder module",
  aliases: ["KY-040", "rotary encoder", "encoder module"],
  profile: {
    role: "input_device",
    pins: [outputFrom("CLK", "+"), outputFrom("DT", "+"), passive("SW"), pwrIn("+", [3.3, 5.5], 1, { aliases: ["VCC"] }), gnd("GND")],
    wokwi: { element: "wokwi-ky-040", pin_map: { "+": "VCC" } },
  },
});

export const joystick = part({
  id: "joystick-ky023",
  name: "KY-023 Dual-Axis Joystick Module",
  category: "input",
  buy_query: "KY-023 joystick module",
  aliases: ["joystick", "KY-023", "thumb joystick", "analog joystick", "PS2 joystick module"],
  profile: {
    role: "input_device",
    pins: [
      gnd("GND"),
      pwrIn("+5V", [3.3, 5.5], 1, { aliases: ["VCC", "5V"] }),
      analogFrom("VRx", "+5V", { aliases: ["VRX", "X"] }),
      analogFrom("VRy", "+5V", { aliases: ["VRY", "Y"] }),
      passive("SW", { aliases: ["KEY"] }),
    ],
    wokwi: { element: "wokwi-analog-joystick", pin_map: { "+5V": "VCC", VRx: "HORZ", VRy: "VERT", SW: "SEL" } },
  },
});

export const pushbutton = part({
  id: "tactile-pushbutton-6mm",
  name: "6×6 mm Tactile Push Button",
  category: "input",
  buy_query: "6x6mm tactile push button",
  aliases: ["push button", "pushbutton", "tactile switch", "button", "momentary switch"],
  profile: {
    role: "input_device",
    bridges: [
      ["1.l", "1.r"],
      ["2.l", "2.r"],
    ],
    pins: [passive("1.l", { aliases: ["1"] }), passive("1.r"), passive("2.l", { aliases: ["2"] }), passive("2.r")],
    wokwi: { element: "wokwi-pushbutton" },
  },
});

export const keypad = part({
  id: "membrane-keypad-4x4",
  name: "4×4 Membrane Keypad",
  category: "input",
  buy_query: "4x4 membrane keypad",
  aliases: ["keypad", "membrane keypad", "4x4 keypad", "matrix keypad"],
  profile: {
    role: "input_device",
    pins: ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"].map((n) => passive(n)),
    wokwi: { element: "wokwi-membrane-keypad" },
  },
});

export const tcrt5000 = part({
  id: "tcrt5000-line-sensor",
  name: "TCRT5000 IR Line Tracking Sensor Module",
  category: "sensor",
  buy_query: "TCRT5000 line tracking sensor module",
  aliases: ["TCRT5000", "line sensor", "line tracking sensor", "IR reflective sensor", "line follower sensor"],
  profile: {
    role: "sensor",
    pins: [pwrIn("VCC", [3.3, 5], 20), gnd("GND"), outputFrom("DO", "VCC", { aliases: ["D0", "OUT"] }), analogFrom("AO", "VCC", { aliases: ["A0"] })],
  },
});

export const SENSOR_PARTS: CatalogPartInput[] = [
  tcrt5000,
  hcsr04,
  pirHcsr501,
  dht22,
  dht11,
  ds18b20,
  soilCapacitive,
  ldrModule,
  ldr,
  potentiometer,
  mpu6050,
  bmp280,
  irReceiver,
  irRemote,
  rc522,
  ky040,
  joystick,
  pushbutton,
  keypad,
];
