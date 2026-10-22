import { cpp, wires, type ReferenceProject } from "./dsl";

export const DEVICE_PROJECTS: ReferenceProject[] = [
  {
    id: "weather-station-lcd-uno",
    title: "Weather Station with LCD",
    goal_examples: ["weather station", "show temperature and humidity on a screen", "thermometer with LCD"],
    plan: {
      title: "Weather Station with LCD",
      summary: "Shows temperature and humidity from a DHT22 on a 16×2 I2C LCD.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "dht22-sensor", purpose: "temperature/humidity" },
        { ref: "R1", part_id: "resistor-10k", purpose: "DHT22 data pull-up" },
        { ref: "U3", part_id: "lcd1602-i2c", purpose: "display" },
      ],
      connections: wires(
        "U1.5V > U2.VCC", "U2.GND > U1.GND", "U2.DATA > U1.D2", "R1.1 > U2.DATA", "R1.2 > U1.5V",
        "U1.A4 > U3.SDA", "U1.A5 > U3.SCL", "U1.5V > U3.VCC", "U3.GND > U1.GND.2",
      ),
      steps: [
        "DHT22: VCC→5V, GND→GND, DATA→pin 2, plus a 10 kΩ resistor from DATA to 5V.",
        "LCD backpack: SDA→A4, SCL→A5, VCC→5V, GND→GND.",
        "Install the libraries, upload, and adjust the backpack's contrast trimmer if the screen is blank.",
      ],
      code: {
        filename: "weather_lcd.ino",
        source: cpp`
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(2, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);  // try 0x3F if nothing shows

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  lcd.clear();
  if (isnan(t) || isnan(h)) {
    lcd.print("Sensor error");
  } else {
    lcd.print("Temp: "); lcd.print(t, 1); lcd.print(" C");
    lcd.setCursor(0, 1);
    lcd.print("Hum:  "); lcd.print(h, 0); lcd.print(" %");
  }
  delay(2000);
}
`,
      },
      libraries: [
        { name: "DHT sensor library", install_hint: "Library Manager: DHT sensor library by Adafruit (+ Adafruit Unified Sensor)" },
        { name: "LiquidCrystal I2C", install_hint: "Library Manager: LiquidCrystal I2C by Frank de Brabander" },
      ],
      safety_notes: [],
    },
  },
  {
    id: "oled-thermometer-esp32",
    title: "OLED Thermometer (ESP32)",
    goal_examples: ["ESP32 thermometer", "temperature on an OLED", "small screen weather display"],
    plan: {
      title: "OLED Thermometer (ESP32)",
      summary: "An ESP32 shows DHT22 temperature and humidity on a 0.96\" OLED, everything at 3.3 V.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "esp32-devkit-v1", purpose: "controller" },
        { ref: "U2", part_id: "dht22-sensor", purpose: "temperature/humidity" },
        { ref: "R1", part_id: "resistor-10k", purpose: "DHT22 data pull-up" },
        { ref: "U3", part_id: "oled-ssd1306-128x64-i2c", purpose: "display" },
      ],
      connections: wires(
        "U1.3V3 > U2.VCC", "U2.GND > U1.GND", "U2.DATA > U1.D4", "R1.1 > U2.DATA", "R1.2 > U1.3V3",
        "U1.3V3 > U3.VCC", "U3.GND > U1.GND.2", "U1.D21 > U3.SDA", "U1.D22 > U3.SCL",
      ),
      steps: [
        "Power the DHT22 and the OLED from the ESP32 3V3 pin (not VIN — the ESP32 pins are not 5 V tolerant).",
        "DHT22 DATA→D4 with a 10 kΩ pull-up to 3V3.",
        "OLED SDA→D21, SCL→D22.",
        "Install the libraries and upload.",
      ],
      code: {
        filename: "oled_thermo.ino",
        source: cpp`
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <DHT.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
DHT dht(4, DHT22);

void setup() {
  Wire.begin(21, 22);
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature(), h = dht.readHumidity();
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(0, 8);
  if (isnan(t)) {
    display.print("No sensor");
  } else {
    display.print(t, 1); display.println(" C");
    display.print(h, 0); display.println(" %");
  }
  display.display();
  delay(2000);
}
`,
      },
      libraries: [
        { name: "Adafruit SSD1306", install_hint: "Library Manager (installs Adafruit GFX too)" },
        { name: "DHT sensor library", install_hint: "Library Manager: DHT sensor library by Adafruit" },
      ],
      safety_notes: [],
    },
  },
  {
    id: "plant-watering-uno",
    title: "Automatic Plant Watering",
    goal_examples: ["water my plants automatically", "plant watering system", "soil moisture pump"],
    plan: {
      title: "Automatic Plant Watering",
      summary: "When the soil is dry, a relay runs a small pump for 3 seconds.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "soil-moisture-capacitive-v1-2", purpose: "soil sensor" },
        { ref: "K1", part_id: "relay-module-5v-1ch", purpose: "switches the pump" },
        { ref: "P1", part_id: "mini-water-pump-5v", purpose: "pump" },
        { ref: "B1", part_id: "battery-holder-4xaa", purpose: "pump power" },
      ],
      connections: wires(
        "U1.5V > U2.VCC", "U2.GND > U1.GND", "U2.AOUT > U1.A0",
        "U1.5V > K1.VCC", "K1.GND > U1.GND.2", "U1.D7 > K1.IN",
        "B1.+ > K1.COM", "K1.NO > P1.+", "P1.- > B1.-",
      ),
      steps: [
        "Push the soil sensor into the pot up to the line; VCC→5V, GND→GND, AOUT→A0.",
        "Relay module: VCC→5V, GND→GND, IN→pin 7.",
        "Pump circuit: battery + → relay COM, relay NO → pump +, pump − → battery −.",
        "Put the pump in a water container and the tube in the pot; upload the sketch.",
        "Read the dry/wet values in the Serial Monitor and adjust DRY_LEVEL.",
      ],
      code: {
        filename: "plant_watering.ino",
        source: cpp`
const int SENSOR = A0, RELAY = 7;
const int DRY_LEVEL = 520;  // capacitive sensors read HIGHER when dry

void setup() {
  pinMode(RELAY, OUTPUT);
  digitalWrite(RELAY, LOW);
  Serial.begin(9600);
}

void loop() {
  int moisture = analogRead(SENSOR);
  Serial.println(moisture);
  if (moisture > DRY_LEVEL) {
    digitalWrite(RELAY, HIGH);
    delay(3000);
    digitalWrite(RELAY, LOW);
    delay(60000UL);  // let the water soak in
  }
  delay(1000);
}
`,
      },
      libraries: [],
      safety_notes: ["Keep water away from the Uno and relay; mount electronics above the water container."],
    },
  },
  {
    id: "neopixel-ring-uno",
    title: "NeoPixel Rainbow Ring",
    goal_examples: ["RGB light effects", "rainbow LEDs", "NeoPixel project", "color changing lamp"],
    plan: {
      title: "NeoPixel Rainbow Ring",
      summary: "A 12-LED WS2812B ring shows a moving rainbow.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "L1", part_id: "neopixel-ring-12", purpose: "LEDs" },
        { ref: "R1", part_id: "resistor-330", purpose: "data line resistor" },
        { ref: "C1", part_id: "capacitor-100uf-25v", purpose: "smooths LED power" },
      ],
      connections: wires(
        "U1.D6 > R1.1", "R1.2 > L1.DIN", "U1.5V > L1.VCC", "L1.GND > U1.GND",
        "C1.+ > U1.5V", "C1.- > U1.GND",
      ),
      steps: [
        "Ring VCC→5V and GND→GND; put the 100 µF capacitor across 5V/GND (stripe = −).",
        "Pin 6 → 330 Ω → ring DIN.",
        "Install Adafruit NeoPixel and upload. Brightness is capped at 40% to stay within USB power.",
      ],
      code: {
        filename: "rainbow_ring.ino",
        source: cpp`
#include <Adafruit_NeoPixel.h>

Adafruit_NeoPixel ring(12, 6, NEO_GRB + NEO_KHZ800);

void setup() {
  ring.begin();
  ring.setBrightness(100);  // of 255
}

void loop() {
  static uint16_t hue = 0;
  for (int i = 0; i < 12; i++) {
    ring.setPixelColor(i, ring.gamma32(ring.ColorHSV(hue + i * 65536L / 12)));
  }
  ring.show();
  hue += 256;
  delay(20);
}
`,
      },
      libraries: [{ name: "Adafruit NeoPixel", install_hint: "Library Manager: Adafruit NeoPixel" }],
      safety_notes: [],
    },
  },
  {
    id: "rfid-door-lock-esp32",
    title: "RFID Door Lock (ESP32)",
    goal_examples: ["RFID door lock", "unlock with a card", "NFC access control", "RC522 project"],
    plan: {
      title: "RFID Door Lock (ESP32)",
      summary: "An authorised RFID card turns a servo latch and lights the green LED; others light red.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "esp32-devkit-v1", purpose: "controller" },
        { ref: "U2", part_id: "rfid-rc522", purpose: "card reader" },
        { ref: "M1", part_id: "sg90-micro-servo", purpose: "latch" },
        { ref: "R1", part_id: "resistor-220", purpose: "green LED resistor" },
        { ref: "R2", part_id: "resistor-220", purpose: "red LED resistor" },
        { ref: "D1", part_id: "led-5mm-green", purpose: "access granted" },
        { ref: "D2", part_id: "led-5mm-red", purpose: "access denied" },
      ],
      connections: wires(
        "U1.3V3 > U2.3.3V", "U2.GND > U1.GND",
        "U1.D5 > U2.SDA", "U1.D18 > U2.SCK", "U1.D23 > U2.MOSI", "U2.MISO > U1.D19", "U1.D4 > U2.RST",
        "U1.D13 > M1.PWM", "U1.VIN > M1.V+", "M1.GND > U1.GND.2",
        "U1.D25 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND.2",
        "U1.D26 > R2.1", "R2.2 > D2.A", "D2.C > U1.GND.2",
      ),
      steps: [
        "RC522: 3.3V→3V3 (never 5 V), GND→GND, SDA→D5, SCK→D18, MOSI→D23, MISO→D19, RST→D4.",
        "Servo: signal→D13, red→VIN (5 V from USB), brown→GND.",
        "LEDs via 220 Ω: green→D25, red→D26.",
        "Upload, open the Serial Monitor, scan your card and paste its UID into ALLOWED_UID.",
      ],
      code: {
        filename: "rfid_lock.ino",
        source: cpp`
#include <SPI.h>
#include <MFRC522.h>
#include <ESP32Servo.h>

const int SS_PIN = 5, RST_PIN = 4, SERVO_PIN = 13, GREEN = 25, RED = 26;
const String ALLOWED_UID = "DE AD BE EF";  // replace with your card's UID

MFRC522 rfid(SS_PIN, RST_PIN);
Servo latch;

String uidString() {
  String s;
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (i) s += " ";
    if (rfid.uid.uidByte[i] < 0x10) s += "0";
    s += String(rfid.uid.uidByte[i], HEX);
  }
  s.toUpperCase();
  return s;
}

void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();
  latch.attach(SERVO_PIN);
  latch.write(0);
  pinMode(GREEN, OUTPUT);
  pinMode(RED, OUTPUT);
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  String uid = uidString();
  Serial.println(uid);
  bool ok = uid == ALLOWED_UID;
  digitalWrite(ok ? GREEN : RED, HIGH);
  if (ok) { latch.write(90); delay(3000); latch.write(0); } else { delay(1000); }
  digitalWrite(GREEN, LOW);
  digitalWrite(RED, LOW);
  rfid.PICC_HaltA();
}
`,
      },
      libraries: [
        { name: "MFRC522", install_hint: "Library Manager: MFRC522 by GithubCommunity" },
        { name: "ESP32Servo", install_hint: "Library Manager: ESP32Servo by Kevin Harrington" },
      ],
      safety_notes: ["A hobby servo latch is not a security device; do not rely on it for a real door."],
    },
  },
  {
    id: "keypad-lock-uno",
    title: "Keypad Code Lock",
    goal_examples: ["password lock", "keypad door lock", "enter a code to open", "safe with a keypad"],
    plan: {
      title: "Keypad Code Lock",
      summary: "Typing the right 4-digit code on a keypad opens a servo latch.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "KP1", part_id: "membrane-keypad-4x4", purpose: "code entry" },
        { ref: "M1", part_id: "sg90-micro-servo", purpose: "latch" },
        { ref: "R1", part_id: "resistor-220", purpose: "green LED resistor" },
        { ref: "R2", part_id: "resistor-220", purpose: "red LED resistor" },
        { ref: "D1", part_id: "led-5mm-green", purpose: "open" },
        { ref: "D2", part_id: "led-5mm-red", purpose: "locked" },
      ],
      connections: wires(
        "KP1.R1 > U1.D9", "KP1.R2 > U1.D8", "KP1.R3 > U1.D7", "KP1.R4 > U1.D6",
        "KP1.C1 > U1.D5", "KP1.C2 > U1.D4", "KP1.C3 > U1.D3", "KP1.C4 > U1.D2",
        "U1.D10 > M1.PWM", "U1.5V > M1.V+", "M1.GND > U1.GND",
        "U1.D12 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND.2",
        "U1.D13 > R2.1", "R2.2 > D2.A", "D2.C > U1.GND.2",
      ),
      steps: [
        "Keypad rows R1–R4 → pins 9–6, columns C1–C4 → pins 5–2.",
        "Servo signal→10, red→5V, brown→GND.",
        "Green LED via 220 Ω → 12, red LED via 220 Ω → 13.",
        "Install the Keypad library, upload, and type 1234 then #.",
      ],
      code: {
        filename: "keypad_lock.ino",
        source: cpp`
#include <Keypad.h>
#include <Servo.h>

const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {{'1','2','3','A'},{'4','5','6','B'},{'7','8','9','C'},{'*','0','#','D'}};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);
Servo latch;
const String CODE = "1234";
String entered;

void setup() {
  latch.attach(10);
  latch.write(0);
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
}

void loop() {
  char k = keypad.getKey();
  if (!k) return;
  if (k == '#') {
    bool ok = entered == CODE;
    entered = "";
    if (ok) {
      digitalWrite(13, LOW); digitalWrite(12, HIGH);
      latch.write(90); delay(4000); latch.write(0);
      digitalWrite(12, LOW); digitalWrite(13, HIGH);
    }
  } else if (k == '*') {
    entered = "";
  } else if (entered.length() < 8) {
    entered += k;
  }
}
`,
      },
      libraries: [
        { name: "Keypad", install_hint: "Library Manager: Keypad by Mark Stanley, Alexander Brevig" },
        { name: "Servo", install_hint: "Built into the Arduino IDE" },
      ],
      safety_notes: ["A hobby servo latch is not a security device."],
    },
  },
  {
    id: "rtc-clock-lcd-uno",
    title: "Desk Clock",
    goal_examples: ["digital clock", "show the time on an LCD", "real time clock project", "alarm clock"],
    plan: {
      title: "Desk Clock",
      summary: "A DS3231 keeps time and a 16×2 LCD shows the date and time (both on the I2C bus).",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "ds3231-rtc", purpose: "clock" },
        { ref: "U3", part_id: "lcd1602-i2c", purpose: "display" },
      ],
      connections: wires(
        "U1.5V > U2.VCC", "U2.GND > U1.GND", "U1.A4 > U2.SDA", "U1.A5 > U2.SCL",
        "U1.5V > U3.VCC", "U3.GND > U1.GND.2", "U1.A4 > U3.SDA", "U1.A5 > U3.SCL",
      ),
      steps: [
        "Connect both modules to 5V and GND.",
        "Connect both SDA pins to A4 and both SCL pins to A5 (shared I2C bus).",
        "Install RTClib and LiquidCrystal I2C; upload once to set the time from your computer.",
      ],
      code: {
        filename: "desk_clock.ino",
        source: cpp`
#include <RTClib.h>
#include <LiquidCrystal_I2C.h>

RTC_DS3231 rtc;
LiquidCrystal_I2C lcd(0x27, 16, 2);

void print2(int v) { if (v < 10) lcd.print('0'); lcd.print(v); }

void setup() {
  lcd.init();
  lcd.backlight();
  rtc.begin();
  if (rtc.lostPower()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
}

void loop() {
  DateTime now = rtc.now();
  lcd.setCursor(0, 0);
  print2(now.day()); lcd.print('/'); print2(now.month()); lcd.print('/'); lcd.print(now.year());
  lcd.setCursor(0, 1);
  print2(now.hour()); lcd.print(':'); print2(now.minute()); lcd.print(':'); print2(now.second());
  delay(250);
}
`,
      },
      libraries: [
        { name: "RTClib", install_hint: "Library Manager: RTClib by Adafruit" },
        { name: "LiquidCrystal I2C", install_hint: "Library Manager: LiquidCrystal I2C by Frank de Brabander" },
      ],
      safety_notes: [],
    },
  },
  {
    id: "temperature-fan-uno",
    title: "Temperature-Controlled Fan",
    goal_examples: ["fan turns on when hot", "automatic cooling fan", "temperature controlled fan", "MOSFET fan control"],
    plan: {
      title: "Temperature-Controlled Fan",
      summary: "A MOSFET switches a 5 V fan on above 28 °C, measured by a DS18B20.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "arduino-uno-r3", purpose: "controller" },
        { ref: "U2", part_id: "ds18b20-waterproof", purpose: "temperature" },
        { ref: "R1", part_id: "resistor-4k7", purpose: "1-Wire pull-up" },
        { ref: "Q1", part_id: "irlz44n-mosfet", purpose: "switches the fan" },
        { ref: "R2", part_id: "resistor-220", purpose: "gate resistor" },
        { ref: "F1", part_id: "dc-fan-5v-40mm", purpose: "fan" },
        { ref: "D1", part_id: "diode-1n4007", purpose: "flyback protection" },
      ],
      connections: wires(
        "U1.5V > U2.VDD", "U2.GND > U1.GND", "U2.DQ > U1.D2", "R1.1 > U2.DQ", "R1.2 > U1.5V",
        "U1.D9 > R2.1", "R2.2 > Q1.G", "Q1.S > U1.GND.2",
        "U1.5V > F1.+", "F1.- > Q1.D",
        "D1.K > F1.+", "D1.A > F1.-",
      ),
      steps: [
        "DS18B20: red→5V, black→GND, yellow→pin 2, with a 4.7 kΩ resistor between yellow and 5V.",
        "MOSFET (flat side facing you: G, D, S): G via 220 Ω to pin 9, S to GND.",
        "Fan red → 5V, fan black → MOSFET drain.",
        "Put the 1N4007 across the fan: striped end (K) to fan +, other end to fan −.",
        "Install OneWire and DallasTemperature, then upload.",
      ],
      code: {
        filename: "temp_fan.ino",
        source: cpp`
#include <OneWire.h>
#include <DallasTemperature.h>

OneWire bus(2);
DallasTemperature sensors(&bus);
const int FAN = 9;
const float ON_AT = 28.0, OFF_AT = 26.0;  // hysteresis
bool fanOn = false;

void setup() {
  pinMode(FAN, OUTPUT);
  sensors.begin();
}

void loop() {
  sensors.requestTemperatures();
  float c = sensors.getTempCByIndex(0);
  if (c != DEVICE_DISCONNECTED_C) {
    if (!fanOn && c >= ON_AT) fanOn = true;
    if (fanOn && c <= OFF_AT) fanOn = false;
  }
  digitalWrite(FAN, fanOn ? HIGH : LOW);
  delay(1000);
}
`,
      },
      libraries: [
        { name: "OneWire", install_hint: "Library Manager: OneWire" },
        { name: "DallasTemperature", install_hint: "Library Manager: DallasTemperature by Miles Burton" },
      ],
      safety_notes: ["Always fit the flyback diode across motor/fan loads switched by a MOSFET."],
    },
  },
  {
    id: "esp32-web-barometer",
    title: "Wi-Fi Barometer (ESP32)",
    goal_examples: ["IoT weather station", "see temperature on my phone", "wifi sensor web page", "barometer"],
    plan: {
      title: "Wi-Fi Barometer (ESP32)",
      summary: "The ESP32 serves a web page with BMP280 temperature and air pressure on your Wi-Fi.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "esp32-devkit-v1", purpose: "controller + Wi-Fi" },
        { ref: "U2", part_id: "bmp280-3v3-module", purpose: "pressure/temperature" },
      ],
      connections: wires("U1.3V3 > U2.VCC", "U2.GND > U1.GND", "U1.D21 > U2.SDA", "U1.D22 > U2.SCL"),
      steps: [
        "BMP280: VCC→3V3 (3.3 V only), GND→GND, SDA→D21, SCL→D22.",
        "Put your Wi-Fi name and password into the sketch and upload.",
        "Open the IP address printed in the Serial Monitor (115200 baud).",
      ],
      code: {
        filename: "web_barometer.ino",
        source: cpp`
#include <WiFi.h>
#include <WebServer.h>
#include <Adafruit_BMP280.h>

const char* SSID = "your-wifi";
const char* PASS = "your-password";
WebServer server(80);
Adafruit_BMP280 bmp;

void handleRoot() {
  String page = "<meta name=viewport content='width=device-width'><meta http-equiv=refresh content=10>";
  page += "<h1>" + String(bmp.readTemperature(), 1) + " &deg;C</h1>";
  page += "<h2>" + String(bmp.readPressure() / 100.0, 1) + " hPa</h2>";
  server.send(200, "text/html", page);
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  bmp.begin(0x76);
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  Serial.println(WiFi.localIP());
  server.on("/", handleRoot);
  server.begin();
}

void loop() {
  server.handleClient();
}
`,
      },
      libraries: [{ name: "Adafruit BMP280", install_hint: "Library Manager: Adafruit BMP280 Library" }],
      safety_notes: [],
    },
  },
  {
    id: "nodemcu-wifi-fan-switch",
    title: "Wi-Fi Fan Switch (ESP8266)",
    goal_examples: ["turn something on over wifi", "smart switch", "wifi relay", "control a fan from my phone"],
    plan: {
      title: "Wi-Fi Fan Switch (ESP8266)",
      summary: "A NodeMCU web page switches a relay that powers a 5 V fan from its own adapter.",
      feasibility: "achievable",
      language: "arduino_cpp",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "nodemcu-esp8266-v3", purpose: "controller + Wi-Fi" },
        { ref: "K1", part_id: "relay-module-5v-1ch", purpose: "switch" },
        { ref: "F1", part_id: "dc-fan-5v-40mm", purpose: "load" },
        { ref: "PS1", part_id: "dc-adapter-5v-2a", purpose: "fan power" },
      ],
      connections: wires(
        "U1.VIN > K1.VCC", "K1.GND > U1.GND", "U1.D1 > K1.IN",
        "PS1.+ > K1.COM", "K1.NO > F1.+", "F1.- > PS1.-",
      ),
      steps: [
        "Relay module: VCC→NodeMCU VIN (5 V from USB), GND→GND, IN→D1.",
        "Fan circuit: adapter + → relay COM, relay NO → fan +, fan − → adapter −.",
        "Enter your Wi-Fi details, upload, and open the printed IP address.",
      ],
      code: {
        filename: "wifi_switch.ino",
        source: cpp`
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>

const char* SSID = "your-wifi";
const char* PASS = "your-password";
const int RELAY = D1;
ESP8266WebServer server(80);
bool on = false;

void page() {
  server.send(200, "text/html",
    String("<meta name=viewport content='width=device-width'><h1>Fan is ") + (on ? "ON" : "OFF") +
    "</h1><a href=/on>ON</a> | <a href=/off>OFF</a>");
}

void setup() {
  pinMode(RELAY, OUTPUT);
  digitalWrite(RELAY, LOW);
  Serial.begin(115200);
  WiFi.begin(SSID, PASS);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  Serial.println(WiFi.localIP());
  server.on("/", page);
  server.on("/on", [] { on = true; digitalWrite(RELAY, HIGH); page(); });
  server.on("/off", [] { on = false; digitalWrite(RELAY, LOW); page(); });
  server.begin();
}

void loop() {
  server.handleClient();
}
`,
      },
      libraries: [{ name: "ESP8266 board package", install_hint: "Boards Manager: esp8266 by ESP8266 Community" }],
      safety_notes: ["Only switch low-voltage DC loads with this build — never mains."],
    },
  },
  {
    id: "pico-blink-micropython",
    title: "Pico Blink (MicroPython)",
    goal_examples: ["Raspberry Pi Pico first project", "MicroPython blink", "Pico LED"],
    plan: {
      title: "Pico Blink (MicroPython)",
      summary: "An LED on GP15 blinks using MicroPython.",
      feasibility: "achievable",
      language: "micropython",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "raspberry-pi-pico", purpose: "controller" },
        { ref: "R1", part_id: "resistor-220", purpose: "LED resistor" },
        { ref: "D1", part_id: "led-5mm-red", purpose: "indicator" },
      ],
      connections: wires("U1.GP15 > R1.1", "R1.2 > D1.A", "D1.C > U1.GND"),
      steps: [
        "Flash MicroPython onto the Pico (hold BOOTSEL, drag the UF2 file).",
        "GP15 → 220 Ω → LED anode; LED cathode → GND.",
        "Open Thonny, paste the code and save it on the Pico as main.py.",
      ],
      code: {
        filename: "main.py",
        source: cpp`
from machine import Pin
import time

led = Pin(15, Pin.OUT)

while True:
    led.toggle()
    time.sleep(0.5)
`,
      },
      libraries: [],
      safety_notes: [],
    },
  },
  {
    id: "pico-oled-dht11-micropython",
    title: "Pico Climate Display (MicroPython)",
    goal_examples: ["Pico temperature display", "MicroPython OLED", "humidity monitor Raspberry Pi Pico"],
    plan: {
      title: "Pico Climate Display (MicroPython)",
      summary: "A Pico shows DHT11 temperature and humidity on an SSD1306 OLED.",
      feasibility: "achievable",
      language: "micropython",
      power_mode: "usb",
      parts: [
        { ref: "U1", part_id: "raspberry-pi-pico", purpose: "controller" },
        { ref: "U2", part_id: "dht11-module", purpose: "temperature/humidity" },
        { ref: "U3", part_id: "oled-ssd1306-128x64-i2c", purpose: "display" },
      ],
      connections: wires(
        "U1.3V3 > U2.VCC", "U2.GND > U1.GND", "U2.DATA > U1.GP16",
        "U1.3V3 > U3.VCC", "U3.GND > U1.GND.2", "U1.GP4 > U3.SDA", "U1.GP5 > U3.SCL",
      ),
      steps: [
        "DHT11 module: VCC→3V3(OUT), GND→GND, DATA→GP16.",
        "OLED: VCC→3V3(OUT), GND→GND, SDA→GP4, SCL→GP5.",
        "In Thonny run: import mip; mip.install('ssd1306'). Then save the code as main.py.",
      ],
      code: {
        filename: "main.py",
        source: cpp`
from machine import Pin, I2C
import dht
import ssd1306
import time

i2c = I2C(0, sda=Pin(4), scl=Pin(5), freq=400000)
oled = ssd1306.SSD1306_I2C(128, 64, i2c)
sensor = dht.DHT11(Pin(16))

while True:
    oled.fill(0)
    try:
        sensor.measure()
        oled.text("Temp: %d C" % sensor.temperature(), 0, 16)
        oled.text("Hum:  %d %%" % sensor.humidity(), 0, 32)
    except OSError:
        oled.text("Sensor error", 0, 24)
    oled.show()
    time.sleep(2)
`,
      },
      libraries: [{ name: "ssd1306", install_hint: "MicroPython: import mip; mip.install('ssd1306')" }],
      safety_notes: [],
    },
  },
];
