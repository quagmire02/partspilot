import type { CatalogPartInput } from "@partspilot/shared";
import { contact, driverOut, gnd, input, load, part, pwrIn, pwrOut } from "../pins";

export const l298nModule = part({
  id: "l298n-motor-driver",
  name: "L298N Dual H-Bridge Motor Driver Module",
  category: "motor_driver",
  buy_query: "L298N motor driver module",
  aliases: ["L298N", "L298N module", "L298N motor driver", "dual H-bridge", "red motor driver board L298N", "L298"],
  profile: {
    role: "driver",
    self_draw_ma: 36,
    passes_load_current: ["12V"],
    regulators: [{ in_pin: "12V", out_pin: "5V" }],
    pins: [
      pwrIn("12V", [5, 35], 0, { aliases: ["VS", "VMS", "+12V", "VCC"] }),
      gnd("GND"),
      pwrOut("5V", 5, 400, { aliases: ["+5V", "VSS"] }),
      input("ENA", 7, { requires: ["pwm"] }),
      input("IN1", 7),
      input("IN2", 7),
      input("IN3", 7),
      input("IN4", 7),
      input("ENB", 7, { requires: ["pwm"] }),
      driverOut("OUT1", 2000, "12V"),
      driverOut("OUT2", 2000, "12V"),
      driverOut("OUT3", 2000, "12V"),
      driverOut("OUT4", 2000, "12V"),
    ],
  },
});

export const l293d = part({
  id: "l293d-motor-driver-ic",
  name: "L293D Quadruple Half-H Motor Driver IC",
  category: "motor_driver",
  manufacturer: "Texas Instruments",
  buy_query: "L293D motor driver IC DIP-16",
  aliases: ["L293D", "L293", "L293DNE"],
  profile: {
    role: "driver",
    self_draw_ma: 24,
    passes_load_current: ["VCC2"],
    bridges: [["GND", "GND.2", "GND.3", "GND.4"]],
    pins: [
      input("EN1,2", 7, { aliases: ["EN12", "EN1", "ENA"], requires: ["pwm"] }),
      input("1A", 7, { aliases: ["IN1"] }),
      driverOut("1Y", 600, "VCC2", { aliases: ["OUT1"] }),
      gnd("GND"),
      gnd("GND.2"),
      driverOut("2Y", 600, "VCC2", { aliases: ["OUT2"] }),
      input("2A", 7, { aliases: ["IN2"] }),
      pwrIn("VCC2", [4.5, 36], 0, { aliases: ["VS", "VCC2 (motor)"] }),
      input("EN3,4", 7, { aliases: ["EN34", "EN2", "ENB"], requires: ["pwm"] }),
      input("3A", 7, { aliases: ["IN3"] }),
      driverOut("3Y", 600, "VCC2", { aliases: ["OUT3"] }),
      gnd("GND.3"),
      gnd("GND.4"),
      driverOut("4Y", 600, "VCC2", { aliases: ["OUT4"] }),
      input("4A", 7, { aliases: ["IN4"] }),
      pwrIn("VCC1", [4.5, 7], 0, { aliases: ["VSS", "VCC1 (logic)"] }),
    ],
  },
});

export const tb6612fng = part({
  id: "tb6612fng-motor-driver",
  name: "TB6612FNG Dual Motor Driver Module",
  category: "motor_driver",
  buy_query: "TB6612FNG dual motor driver module",
  aliases: ["TB6612FNG", "TB6612", "SparkFun motor driver TB6612FNG"],
  profile: {
    role: "driver",
    self_draw_ma: 2,
    passes_load_current: ["VM"],
    bridges: [["GND", "GND.2", "GND.3"]],
    pins: [
      pwrIn("VM", [4.5, 13.5], 0, { aliases: ["VM1", "VMOT"] }),
      pwrIn("VCC", [2.7, 5.5], 2),
      gnd("GND"),
      gnd("GND.2"),
      gnd("GND.3"),
      driverOut("AO1", 1200, "VM", { aliases: ["A01"] }),
      driverOut("AO2", 1200, "VM", { aliases: ["A02"] }),
      driverOut("BO1", 1200, "VM", { aliases: ["B01"] }),
      driverOut("BO2", 1200, "VM", { aliases: ["B02"] }),
      input("PWMA", 5.5, { requires: ["pwm"] }),
      input("AIN1", 5.5),
      input("AIN2", 5.5),
      input("STBY", 5.5),
      input("BIN1", 5.5),
      input("BIN2", 5.5),
      input("PWMB", 5.5, { requires: ["pwm"] }),
    ],
  },
});

