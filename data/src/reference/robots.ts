import { cpp, wires, type ReferenceProject } from "./dsl";

/** Shared L298N + 2 TT motor drivetrain on a 7.4 V 2×18650 pack (Uno powered from VIN). */
const UNO_DRIVETRAIN = [
  "B1.+ > U2.12V",
  "B1.+ > U1.VIN",
  "B1.- > U2.GND",
  "U2.GND > U1.GND",
  "U1.D5 > U2.ENA",
  "U1.D7 > U2.IN1",
  "U1.D8 > U2.IN2",
  "U1.D11 > U2.IN3",
  "U1.D12 > U2.IN4",
  "U1.D6 > U2.ENB",
  "U2.OUT1 > M1.M+",
  "U2.OUT2 > M1.M-",
  "U2.OUT3 > M2.M+",
  "U2.OUT4 > M2.M-",
];

const DRIVETRAIN_PARTS = [
  { ref: "U2", part_id: "l298n-motor-driver", purpose: "drives both motors" },
  { ref: "M1", part_id: "tt-dc-gear-motor", purpose: "left wheel" },
  { ref: "M2", part_id: "tt-dc-gear-motor", purpose: "right wheel" },
  { ref: "B1", part_id: "battery-holder-2x18650", purpose: "7.4 V power for motors and Uno" },
  { ref: "X1", part_id: "robot-car-chassis-2wd", purpose: "frame and wheels" },
  { ref: "W1", part_id: "jumper-wires-male-female", purpose: "wiring" },
];

const DRIVE_FN = cpp`
const int ENA = 5, IN1 = 7, IN2 = 8, IN3 = 11, IN4 = 12, ENB = 6;

void drive(int l1, int l2, int r1, int r2) {
  digitalWrite(IN1, l1); digitalWrite(IN2, l2);
  digitalWrite(IN3, r1); digitalWrite(IN4, r2);
}
void forward()  { drive(HIGH, LOW, HIGH, LOW); }
void backward() { drive(LOW, HIGH, LOW, HIGH); }
void left()     { drive(LOW, HIGH, HIGH, LOW); }
void right()    { drive(HIGH, LOW, LOW, HIGH); }
void stopCar()  { drive(LOW, LOW, LOW, LOW); }

void setupMotors(int speed) {
  int pins[] = {ENA, IN1, IN2, IN3, IN4, ENB};
  for (int p : pins) pinMode(p, OUTPUT);
  analogWrite(ENA, speed);
  analogWrite(ENB, speed);
  stopCar();
}
`;

const DRIVETRAIN_STEPS = [
  "Screw the two TT motors, wheels and caster onto the chassis.",
  "Mount the Uno, the L298N and the 2×18650 battery holder on the chassis.",
  "Wire the left motor to L298N OUT1/OUT2 and the right motor to OUT3/OUT4.",
  "Battery + to L298N 12V and to Uno VIN; battery − to L298N GND, and L298N GND to Uno GND (common ground).",
  "Remove the ENA/ENB jumpers on the L298N, then wire ENA→5, IN1→7, IN2→8, IN3→11, IN4→12, ENB→6.",
];

const BATTERY_NOTES = [
  "Use protected 18650 cells, insert them with the correct polarity, and never short the battery leads.",
  "Lift the wheels off the table for the first test.",
];

