/**
 * Curated parts whose pin names and electrical types are cross-checked against a KiCad
 * symbol (test/kicad.test.ts). Board-level modules (L298N module, LM2596 module) are
 * checked against the chip symbol only where the module exposes the chip pins directly.
 */
export const KICAD_REFS: Record<string, string> = {
  "arduino-uno-r3": "MCU_Module:Arduino_UNO_R3",
  "arduino-nano-v3": "MCU_Module:Arduino_Nano_v3.x",
  "raspberry-pi-pico": "MCU_Module:RaspberryPi_Pico",
  "l293d-motor-driver-ic": "Driver_Motor:L293D",
  "a4988-stepper-driver": "Driver_Motor:Pololu_Breakout_A4988",
  "tb6612fng-motor-driver": "Driver_Motor:TB6612FNG",
};