export const a4988 = part({
  id: "a4988-stepper-driver",
  name: "A4988 Stepper Motor Driver Module",
  category: "motor_driver",
  manufacturer: "Pololu",
  buy_query: "A4988 stepper motor driver module",
  aliases: ["A4988", "Pololu A4988", "stepstick A4988", "A4988 driver"],
  profile: {
    role: "driver",
    self_draw_ma: 8,
    passes_load_current: ["VMOT"],
    bridges: [["GND", "GND.2"]],
    pins: [
      pwrIn("VMOT", [8, 35], 0),
      gnd("GND"),
      driverOut("2B", 1500, "VMOT"),
      driverOut("2A", 1500, "VMOT"),
      driverOut("1A", 1500, "VMOT"),
      driverOut("1B", 1500, "VMOT"),
      pwrIn("VDD", [3, 5.5], 5),
      gnd("GND.2"),
      input("ENABLE", 5.5, { aliases: ["EN"] }),
      input("MS1", 5.5),
      input("MS2", 5.5),
      input("MS3", 5.5),
      input("RESET", 5.5, { aliases: ["RST"] }),
      input("SLEEP", 5.5, { aliases: ["SLP"] }),
      input("STEP", 5.5),
      input("DIR", 5.5),
    ],
  },
});

export const uln2003Board = part({
  id: "uln2003-stepper-driver-board",
  name: "ULN2003 Stepper Motor Driver Board",
  category: "motor_driver",
  buy_query: "ULN2003 stepper driver board 28BYJ-48",
  aliases: ["ULN2003", "ULN2003A driver board", "ULN2003 board", "stepper driver ULN2003"],
  profile: {
    role: "driver",
    self_draw_ma: 5,
    passes_load_current: ["+"],
    pins: [
      input("IN1", 30),
      input("IN2", 30),
      input("IN3", 30),
      input("IN4", 30),
      pwrIn("+", [5, 12], 0, { aliases: ["VCC", "5-12V"] }),
      gnd("-", { aliases: ["GND"] }),
      driverOut("OUT1", 500, undefined, { aliases: ["A"] }),
      driverOut("OUT2", 500, undefined, { aliases: ["B"] }),
      driverOut("OUT3", 500, undefined, { aliases: ["C"] }),
      driverOut("OUT4", 500, undefined, { aliases: ["D"] }),
    ],
  },
});

export const irlz44n = part({
  id: "irlz44n-mosfet",
  name: "IRLZ44N Logic-Level N-Channel MOSFET",
  category: "other",
  manufacturer: "Infineon",
  buy_query: "IRLZ44N logic level MOSFET",
  aliases: ["IRLZ44N", "IRLZ44", "logic level MOSFET", "N-channel MOSFET TO-220"],
  profile: {
    role: "driver",
    pins: [
      input("G", 16, { aliases: ["GATE"] }),
      driverOut("D", 10000, undefined, { aliases: ["DRAIN"] }),
      gnd("S", { aliases: ["SOURCE"] }),
    ],
  },
});

export const relayModule = part({
  id: "relay-module-5v-1ch",
  name: "5V 1-Channel Relay Module (SRD-05VDC-SL-C)",
  category: "relay",
  buy_query: "5V 1 channel relay module SRD-05VDC-SL-C",
  aliases: ["relay module", "5V relay module", "SRD-05VDC-SL-C module", "1 channel relay", "Songle relay module", "KY-019"],
  profile: {
    role: "module",
    pins: [
      pwrIn("VCC", [4.5, 5.5], 75, { aliases: ["+", "DC+"] }),
      gnd("GND", { aliases: ["-", "DC-"] }),
      input("IN", 5.5, { aliases: ["S", "SIG"], draw_ma: 3 }),
      contact("COM"),
      contact("NO"),
      contact("NC"),
    ],
  },
});

export const relayBare = part({
  id: "relay-srd-05vdc-bare",
  name: "SRD-05VDC-SL-C 5V Relay (bare)",
  category: "relay",
  manufacturer: "Songle",
  buy_query: "SRD-05VDC-SL-C relay",
  aliases: ["SRD-05VDC-SL-C", "Songle relay", "5V relay", "blue relay"],
  profile: {
    role: "actuator",
    load: { kind: "relay_coil", current_ma: 72 },
    pins: [load("COIL1"), load("COIL2"), contact("COM"), contact("NO"), contact("NC")],
  },
});

// --- loads -------------------------------------------------------------------

export const ttMotor = part({
  id: "tt-dc-gear-motor",
  name: "TT DC Gear Motor 3-6V (1:48)",
  category: "motor",
  buy_query: "TT DC gear motor 3-6V 1:48",
  aliases: ["TT motor", "yellow gear motor", "DC gear motor", "robot car motor", "TT gearmotor", "1:48 gear motor"],
  profile: {
    role: "actuator",
    load: { kind: "motor", current_ma: 250, stall_ma: 1500 },
    pins: [load("M+", { aliases: ["+", "1"] }), load("M-", { aliases: ["-", "2"] })],
  },
});

export const motor130 = part({
  id: "dc-motor-130",
  name: "130 DC Hobby Motor 3-6V",
  category: "motor",
  buy_query: "130 DC motor 3V 6V",
  aliases: ["130 motor", "DC motor", "hobby motor", "small DC motor", "RF-300 motor"],
  profile: {
    role: "actuator",
    load: { kind: "motor", current_ma: 300, stall_ma: 2000 },
    pins: [load("M+", { aliases: ["+", "1"] }), load("M-", { aliases: ["-", "2"] })],
  },
});

