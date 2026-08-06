// EF-01 UART protocol constants for the HLK-ZW fingerprint sensor family.
//
// Keep this file in sync with src/HLK_fingerprint.cpp and
// extras/HLK_ZW_Tester_Program.py — all three are implementations of the same
// wire protocol, and a module-compatibility fix in one belongs in all three.

export const HEADER = [0xef, 0x01];
export const ADDR = [0xff, 0xff, 0xff, 0xff];
export const PID_CMD = 0x01;
export const PID_ACK = 0x07;
export const PID_DATA = 0x02;
export const PID_END = 0x08;

export const CMD = {
  GETIMAGE: 0x01,
  IMAGE2TZ: 0x02,
  SEARCH: 0x04,
  REGMODEL: 0x05,
  STORE: 0x06,
  LOAD: 0x07,
  UPCHAR: 0x08,
  DOWNCHAR: 0x09,
  UPIMAGE: 0x0a,
  DELETE: 0x0c,
  EMPTY: 0x0d,
  WRITE_REG: 0x0e,
  READSYSPARAM: 0x0f,
  SETPASSWORD: 0x12,
  VERIFYPASSWORD: 0x13,
  GETRANDOM: 0x14,
  READINFPAGE: 0x16,
  HISPEEDSEARCH: 0x1b,
  TEMPLATECOUNT: 0x1d,
  READ_INDEX: 0x1f,
  AURALEDCONFIG: 0x3c,
  LEDON: 0x50,
  LEDOFF: 0x51,
};

// Confirmation codes per "Fingerprint module V1.1 (communication protocol)" §3.2.
export const CONFIRM = {
  0x00: 'OK',
  0x01: 'Packet receive error',
  0x02: 'No finger on sensor',
  0x03: 'Image capture failed',
  0x04: 'Image too dry / too light',
  0x05: 'Image too wet / smudged',
  0x06: 'Image too messy',
  0x07: 'Feature extraction failed — too few minutiae',
  0x08: 'No match',
  0x09: 'Not found in library',
  0x0a: "Enroll mismatch — scans didn't match",
  0x0b: 'Bad page ID / location out of range',
  0x0c: 'DB read error / template not found',
  0x0d: 'Upload feature failed',
  0x0e: 'Module cannot accept packets',
  0x0f: 'Upload image failed',
  0x10: 'Delete failed',
  0x11: 'Library clear failed',
  0x12: 'Cannot enter low-power state',
  0x13: 'Wrong password',
  0x15: 'Invalid image',
  0x16: 'Online upgrade failed',
  0x17: 'Residual fingerprint — finger did not move between scans',
  0x18: 'Flash write error',
  0x19: 'Random number generation failed',
  0x1a: 'Invalid register number',
  0x1b: 'Invalid register content',
  0x1c: 'Bad notepad page number',
  0x1d: 'Port operation failed',
  0x1e: 'Auto-enroll failed',
  0x1f: 'Library full',
  0x20: 'Device address error',
  0x21: 'Password incorrect',
  0x22: 'Template slot not empty',
  0x23: 'Template slot empty',
  0x24: 'Library is empty',
  0x25: 'Entry count set incorrectly',
  0x26: 'Timeout',
  0x27: 'Fingerprint already enrolled',
  0x28: 'Fingerprint features are related',
  0x29: 'Sensor operation failed',
  0x31: 'Command not permitted at this encryption level',
  0x33: 'Image area too small',
  0x34: 'Image not available',
  0x35: 'Illegal data',
};

export function ccText(cc) {
  if (cc === null || cc === undefined) return 'comm error';
  return CONFIRM[cc] ?? `0x${cc.toString(16).padStart(2, '0').toUpperCase()}`;
}

// Capacity → possible HLK-ZW families (all share the EF-01 protocol).
// Several models report the same capacity, so this is always an inference.
export const VARIANT_MAP = {
  50: 'ZW101 / ZW06xx / ZW09xx',
  100: 'ZW111 / ZW06xx / ZW09xx / ZW30xx',
};

// AURALEDCONFIG (0x3C) function codes.
export const LED_FUNC = {
  BREATHING: 1,
  FLASH: 2,
  STEADY: 3,
  OFF: 4,
  GRAD_OPEN: 5,
  GRAD_CLOSE: 6,
};

// Wire values for the LED colour field — bit 0 blue, bit 1 green, bit 2 red.
export const LED_COLORS = [
  { name: 'Red', value: 0x04, css: '#ef4444' },
  { name: 'Green', value: 0x02, css: '#22c55e' },
  { name: 'Blue', value: 0x01, css: '#3b82f6' },
  { name: 'Cyan', value: 0x03, css: '#06b6d4' },
  { name: 'Purple', value: 0x05, css: '#a855f7' },
  { name: 'Yellow', value: 0x06, css: '#eab308' },
  { name: 'White', value: 0x07, css: '#e5e7eb' },
];

export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200];

// WriteReg 0x04 register value → actual baud (value × 9600).
export const BAUD_REGS = [
  { n: 1, baud: 9600 },
  { n: 2, baud: 19200 },
  { n: 4, baud: 38400 },
  { n: 6, baud: 57600 },
  { n: 12, baud: 115200 },
];

export const PACKET_SIZES = [
  { idx: 0, bytes: 32 },
  { idx: 1, bytes: 64 },
  { idx: 2, bytes: 128 },
  { idx: 3, bytes: 256 },
];
