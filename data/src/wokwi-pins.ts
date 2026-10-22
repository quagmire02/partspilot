/**
 * Pin names exposed by @wokwi/elements 1.9.2 (read from each element's pinInfo).
 * Used to validate profile → element pin maps; the desktop reads live pinInfo for layout.
 * Regenerate when bumping @wokwi/elements.
 */
export const WOKWI_PINS: Record<string, string[]> = {
  "wokwi-arduino-uno": ["A5.2", "A4.2", "AREF", "GND.1", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0", "IOREF", "RESET", "3.3V", "5V", "GND.2", "GND.3", "VIN", "A0", "A1", "A2", "A3", "A4", "A5"],
  "wokwi-arduino-nano": ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "GND.2", "RESET.2", "0", "1", "13", "3.3V", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RESET", "GND.1", "VIN", "12.2", "5V.2", "13.2", "11.2", "RESET.3", "GND.3"],
  "wokwi-arduino-mega": [
    "SCL", "SDA", "AREF", "GND.1", ...Array.from({ length: 54 }, (_, n) => String(n)), "5V.1", "5V.2", "GND.4", "GND.5", "IOREF", "RESET", "3.3V", "5V", "GND.2", "GND.3", "VIN",
    ...Array.from({ length: 16 }, (_, n) => `A${n}`),
  ],
  "wokwi-esp32-devkit-v1": ["VIN", "GND.2", "D13", "D12", "D14", "D27", "D26", "D25", "D33", "D32", "D35", "D34", "VN", "VP", "EN", "3V3", "GND.1", "D15", "D2", "D4", "RX2", "TX2", "D5", "D18", "D19", "D21", "RX0", "TX0", "D22", "D23"],
  "wokwi-hc-sr04": ["VCC", "TRIG", "ECHO", "GND"],
  "wokwi-servo": ["GND", "V+", "PWM"],
  "wokwi-led": ["A", "C"],
  "wokwi-resistor": ["1", "2"],
  "wokwi-pushbutton": ["1.l", "2.l", "1.r", "2.r"],
  "wokwi-potentiometer": ["GND", "SIG", "VCC"],
  "wokwi-dht22": ["VCC", "SDA", "NC", "GND"],
  "wokwi-lcd1602": ["GND", "VCC", "SDA", "SCL"],
  "wokwi-lcd2004": ["GND", "VCC", "SDA", "SCL"],
  "wokwi-ssd1306": ["DATA", "CLK", "DC", "RST", "CS", "3V3", "VIN", "GND"],
  "wokwi-buzzer": ["1", "2"],
  "wokwi-pir-motion-sensor": ["VCC", "OUT", "GND"],
  "wokwi-ir-receiver": ["GND", "VCC", "DAT"],
  "wokwi-mpu6050": ["INT", "AD0", "XCL", "XDA", "SDA", "SCL", "GND", "VCC"],
  "wokwi-membrane-keypad": ["R1", "R2", "R3", "R4", "C1", "C2", "C3", "C4"],
  "wokwi-ky-040": ["CLK", "DT", "SW", "VCC", "GND"],
  "wokwi-analog-joystick": ["VCC", "VERT", "HORZ", "SEL", "GND"],
  "wokwi-stepper-motor": ["A-", "A+", "B+", "B-"],
  "wokwi-ds1307": ["GND", "5V", "SDA", "SCL", "SQW"],
  "wokwi-led-ring": ["GND", "VCC", "DIN", "DOUT"],
  "wokwi-neopixel-matrix": ["GND", "VCC", "DIN", "DOUT"],
  "wokwi-microsd-card": ["CD", "DO", "GND", "SCK", "VCC", "DI", "CS"],
  "wokwi-photoresistor-sensor": ["VCC", "GND", "DO", "AO"],
};