export const sg90 = part({
  id: "sg90-micro-servo",
  name: "SG90 9g Micro Servo",
  category: "servo",
  manufacturer: "TowerPro",
  buy_query: "SG90 micro servo 9g",
  aliases: ["SG90", "micro servo", "9g servo", "TowerPro SG90", "blue servo"],
  profile: {
    role: "actuator",
    pins: [
      input("PWM", 6, { aliases: ["SIG", "S", "signal", "orange"] }),
      pwrIn("V+", [4.8, 6], 200, { aliases: ["VCC", "+", "red"] }),
      gnd("GND", { aliases: ["-", "brown"] }),
    ],
    wokwi: { element: "wokwi-servo" },
  },
});

export const mg996r = part({
  id: "mg996r-servo",
  name: "MG996R High-Torque Metal Gear Servo",
  category: "servo",
  manufacturer: "TowerPro",
  buy_query: "MG996R servo",
  aliases: ["MG996R", "MG995", "metal gear servo", "high torque servo"],
  profile: {
    role: "actuator",
    pins: [
      input("PWM", 7.2, { aliases: ["SIG", "S", "signal"] }),
      pwrIn("V+", [4.8, 7.2], 500, { aliases: ["VCC", "+"] }),
      gnd("GND", { aliases: ["-"] }),
    ],
    wokwi: { element: "wokwi-servo" },
  },
});

export const stepper28byj = part({
  id: "stepper-28byj-48",
  name: "28BYJ-48 5V Stepper Motor",
  category: "motor",
  buy_query: "28BYJ-48 5V stepper motor",
  aliases: ["28BYJ-48", "28BYJ48", "5V stepper motor", "geared stepper"],
  profile: {
    role: "actuator",
    load: { kind: "motor", current_ma: 240 },
    pins: [
      load("A", { aliases: ["IN1", "blue"] }),
      load("B", { aliases: ["IN2", "pink"] }),
      load("C", { aliases: ["IN3", "yellow"] }),
      load("D", { aliases: ["IN4", "orange"] }),
      load("VCC", { aliases: ["+", "red"] }),
    ],
  },
});

export const nema17 = part({
  id: "nema17-stepper-motor",
  name: "NEMA 17 Bipolar Stepper Motor (17HS4401)",
  category: "motor",
  buy_query: "NEMA 17 stepper motor 17HS4401",
  aliases: ["NEMA17", "NEMA 17", "17HS4401", "bipolar stepper"],
  profile: {
    role: "actuator",
    load: { kind: "motor", current_ma: 1000 },
    pins: [load("A+"), load("A-"), load("B+"), load("B-")],
    wokwi: { element: "wokwi-stepper-motor" },
  },
});

export const solenoid12v = part({
  id: "solenoid-12v-push-pull",
  name: "12V Push-Pull Solenoid",
  category: "motor",
  buy_query: "12V push pull solenoid",
  aliases: ["solenoid", "12V solenoid", "push pull solenoid", "solenoid lock"],
  profile: {
    role: "actuator",
    load: { kind: "solenoid", current_ma: 500 },
    pins: [load("+"), load("-")],
  },
});

export const pump5v = part({
  id: "mini-water-pump-5v",
  name: "Mini Submersible Water Pump 3-5V",
  category: "motor",
  buy_query: "mini submersible water pump 3-5V",
  aliases: ["water pump", "submersible pump", "mini pump", "DC pump"],
  profile: {
    role: "actuator",
    load: { kind: "pump", current_ma: 200 },
    pins: [load("+"), load("-")],
  },
});

export const fan5v = part({
  id: "dc-fan-5v-40mm",
  name: "5V DC Cooling Fan 40mm",
  category: "motor",
  buy_query: "5V DC fan 40mm",
  aliases: ["5V fan", "cooling fan", "DC fan", "40mm fan"],
  profile: {
    role: "actuator",
    load: { kind: "fan", current_ma: 150 },
    pins: [load("+"), load("-")],
  },
});

export const led1w = part({
  id: "led-1w-white-star",
  name: "1W High-Power White LED (star PCB)",
  category: "led",
  buy_query: "1W high power white LED star",
  aliases: ["1W LED", "high power LED", "star LED", "power LED"],
  profile: {
    role: "actuator",
    load: { kind: "high_current_led", current_ma: 350 },
    pins: [load("+"), load("-")],
  },
});

export const DRIVER_AND_LOAD_PARTS: CatalogPartInput[] = [
  l298nModule,
  l293d,
  tb6612fng,
  a4988,
  uln2003Board,
  irlz44n,
  relayModule,
  relayBare,
  ttMotor,
  motor130,
  sg90,
  mg996r,
  stepper28byj,
  nema17,
  solenoid12v,
  pump5v,
  fan5v,
  led1w,
];
