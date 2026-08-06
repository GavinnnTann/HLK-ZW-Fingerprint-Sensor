/*
 * HLK-ZW Fingerprint Sensor Library
 * Example: On-chip random number + raw image capture
 *
 * Demonstrates two lower-level features beyond enrollment/matching:
 *   1. getRandomNumber() — samples the module's on-chip hardware RNG
 *      (PS_GetRandomCode, 0x14). Independent of the fingerprint sensor —
 *      does not require or consume a finger scan.
 *   2. captureImage() — waits for a finger, then streams the raw image out of
 *      the module (PS_GetImage 0x01 + PS_UpImage 0x0A) and dumps it as hex
 *      over Serial.
 *
 * The module reports neither its own sensor resolution nor its pixel
 * packing. CONFIRMED on real HLK-ZW101 hardware: expect exactly 3200 bytes
 * per capture — that's 160×160 pixels at 1 bit/pixel (8 pixels/byte), the
 * module's default preprocessed/binarized image, not the 4-bit grayscale
 * image Hi-Link's demo software assumes. See the FpImageSize note in
 * HLK_fingerprint.h for the full story. This sketch just proves bytes arrive
 * and prints exactly how many; to actually see the picture, feed the hex
 * dump into the interactive Raw image capture card in extras/web
 * (width/height/bit-depth live preview) — start from its confirmed 160×160
 * @ 1-bit preset.
 *
 * Press any key in the Serial monitor to sample a new random number.
 * Place a finger on the sensor to capture and dump a raw image.
 *
 * Wiring (ESP32):
 *   Sensor TX  →  GPIO 16  (ESP32 RX)
 *   Sensor RX  →  GPIO 17  (ESP32 TX)
 *   Sensor VCC →  3.3 V or 5 V (check your module's datasheet)
 *   Sensor GND →  GND
 *   CTRL       →  (optional) GPIO for low-power circuit enable; set CTRL below, -1 to disable
 */

#include <HLK_fingerprint.h>

#define FP_RX  16
#define FP_TX  17
constexpr int CTRL = -1;  // set to GPIO number to enable low-power circuit; -1 = disabled

FingerprintModule fp(Serial1, FP_RX, FP_TX);
uint8_t imageBuf[36864];  // generous upper bound — see FpImageSize note in the header

// ── Random number ───────────────────────────────────────────────────────────

void printRandomNumber() {
    uint32_t rnd;
    if (fp.getRandomNumber(rnd)) {
        Serial.print(F("Random number: 0x"));
        Serial.print(rnd, HEX);
        Serial.print(F("  ("));
        Serial.print(rnd);
        Serial.println(F(")"));
    } else {
        Serial.print(F("getRandomNumber failed, confirm code 0x"));
        Serial.println(fp.lastCC, HEX);
    }
}

// ── Raw image ────────────────────────────────────────────────────────────────

void dumpImage(uint16_t len) {
    Serial.print(F("Captured "));
    Serial.print(len);
    Serial.println(F(" bytes:"));

    for (uint16_t i = 0; i < len; i++) {
        if (imageBuf[i] < 0x10) Serial.print('0');
        Serial.print(imageBuf[i], HEX);
        Serial.print(' ');
        if ((i + 1) % 32 == 0) Serial.println();
    }
    Serial.println();
}

// ── Setup / Loop ──────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    while (!Serial) delay(10);
    Serial.println(F("\nHLK-ZW Random Number + Raw Image"));
    Serial.println(F("=================================="));

    if (CTRL >= 0) {
        pinMode(CTRL, OUTPUT);
        digitalWrite(CTRL, HIGH);  // assert HIGH to enable low-power circuit
    }

    if (!fp.begin()) {
        Serial.println(F("ERROR: Module not found. Check wiring and baud rate."));
        while (true) delay(1000);
    }
    Serial.println(F("Module ready."));

    printRandomNumber();
    Serial.println(F("\nPress any key to sample a new random number,"));
    Serial.println(F("or place a finger to capture a raw image."));
}

void loop() {
    if (Serial.available()) {
        while (Serial.available()) Serial.read();
        printRandomNumber();
    }

    // Short poll: returns 0 immediately if no finger is down yet (lastCC ==
    // 0x02), so this doesn't block the Serial-key check above for long.
    uint16_t len = fp.captureImage(imageBuf, sizeof(imageBuf), 200);
    if (len > 0) {
        dumpImage(len);
        delay(1000);  // debounce — avoid re-capturing the same resting finger
    } else if (fp.lastCC != 0x02) {
        Serial.print(F("Capture error, confirm code 0x"));
        Serial.println(fp.lastCC, HEX);
        delay(500);
    }
}