export const ROBOT_PROJECTS: ReferenceProject[] = [
  {
    id: "rc-car-bluetooth-uno",
    title: "Bluetooth RC Car",
    goal_examples: [
      "Can I build an RC car?",
      "remote control car",
      "control a car from my phone",
      "bluetooth car",
      "build a robot car I can drive",
    ],
    plan: {
      title: "Bluetooth RC Car",
      summary: "A two-wheel car you drive from a phone app over Bluetooth (HC-05).",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "battery",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        ...DRIVETRAIN_PARTS,
        { ref: "U3", part_id: "hc-05-bluetooth", purpose: "Bluetooth link to the phone" },
        { ref: "DIV1", part_id: "voltage-divider-5v-3v3", purpose: "drops Uno TX (5 V) to 3.3 V for HC-05 RXD" },
      ],
      connections: wires(
        ...UNO_DRIVETRAIN,
        "U1.5V > U3.VCC",
        "U1.GND.2 > U3.GND",
        "U3.TXD > U1.D2",
        "U1.D3 > DIV1.IN",
        "DIV1.OUT > U3.RXD",
        "DIV1.GND > U1.GND.3",
      ),
      steps: [
        ...DRIVETRAIN_STEPS,
        "HC-05: VCC→5V, GND→GND, TXD→pin 2.",
        "Make the divider: pin 3 → 1 kΩ → junction → 2 kΩ → GND; connect the junction to HC-05 RXD.",
        "Upload the sketch with the battery switched off, then switch it on.",
        "Pair the phone with HC-05 (PIN 1234) and use any 'Bluetooth RC controller' app that sends F/B/L/R/S.",
      ],
      code: {
        filename: "bluetooth_car.ino",
        source: cpp`
#include <SoftwareSerial.h>

SoftwareSerial bt(2, 3);  // RX, TX (TX goes through the divider)
${DRIVE_FN}
void setup() {
  setupMotors(200);
  bt.begin(9600);
}

void loop() {
  if (!bt.available()) return;
  switch (bt.read()) {
    case 'F': forward(); break;
    case 'B': backward(); break;
    case 'L': left(); break;
    case 'R': right(); break;
    default: stopCar(); break;
  }
}
`,
      },
      libraries: [{ name: "SoftwareSerial", install_hint: "Built into the Arduino IDE" }],
      safety_notes: BATTERY_NOTES,
    },
  },
  {
    id: "rc-car-ir-remote-uno",
    title: "IR Remote-Controlled Car",
    goal_examples: ["RC car with a remote", "car controlled by TV remote", "infrared remote car"],
    plan: {
      title: "IR Remote-Controlled Car",
      summary: "A two-wheel car driven with the number keys of a 21-key IR remote.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "battery",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        ...DRIVETRAIN_PARTS,
        { ref: "U3", part_id: "ir-receiver-vs1838b", purpose: "IR receiver" },
        { ref: "RC1", part_id: "ir-remote-nec-21key", purpose: "remote" },
      ],
      connections: wires(...UNO_DRIVETRAIN, "U1.5V > U3.VCC", "U3.GND > U1.GND.2", "U3.OUT > U1.D2"),
      steps: [
        ...DRIVETRAIN_STEPS,
        "IR receiver: VCC→5V, GND→GND, OUT→pin 2; face it forward.",
        "Upload the sketch; use 2/8/4/6 to drive and 5 to stop.",
      ],
      code: {
        filename: "ir_car.ino",
        source: cpp`
#include <IRremote.hpp>
${DRIVE_FN}
void setup() {
  setupMotors(200);
  IrReceiver.begin(2, DISABLE_LED_FEEDBACK);
}

void loop() {
  if (!IrReceiver.decode()) return;
  uint8_t cmd = IrReceiver.decodedIRData.command;
  IrReceiver.resume();
  switch (cmd) {
    case 0x18: forward(); break;   // 2
    case 0x52: backward(); break;  // 8
    case 0x08: left(); break;      // 4
    case 0x5A: right(); break;     // 6
    case 0x1C: stopCar(); break;   // 5
  }
}
`,
      },
      libraries: [{ name: "IRremote", install_hint: "Library Manager: IRremote (v4)" }],
      safety_notes: BATTERY_NOTES,
    },
  },
  {
    id: "rc-car-wifi-esp32",
    title: "Wi-Fi RC Car (ESP32)",
    goal_examples: ["wifi car", "car controlled from a web page", "ESP32 RC car", "drive a car from my browser"],
    plan: {
      title: "Wi-Fi RC Car (ESP32)",
      summary: "The ESP32 creates a Wi-Fi hotspot with a web page to drive the car.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "battery",
      parts: [
        { ref: "U1", part_id: "esp32-devkit-v1", purpose: "controller + Wi-Fi" },
        ...DRIVETRAIN_PARTS,
      ],
      connections: wires(
        "B1.+ > U2.12V",
        "B1.- > U2.GND",
        "U2.5V > U1.VIN",
        "U2.GND > U1.GND",
        "U1.D13 > U2.ENA",
        "U1.D27 > U2.IN1",
        "U1.D26 > U2.IN2",
        "U1.D25 > U2.IN3",
        "U1.D33 > U2.IN4",
        "U1.D32 > U2.ENB",
        "U2.OUT1 > M1.M+",
        "U2.OUT2 > M1.M-",
        "U2.OUT3 > M2.M+",
        "U2.OUT4 > M2.M-",
      ),
      steps: [
        "Assemble the chassis with both motors and mount the ESP32, L298N and battery holder.",
        "Motors to OUT1/OUT2 and OUT3/OUT4.",
        "Battery + to L298N 12V, battery − to L298N GND; L298N 5V to ESP32 VIN and L298N GND to ESP32 GND.",
        "Remove the ENA/ENB jumpers and wire ENA→D13, IN1→D27, IN2→D26, IN3→D25, IN4→D33, ENB→D32.",
        "Upload over USB with the battery off. Then power on, join Wi-Fi 'PartsPilot-Car' (password drive1234) and open 192.168.4.1.",
      ],
      code: {
        filename: "wifi_car.ino",
        source: cpp`
#include <WiFi.h>
#include <WebServer.h>

const int ENA = 13, IN1 = 27, IN2 = 26, IN3 = 25, IN4 = 33, ENB = 32;
WebServer server(80);

const char PAGE[] = R"html(<!doctype html><meta name=viewport content="width=device-width">
<style>a{display:inline-block;padding:24px;margin:6px;background:#246;color:#fff;font:24px sans-serif;text-decoration:none}</style>
<a href=/f>Forward</a><br><a href=/l>Left</a><a href=/s>Stop</a><a href=/r>Right</a><br><a href=/b>Back</a>)html";

void drive(int a, int b, int c, int d) {
  digitalWrite(IN1, a); digitalWrite(IN2, b); digitalWrite(IN3, c); digitalWrite(IN4, d);
}

void reply(int a, int b, int c, int d) {
  drive(a, b, c, d);
  server.send(200, "text/html", PAGE);
}

void setup() {
  int pins[] = {IN1, IN2, IN3, IN4};
  for (int p : pins) pinMode(p, OUTPUT);
  ledcAttach(ENA, 1000, 8);   // ESP32 Arduino core 3.x
  ledcAttach(ENB, 1000, 8);
  ledcWrite(ENA, 200);
  ledcWrite(ENB, 200);
  WiFi.softAP("PartsPilot-Car", "drive1234");
  server.on("/", [] { reply(LOW, LOW, LOW, LOW); });
  server.on("/s", [] { reply(LOW, LOW, LOW, LOW); });
  server.on("/f", [] { reply(HIGH, LOW, HIGH, LOW); });
  server.on("/b", [] { reply(LOW, HIGH, LOW, HIGH); });
  server.on("/l", [] { reply(LOW, HIGH, HIGH, LOW); });
  server.on("/r", [] { reply(HIGH, LOW, LOW, HIGH); });
  server.begin();
}

void loop() {
  server.handleClient();
}
`,
      },
      libraries: [{ name: "ESP32 board package 3.x", install_hint: "Boards Manager: esp32 by Espressif Systems" }],
      safety_notes: BATTERY_NOTES,
    },
  },
  {
    id: "obstacle-avoiding-robot-uno",
    title: "Obstacle-Avoiding Robot",
    goal_examples: ["robot that avoids walls", "self driving robot", "obstacle avoiding car", "autonomous robot"],
    plan: {
      title: "Obstacle-Avoiding Robot",
      summary: "Drives forward and turns away when the ultrasonic sensor sees an obstacle closer than 20 cm.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "battery",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        ...DRIVETRAIN_PARTS,
        { ref: "U3", part_id: "hc-sr04-ultrasonic", purpose: "obstacle sensor" },
      ],
      connections: wires(...UNO_DRIVETRAIN, "U1.5V > U3.VCC", "U3.GND > U1.GND.2", "U1.D9 > U3.TRIG", "U1.D10 > U3.ECHO"),
      steps: [
        ...DRIVETRAIN_STEPS,
        "Mount the HC-SR04 at the front: VCC→5V, GND→GND, TRIG→9, ECHO→10.",
        "Upload with the battery off, then switch on and let it roam.",
      ],
      code: {
        filename: "obstacle_robot.ino",
        source: cpp`
${DRIVE_FN}
const int TRIG = 9, ECHO = 10;

long readCm() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 30000UL);
  return us == 0 ? 999 : us / 58;
}

void setup() {
  setupMotors(170);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
}

void loop() {
  if (readCm() < 20) {
    stopCar(); delay(200);
    backward(); delay(400);
    right(); delay(350);
  } else {
    forward();
  }
  delay(50);
}
`,
      },
      libraries: [],
      safety_notes: BATTERY_NOTES,
    },
  },
  {
    id: "line-follower-uno",
    title: "Line-Following Robot",
    goal_examples: ["line follower robot", "robot follows a black line", "track following car"],
    plan: {
      title: "Line-Following Robot",
      summary: "Two IR sensors keep the car on a black tape line.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "battery",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        ...DRIVETRAIN_PARTS,
        { ref: "U3", part_id: "tcrt5000-line-sensor", purpose: "left line sensor" },
        { ref: "U4", part_id: "tcrt5000-line-sensor", purpose: "right line sensor" },
      ],
      connections: wires(
        ...UNO_DRIVETRAIN,
        "U1.5V > U3.VCC", "U3.GND > U1.GND.2", "U3.DO > U1.D2",
        "U1.5V > U4.VCC", "U4.GND > U1.GND.2", "U4.DO > U1.D3",
      ),
      steps: [
        ...DRIVETRAIN_STEPS,
        "Mount both TCRT5000 sensors under the front, about 1 cm above the floor and 2 cm apart.",
        "Sensors: VCC→5V, GND→GND, left DO→pin 2, right DO→pin 3.",
        "Adjust each sensor's potentiometer so its LED changes over the black line.",
      ],
      code: {
        filename: "line_follower.ino",
        source: cpp`
${DRIVE_FN}
const int LEFT_SENSOR = 2, RIGHT_SENSOR = 3;  // HIGH = black line under the sensor

void setup() {
  setupMotors(150);
  pinMode(LEFT_SENSOR, INPUT);
  pinMode(RIGHT_SENSOR, INPUT);
}

void loop() {
  bool l = digitalRead(LEFT_SENSOR) == HIGH;
  bool r = digitalRead(RIGHT_SENSOR) == HIGH;
  if (l && r) stopCar();
  else if (l) left();
  else if (r) right();
  else forward();
}
`,
      },
      libraries: [],
      safety_notes: BATTERY_NOTES,
    },
  },
  {
    id: "stepper-28byj48-uno",
    title: "Geared Stepper Motor",
    goal_examples: ["stepper motor", "rotate a motor precisely", "28BYJ-48 project", "turn a dial slowly"],
    plan: {
      title: "Geared Stepper Motor",
      summary: "A 28BYJ-48 stepper turns one full revolution each way through a ULN2003 driver.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "uln2003-stepper-driver-board", purpose: "stepper driver" },
        { ref: "M1", part_id: "stepper-28byj-48", purpose: "motor" },
      ],
      connections: wires(
        "U1.D8 > U2.IN1", "U1.D9 > U2.IN2", "U1.D10 > U2.IN3", "U1.D11 > U2.IN4",
        "U1.5V > U2.+", "U2.- > U1.GND",
        "U2.OUT1 > M1.A", "U2.OUT2 > M1.B", "U2.OUT3 > M1.C", "U2.OUT4 > M1.D", "U2.+ > M1.VCC",
      ),
      steps: [
        "Plug the stepper's 5-wire connector into the ULN2003 board.",
        "Connect ULN2003 IN1–IN4 to pins 8–11.",
        "Connect ULN2003 + to 5V and − to GND.",
        "Upload the sketch.",
      ],
      code: {
        filename: "stepper.ino",
        source: cpp`
#include <Stepper.h>

const int STEPS_PER_REV = 2048;
Stepper stepper(STEPS_PER_REV, 8, 10, 9, 11);  // IN1, IN3, IN2, IN4 order for 28BYJ-48

void setup() {
  stepper.setSpeed(10);  // rpm
}

void loop() {
  stepper.step(STEPS_PER_REV);
  delay(500);
  stepper.step(-STEPS_PER_REV);
  delay(500);
}
`,
      },
      libraries: [{ name: "Stepper", install_hint: "Built into the Arduino IDE" }],
      safety_notes: [],
    },
  },
  {
    id: "nema17-a4988-uno",
    title: "NEMA 17 Stepper with A4988",
    goal_examples: ["NEMA 17 stepper", "3D printer motor", "big stepper motor", "A4988 driver project"],
    plan: {
      title: "NEMA 17 Stepper with A4988",
      summary: "Drives a NEMA 17 stepper back and forth from a 12 V adapter through an A4988.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "external",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "a4988-stepper-driver", purpose: "stepper driver" },
        { ref: "M1", part_id: "nema17-stepper-motor", purpose: "motor" },
        { ref: "PS1", part_id: "dc-adapter-12v-2a", purpose: "12 V motor supply" },
        { ref: "C1", part_id: "capacitor-100uf-25v", purpose: "decouples VMOT" },
      ],
      connections: wires(
        "PS1.+ > U2.VMOT", "PS1.- > U2.GND", "PS1.+ > U1.VIN",
        "U1.5V > U2.VDD", "U1.GND > U2.GND.2",
        "U1.D3 > U2.STEP", "U1.D4 > U2.DIR", "U2.RESET > U2.SLEEP",
        "U2.1A > M1.A+", "U2.1B > M1.A-", "U2.2A > M1.B+", "U2.2B > M1.B-",
        "C1.+ > U2.VMOT", "C1.- > U2.GND",
      ),
      steps: [
        "Set the A4988 current limit to about 1 A (Vref ≈ 0.8 V on most boards) before connecting the motor.",
        "Place a 100 µF capacitor across VMOT and GND, close to the driver.",
        "12 V adapter + to VMOT and Uno VIN; adapter − to driver GND. Uno 5V to VDD and Uno GND to the logic GND.",
        "Connect STEP→pin 3, DIR→pin 4 and tie RESET to SLEEP.",
        "Connect the motor coils: 1A/1B to one coil, 2A/2B to the other.",
        "Upload the sketch.",
      ],
      code: {
        filename: "nema17.ino",
        source: cpp`
const int STEP = 3, DIR = 4;
const int STEPS_PER_REV = 200;

void move(int steps, bool cw) {
  digitalWrite(DIR, cw ? HIGH : LOW);
  for (int i = 0; i < steps; i++) {
    digitalWrite(STEP, HIGH); delayMicroseconds(800);
    digitalWrite(STEP, LOW);  delayMicroseconds(800);
  }
}

void setup() {
  pinMode(STEP, OUTPUT);
  pinMode(DIR, OUTPUT);
}

void loop() {
  move(STEPS_PER_REV, true);
  delay(500);
  move(STEPS_PER_REV, false);
  delay(500);
}
`,
      },
      libraries: [],
      safety_notes: [
        "Never connect or disconnect the motor while the driver is powered — it destroys the A4988.",
        "The driver and motor get hot; add the heatsink.",
      ],
    },
  },
  {
    id: "joystick-pan-tilt-uno",
    title: "Joystick Pan-Tilt",
    goal_examples: ["pan tilt camera mount", "control two servos with a joystick", "joystick servo"],
    plan: {
      title: "Joystick Pan-Tilt",
      summary: "A joystick moves two servos (pan and tilt). Servos run from a separate 4×AA pack.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "J1", part_id: "joystick-ky023", purpose: "input" },
        { ref: "M1", part_id: "sg90-micro-servo", purpose: "pan" },
        { ref: "M2", part_id: "sg90-micro-servo", purpose: "tilt" },
        { ref: "B1", part_id: "battery-holder-4xaa", purpose: "servo power" },
      ],
      connections: wires(
        "U1.5V > J1.+5V", "J1.GND > U1.GND", "J1.VRx > U1.A0", "J1.VRy > U1.A1",
        "U1.D9 > M1.PWM", "U1.D10 > M2.PWM",
        "B1.+ > M1.V+", "B1.+ > M2.V+", "B1.- > M1.GND", "B1.- > M2.GND", "B1.- > U1.GND.2",
      ),
      steps: [
        "Joystick: +5V→5V, GND→GND, VRx→A0, VRy→A1.",
        "Servo signals to pins 9 (pan) and 10 (tilt).",
        "Power both servos from the 4×AA pack (red to +, brown to −) and connect the pack − to Uno GND.",
        "Upload the sketch.",
      ],
      code: {
        filename: "pan_tilt.ino",
        source: cpp`
#include <Servo.h>

Servo pan, tilt;

void setup() {
  pan.attach(9);
  tilt.attach(10);
}

void loop() {
  pan.write(map(analogRead(A0), 0, 1023, 0, 180));
  tilt.write(map(analogRead(A1), 0, 1023, 20, 160));
  delay(20);
}
`,
      },
      libraries: [{ name: "Servo", install_hint: "Built into the Arduino IDE" }],
      safety_notes: ["Use fresh AA cells; never power servos from the Uno's 5V pin when two are moving."],
    },
  },
];
