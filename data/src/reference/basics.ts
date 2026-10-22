import { cpp, wires, type ReferenceProject } from "./dsl";

export const BASIC_PROJECTS: ReferenceProject[] = [
  {
    id: "blink-led-uno",
    title: "Blinking LED",
    goal_examples: ["blink an LED", "my first Arduino project", "make a light flash", "hello world Arduino"],
    plan: {
      title: "Blinking LED",
      summary: "An LED on pin 13 blinks once per second.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "R1", part_id: "resistor-220", purpose: "limits LED current to ~14 mA" },
        { ref: "D1", part_id: "led-5mm-red", purpose: "indicator" },
      ],
      connections: wires("U1.D13 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND"),
      steps: [
        "Push the LED into the breadboard; the long leg is the anode (A).",
        "Connect a 220 Ω resistor from Uno pin 13 to the LED anode.",
        "Connect the LED cathode (short leg) to an Uno GND pin.",
        "Plug the Uno into your computer with the USB cable and upload the sketch.",
      ],
      code: {
        filename: "blink.ino",
        source: cpp`
const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "button-led-uno",
    title: "Push Button Controls an LED",
    goal_examples: ["turn on a light with a button", "button and LED", "press a button to light an LED"],
    plan: {
      title: "Push Button Controls an LED",
      summary: "The LED lights while the button is pressed (internal pull-up, no extra resistor for the button).",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "S1", part_id: "tactile-pushbutton-6mm", purpose: "input" },
        { ref: "R1", part_id: "resistor-220", purpose: "LED current limit" },
        { ref: "D1", part_id: "led-5mm-green", purpose: "indicator" },
      ],
      connections: wires("U1.D2 > S1.1.l", "S1.2.l > U1.GND", "U1.D9 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND.2"),
      steps: [
        "Place the button across the breadboard's middle gap.",
        "Wire one button leg to pin 2 and the diagonal leg to GND.",
        "Wire pin 9 through the 220 Ω resistor to the LED anode; LED cathode to GND.",
        "Upload the sketch and press the button.",
      ],
      code: {
        filename: "button_led.ino",
        source: cpp`
const int BUTTON_PIN = 2;
const int LED_PIN = 9;

void setup() {
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // pressed = LOW
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  digitalWrite(LED_PIN, pressed ? HIGH : LOW);
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "traffic-light-uno",
    title: "Traffic Light",
    goal_examples: ["traffic light", "red yellow green LEDs", "make a stop light"],
    plan: {
      title: "Traffic Light",
      summary: "Three LEDs cycle red → green → yellow like a traffic light.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "R1", part_id: "resistor-220", purpose: "red LED resistor" },
        { ref: "R2", part_id: "resistor-220", purpose: "yellow LED resistor" },
        { ref: "R3", part_id: "resistor-220", purpose: "green LED resistor" },
        { ref: "D1", part_id: "led-5mm-red", purpose: "stop" },
        { ref: "D2", part_id: "led-5mm-yellow", purpose: "caution" },
        { ref: "D3", part_id: "led-5mm-green", purpose: "go" },
      ],
      connections: wires(
        "U1.D10 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND",
        "U1.D9 > R2.1", "R2.2 > D2.A", "D2.C > U1.GND",
        "U1.D8 > R3.1", "R3.2 > D3.A", "D3.C > U1.GND",
      ),
      steps: [
        "Place the red, yellow and green LEDs in a column on the breadboard.",
        "Connect pins 10, 9 and 8 through a 220 Ω resistor each to the red, yellow and green anodes.",
        "Connect all three cathodes to GND.",
        "Upload the sketch.",
      ],
      code: {
        filename: "traffic_light.ino",
        source: cpp`
const int RED = 10, YELLOW = 9, GREEN = 8;

void show(int r, int y, int g, unsigned long ms) {
  digitalWrite(RED, r);
  digitalWrite(YELLOW, y);
  digitalWrite(GREEN, g);
  delay(ms);
}

void setup() {
  pinMode(RED, OUTPUT);
  pinMode(YELLOW, OUTPUT);
  pinMode(GREEN, OUTPUT);
}

void loop() {
  show(HIGH, LOW, LOW, 4000);
  show(LOW, LOW, HIGH, 4000);
  show(LOW, HIGH, LOW, 1500);
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "ultrasonic-distance-uno",
    title: "Ultrasonic Distance Meter",
    goal_examples: ["measure distance", "ultrasonic sensor", "how far away is something", "HC-SR04 project"],
    plan: {
      title: "Ultrasonic Distance Meter",
      summary: "Prints the distance to the nearest object in centimetres to the Serial Monitor.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "hc-sr04-ultrasonic", purpose: "distance sensor" },
      ],
      connections: wires("U1.5V > U2.VCC", "U1.GND > U2.GND", "U1.D9 > U2.TRIG", "U1.D10 > U2.ECHO"),
      steps: [
        "Connect HC-SR04 VCC to 5V and GND to GND.",
        "Connect TRIG to pin 9 and ECHO to pin 10.",
        "Upload the sketch and open the Serial Monitor at 9600 baud.",
      ],
      code: {
        filename: "distance.ino",
        source: cpp`
const int TRIG = 9, ECHO = 10;

void setup() {
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 30000UL);
  if (us == 0) {
    Serial.println("out of range");
  } else {
    Serial.print(us / 58.0, 1);
    Serial.println(" cm");
  }
  delay(200);
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "servo-sweep-uno",
    title: "Servo Sweep",
    goal_examples: ["move a servo", "servo motor back and forth", "sweep a servo"],
    plan: {
      title: "Servo Sweep",
      summary: "An SG90 servo sweeps from 0° to 180° and back.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "M1", part_id: "sg90-micro-servo", purpose: "actuator" },
      ],
      connections: wires("U1.D9 > M1.PWM", "U1.5V > M1.V+", "U1.GND > M1.GND"),
      steps: [
        "Connect the servo's brown wire to GND, red to 5V and orange (signal) to pin 9.",
        "Upload the sketch.",
      ],
      code: {
        filename: "servo_sweep.ino",
        source: cpp`
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(9);
}

void loop() {
  for (int a = 0; a <= 180; a++) { servo.write(a); delay(15); }
  for (int a = 180; a >= 0; a--) { servo.write(a); delay(15); }
}
`,
      },
      libraries: [{ name: "Servo", install_hint: "Built into the Arduino IDE" }],
      safety_notes: ["Keep fingers away from the servo horn while it moves."],
    },
  },
  {
    id: "pot-servo-uno",
    title: "Knob-Controlled Servo",
    goal_examples: ["control a servo with a knob", "potentiometer servo", "turn a dial to move a motor"],
    plan: {
      title: "Knob-Controlled Servo",
      summary: "Turning the potentiometer sets the servo angle.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "RV1", part_id: "potentiometer-10k", purpose: "angle input" },
        { ref: "M1", part_id: "sg90-micro-servo", purpose: "actuator" },
      ],
      connections: wires(
        "U1.5V > RV1.VCC", "RV1.GND > U1.GND", "RV1.SIG > U1.A0",
        "U1.D9 > M1.PWM", "U1.5V > M1.V+", "U1.GND.2 > M1.GND",
      ),
      steps: [
        "Connect the potentiometer's outer legs to 5V and GND and its middle leg to A0.",
        "Connect the servo signal to pin 9, red to 5V, brown to GND.",
        "Upload the sketch and turn the knob.",
      ],
      code: {
        filename: "knob_servo.ino",
        source: cpp`
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach(9);
}

void loop() {
  int raw = analogRead(A0);
  servo.write(map(raw, 0, 1023, 0, 180));
  delay(15);
}
`,
      },
      libraries: [{ name: "Servo", install_hint: "Built into the Arduino IDE" }],
      safety_notes: [],
    },
  },
  {
    id: "night-light-ldr-uno",
    title: "Automatic Night Light",
    goal_examples: ["light turns on when dark", "night light", "light sensor LED", "photoresistor project"],
    plan: {
      title: "Automatic Night Light",
      summary: "An LED turns on when the photoresistor reads darkness.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "LDR1", part_id: "ldr-photoresistor-gl5528", purpose: "light sensor" },
        { ref: "R1", part_id: "resistor-10k", purpose: "divider with the LDR" },
        { ref: "R2", part_id: "resistor-220", purpose: "LED current limit" },
        { ref: "D1", part_id: "led-5mm-white", purpose: "light" },
      ],
      connections: wires(
        "U1.5V > LDR1.1", "LDR1.2 > U1.A0", "U1.A0 > R1.1", "R1.2 > U1.GND",
        "U1.D9 > R2.1", "R2.2 > D1.A", "D1.C > U1.GND.2",
      ),
      steps: [
        "Connect the photoresistor between 5V and A0.",
        "Connect a 10 kΩ resistor between A0 and GND (voltage divider).",
        "Connect pin 9 through 220 Ω to the LED anode and the cathode to GND.",
        "Upload the sketch; cover the sensor to switch the light on.",
      ],
      code: {
        filename: "night_light.ino",
        source: cpp`
const int SENSOR = A0, LED = 9;
const int DARK_THRESHOLD = 300;  // lower = darker; tune for your room

void setup() {
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(SENSOR);
  Serial.println(light);
  digitalWrite(LED, light < DARK_THRESHOLD ? HIGH : LOW);
  delay(100);
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "parking-sensor-uno",
    title: "Parking Sensor",
    goal_examples: ["parking sensor", "beep when something is close", "distance alarm with buzzer"],
    plan: {
      title: "Parking Sensor",
      summary: "Beeps faster and switches from green to red as an object gets closer.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "hc-sr04-ultrasonic", purpose: "distance sensor" },
        { ref: "BZ1", part_id: "buzzer-passive-piezo", purpose: "beeper" },
        { ref: "R1", part_id: "resistor-220", purpose: "green LED resistor" },
        { ref: "R2", part_id: "resistor-220", purpose: "red LED resistor" },
        { ref: "D1", part_id: "led-5mm-green", purpose: "far" },
        { ref: "D2", part_id: "led-5mm-red", purpose: "close" },
      ],
      connections: wires(
        "U1.5V > U2.VCC", "U1.GND > U2.GND", "U1.D9 > U2.TRIG", "U1.D10 > U2.ECHO",
        "U1.D8 > BZ1.+", "BZ1.- > U1.GND",
        "U1.D4 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND.2",
        "U1.D5 > R2.1", "R2.2 > D2.A", "D2.C > U1.GND.2",
      ),
      steps: [
        "Wire the HC-SR04: VCC→5V, GND→GND, TRIG→9, ECHO→10.",
        "Connect the buzzer + to pin 8 and − to GND.",
        "Connect the green LED (via 220 Ω) to pin 4 and the red LED (via 220 Ω) to pin 5.",
        "Upload the sketch and move your hand toward the sensor.",
      ],
      code: {
        filename: "parking_sensor.ino",
        source: cpp`
const int TRIG = 9, ECHO = 10, BUZZER = 8, GREEN = 4, RED = 5;

long readCm() {
  digitalWrite(TRIG, LOW); delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  unsigned long us = pulseIn(ECHO, HIGH, 30000UL);
  return us == 0 ? 999 : us / 58;
}

void setup() {
  pinMode(TRIG, OUTPUT); pinMode(ECHO, INPUT);
  pinMode(GREEN, OUTPUT); pinMode(RED, OUTPUT);
}

void loop() {
  long cm = readCm();
  bool close = cm < 30;
  digitalWrite(GREEN, close ? LOW : HIGH);
  digitalWrite(RED, close ? HIGH : LOW);
  if (cm < 100) {
    tone(BUZZER, 2000, 50);
    delay(constrain(cm * 8, 60, 800));
  } else {
    delay(100);
  }
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "pir-alarm-uno",
    title: "Motion Alarm",
    goal_examples: ["motion detector alarm", "detect people", "PIR sensor alarm", "intruder alarm"],
    plan: {
      title: "Motion Alarm",
      summary: "A PIR sensor triggers a beep and a red LED when motion is detected.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "hc-sr501-pir", purpose: "motion sensor" },
        { ref: "BZ1", part_id: "buzzer-passive-piezo", purpose: "alarm" },
        { ref: "R1", part_id: "resistor-220", purpose: "LED resistor" },
        { ref: "D1", part_id: "led-5mm-red", purpose: "alarm light" },
      ],
      connections: wires(
        "U1.5V > U2.VCC", "U2.GND > U1.GND", "U2.OUT > U1.D2",
        "U1.D8 > BZ1.+", "BZ1.- > U1.GND",
        "U1.D13 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND.2",
      ),
      steps: [
        "Connect the PIR VCC to 5V, GND to GND and OUT to pin 2.",
        "Connect the buzzer + to pin 8 and − to GND.",
        "Connect pin 13 via 220 Ω to the red LED.",
        "Upload, then wait ~30 s for the PIR to settle.",
      ],
      code: {
        filename: "motion_alarm.ino",
        source: cpp`
const int PIR = 2, BUZZER = 8, LED = 13;

void setup() {
  pinMode(PIR, INPUT);
  pinMode(LED, OUTPUT);
}

void loop() {
  if (digitalRead(PIR) == HIGH) {
    digitalWrite(LED, HIGH);
    tone(BUZZER, 1500, 200);
    delay(300);
  } else {
    digitalWrite(LED, LOW);
  }
}
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "ir-remote-led-uno",
    title: "IR Remote Light Switch",
    goal_examples: ["control LEDs with a TV remote", "IR remote project", "infrared remote control"],
    plan: {
      title: "IR Remote Light Switch",
      summary: "Buttons 1 and 2 on an IR remote toggle two LEDs.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "ir-receiver-vs1838b", purpose: "IR receiver" },
        { ref: "RC1", part_id: "ir-remote-nec-21key", purpose: "remote" },
        { ref: "R1", part_id: "resistor-220", purpose: "LED resistor" },
        { ref: "R2", part_id: "resistor-220", purpose: "LED resistor" },
        { ref: "D1", part_id: "led-5mm-red", purpose: "light 1" },
        { ref: "D2", part_id: "led-5mm-blue", purpose: "light 2" },
      ],
      connections: wires(
        "U1.5V > U2.VCC", "U2.GND > U1.GND", "U2.OUT > U1.D11",
        "U1.D4 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND.2",
        "U1.D5 > R2.1", "R2.2 > D2.A", "D2.C > U1.GND.2",
      ),
      steps: [
        "Connect the IR receiver: VCC→5V, GND→GND, OUT→pin 11.",
        "Connect two LEDs through 220 Ω resistors to pins 4 and 5.",
        "Install the IRremote library, upload, and press 1 or 2 on the remote.",
      ],
      code: {
        filename: "ir_lights.ino",
        source: cpp`
#include <IRremote.hpp>

const int IR_PIN = 11, LED1 = 4, LED2 = 5;
bool on1 = false, on2 = false;

void setup() {
  pinMode(LED1, OUTPUT);
  pinMode(LED2, OUTPUT);
  IrReceiver.begin(IR_PIN, DISABLE_LED_FEEDBACK);
}

void loop() {
  if (!IrReceiver.decode()) return;
  uint8_t cmd = IrReceiver.decodedIRData.command;
  IrReceiver.resume();
  if (cmd == 0x0C) { on1 = !on1; digitalWrite(LED1, on1); }   // button 1
  if (cmd == 0x18) { on2 = !on2; digitalWrite(LED2, on2); }   // button 2
}
`,
      },
      libraries: [{ name: "IRremote", install_hint: "Library Manager: IRremote by shirriff/z3t0/ArminJo (v4)" }],
      safety_notes: [],
    },
  },
];
