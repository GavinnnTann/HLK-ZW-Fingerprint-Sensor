#pragma once
#include <Arduino.h>

// ─── Enums ────────────────────────────────────────────────────────────────────

enum class FpEnrollStep : uint8_t { PLACE_FIRST, LIFT_FINGER, PLACE_SECOND, DONE, FAILED };
enum class FpResult     : uint8_t { OK, NO_MATCH, ERROR };

// ─── Raw image size presets (module doesn't report its own resolution) ──────
// These four sizes match the "image size" dropdown in Hi-Link's Finger_Demo
// software, which assumes 2 px/byte (4-bit grayscale) — so .bytes below is
// that assumption's estimate, NOT a confirmed value.
//
// CONFIRMED on real HLK-ZW101 hardware (examples/random_and_image):
// PS_UpImage reliably returns exactly 3200 bytes — W160x160 at 1 bit/pixel
// (an 8-fold pack, not the 2-fold this struct assumes), because the module
// sends its default preprocessed/binarized image (ImageFormat register,
// system parameter #12 / WriteReg register 2), not the "original" grayscale
// image the demo software's size picker was built around. The HLK-ZW101
// datasheet's own stated sensor array (80×64, extras/HLK-ZW101 Datasheet.pdf
// §2.1) doesn't match the wire format at any bit depth — it's presumably
// describing the sensor die, not what PS_UpImage streams.
//
// Bottom line: trust the byte count captureImage() actually returns over
// dims.bytes here. On a ZW101, expect 3200 bytes = 160×160 @ 1 bit/pixel
// (8 pixels/byte, MSB first). Other HLK-ZW variants are unconfirmed — for
// those, try other width/height/bit-depth combinations (see extras/web's
// Raw image capture card, which does this interactively) until the picture
// looks like a fingerprint instead of noise.
enum class FpImageSize : uint8_t { W88x112, W96x122, W160x160, W256x288 };

struct FpImageDims {
    uint16_t width;
    uint16_t height;
    uint16_t bytes;   // width*height/2 — UNCONFIRMED estimate, see note above
};

// Pixel dimensions + estimated PS_UpImage byte count for a size preset.
FpImageDims fpImageDims(FpImageSize size);

// ─── LED color wire values for AURALEDCONFIG (0x3C) ──────────────────────────
// These are the actual bytes sent to the module, NOT UI label numbers.
#define FP_LED_BLUE    0x01
#define FP_LED_GREEN   0x02
#define FP_LED_CYAN    0x03   // green + blue
#define FP_LED_RED     0x04
#define FP_LED_PURPLE  0x05   // red + blue
#define FP_LED_YELLOW  0x06   // red + green
#define FP_LED_WHITE   0x07   // all channels
#define FP_LED_OFF     0x00

// LED function codes for ledAura()
#define FP_LED_FUNC_BREATHING   1
#define FP_LED_FUNC_FLASH       2
#define FP_LED_FUNC_STEADY      3
#define FP_LED_FUNC_OFF         4
#define FP_LED_FUNC_GRAD_OPEN   5
#define FP_LED_FUNC_GRAD_CLOSE  6

// ─── FingerprintModule — HLK-ZW EF-01 UART driver ────────────────────────────

class FingerprintModule {
public:
    // Last confirm code returned by the module (0x00 = OK; see fingerprint.md §7)
    uint8_t lastCC = 0;

    // Maximum template slots reported by the module (auto-populated by begin()).
    // Override with setCapacity() if readSysParam is not supported by your firmware.
    uint16_t capacity() const { return _capacity; }
    void     setCapacity(uint16_t n) { if (n > 0) _capacity = n; }

    // ── Construction / init ────────────────────────────────────────────────────
    FingerprintModule(HardwareSerial &serial,
                      int rxPin, int txPin,
                      int touchPin = -1,   // TOUCH_OUT GPIO; -1 if unused
                      int pwrPin   = -1);  // VCC enable GPIO; -1 if always-on

    // Start serial, configure pins, wait 200 ms, verify password.
    bool begin(uint32_t baud = 57600);
    void powerOn();    // assert pwrPin HIGH, wait 200 ms
    void powerOff();   // assert pwrPin LOW  (V_SENSOR stays powered)

    // Returns true when a finger is touching the sensor.
    // Uses TOUCH_OUT pin if wired, otherwise polls GetImage.
    bool isFingerPresent();

    // Send VerifyPassword (0x13) with pw (default = 0x00000000).
    // Also serves as module presence check / ping.
    bool verifyPassword(uint32_t pw = 0);

    // ── Enrollment ────────────────────────────────────────────────────────────

    // High-level blocking 2-scan enroll.
    // id = 0xFFFF → auto-assign to first free slot from storage map.
    // Returns enrolled ID on success, -1 on error/timeout.
    int16_t enrollFingerprint(uint16_t id = 0xFFFF, uint32_t timeoutMs = 15000);

    // Low-level single-step commands (used by the non-blocking tick).
    bool getImage();                        // GETIMAGE (0x01): sets lastCC
    bool image2Tz(uint8_t bufIdx);         // IMAGE2TZ (0x02): buf 1 or 2
    bool createModel();                     // REGMODEL (0x05): merge buf1+buf2
    bool storeTemplate(uint8_t bufIdx, uint16_t id);  // STORE (0x06)
    bool loadTemplate(uint8_t bufIdx, uint16_t id);   // LOAD  (0x07)

    // ── Matching ──────────────────────────────────────────────────────────────

    // Blocking 1:N match. Polls GetImage within timeoutMs, extracts features,
    // runs HiSpeedSearch (falls back to Search if the firmware rejects it).
    // Returns matched ID (≥0), -1 = no match, -2 = error / timeout.
    int16_t matchFingerprint(uint16_t &score, uint32_t timeoutMs = 10000);

    // True while HiSpeedSearch (0x1B) is still being attempted. Cleared
    // automatically on the first match if the module rejects the opcode —
    // ZW30xx firmware answers 0x13 because 0x1B is not in the Hi-Link
    // command set. Call useHiSpeedSearch(false) to skip the probe entirely.
    bool hiSpeedSearch() const { return _hiSpeedOk; }
    void useHiSpeedSearch(bool on) { _hiSpeedOk = on; }

    // ── Deletion ──────────────────────────────────────────────────────────────

    bool deleteFingerprint(uint16_t id);                // DELETE count=1
    bool deleteRange(uint16_t firstId, uint16_t lastId);// DELETE with count
    bool deleteAllFingerprints();                       // EMPTY (0x0D)

    // ── Template management ───────────────────────────────────────────────────

    // Returns true if slot id has a stored template (uses LOAD to probe).
    bool     templateExists(uint16_t id);

    // Returns total enrolled count via TEMPLATECOUNT (0x1D).
    uint16_t getTemplateCount();

    // Read slot occupancy bitmap via READ_INDEX (0x1F, page 0).
    // states[i] = true if slot i is occupied. buf must hold at least maxSlots bools.
    // Returns false if not supported by firmware or on comm error.
    bool     getStorageMap(bool *states, uint16_t maxSlots);

    // Export: LOAD → UpChar data stream → caller-supplied buf.
    // len is set to the number of bytes written. Returns false on error.
    bool exportTemplate(uint16_t id, uint8_t *buf, uint16_t &len, uint16_t maxLen);

    // Import: DownChar data stream → STORE at target id.
    bool importTemplate(uint16_t id, const uint8_t *buf, uint16_t len);

    // ── Device info ───────────────────────────────────────────────────────────

    // Read the 512-byte flash info page (PS_ReadINFpage 0x16).
    // Each output buffer must be at least 9 bytes (8 chars + null terminator).
    // Pass nullptr for fields you don't need.
    // The byte offset of the device descriptor within the page is firmware-
    // dependent; this method scans for the first valid ASCII group automatically.
    // Returns false if the command is not supported or the page cannot be parsed.
    bool readInfoPage(char *productSN    = nullptr,
                      char *swVersion    = nullptr,
                      char *manufacturer = nullptr,
                      char *sensorName   = nullptr);

    // ── Random number & raw image ──────────────────────────────────────────────

    // Sample the module's on-chip hardware RNG (PS_GetRandomCode 0x14).
    // Independent of the fingerprint sensor — does not require or consume a
    // finger scan, safe to call at any time. Returns false on comm error.
    bool getRandomNumber(uint32_t &out);

    // Blocking raw image capture: waits up to timeoutMs for a finger
    // (PS_GetImage 0x01), then streams the image out of the buffer
    // (PS_UpImage 0x0A). buf should be sized generously — see the
    // FpImageDims note above, the true byte count is not reliably
    // predictable from width/height alone. Returns bytes received (0 =
    // timeout/error; check lastCC) — use that actual count, not
    // fpImageDims().bytes, when deciding how to interpret the pixels.
    uint16_t captureImage(uint8_t *buf, uint16_t maxLen, uint32_t timeoutMs = 10000);

    // ── System settings (all persist to module flash) ─────────────────────────

    // Read READSYSPARAM (0x0F). All out-params are optional (pass nullptr to skip).
    bool readSysParam(uint16_t *capacity  = nullptr,
                      uint8_t  *secLevel  = nullptr,
                      uint8_t  *pktIdx    = nullptr,
                      uint8_t  *baudN     = nullptr);

    bool setSecurityLevel(uint8_t level);  // WRITE_REG 0x05, range 1–5
    bool setBaudReg(uint8_t n);            // WRITE_REG 0x04: 1/2/4/6/12 → ×9600
    bool setPacketSize(uint8_t idx);       // WRITE_REG 0x06: 0–3 (32/64/128/256 B)
    bool setPassword(uint32_t newPw);      // SETPASSWORD (0x12), persists to flash

    // ── LED ───────────────────────────────────────────────────────────────────

    // General Aura LED command (AURALEDCONFIG 0x3C) — ZW1xx family only.
    // Returns false on passive-LED variants (ZW06xx/ZW09xx/ZW30xx); use ledOn()/ledOff() there.
    // func: FP_LED_FUNC_* constants.  color: FP_LED_* constants.
    // cycles = 0 for breathing/flash means infinite.
    bool ledAura(uint8_t func, uint8_t color, uint8_t cycles = 0);

    // Convenience wrappers — automatically fall back to ledOn()/ledOff() if AURALEDCONFIG
    // is not supported by the connected variant.
    bool ledOff();
    bool ledOn();                               // simple LEDON  (0x50)
    bool ledBreathing(uint8_t color = FP_LED_WHITE);
    bool ledFlash(uint8_t color, uint8_t cycles = 3);
    bool ledSteady(uint8_t color = FP_LED_WHITE);
    bool ledGradOpen(uint8_t color = FP_LED_WHITE);
    bool ledGradClose(uint8_t color = FP_LED_WHITE);

    // ── Module control ────────────────────────────────────────────────────────

    // Convenience alias for verifyPassword(0) — confirms module is alive.
    bool ping();

    // Put module into sleep / power-save. The EF-01 ZW series has no UART sleep
    // command; this asserts pwrPin LOW (powerOff) if a power pin is wired.
    // V_SENSOR remains on so TOUCH_OUT keeps working for deep-sleep wakeup.
    void sleep();

private:
    HardwareSerial &_serial;
    int _rxPin, _txPin, _touchPin, _pwrPin;
    uint16_t _capacity = 50;  // populated from readSysParam() in begin()
    bool _hiSpeedOk = true;   // cleared once the module rejects HiSpeedSearch

    // True if cc/dlen is a genuine answer to a search command, as opposed to
    // the module refusing an opcode it does not implement.
    static bool _isSearchReply(uint8_t cc, uint8_t dlen);

    // Build command packet into out[]. Returns total byte count.
    // out[] must be at least 11 + plen bytes.
    static uint16_t _buildPacket(uint8_t ins, const uint8_t *params, uint8_t plen,
                                  uint8_t *out);
    static uint16_t _checksum(uint8_t pid, uint8_t lh, uint8_t ll,
                               const uint8_t *body, uint16_t blen);

    // Read one full packet (header + length + body + checksum) into buf.
    // Returns total bytes (0 = timeout or framing error).
    uint16_t _readPacket(uint8_t *buf, uint16_t maxLen, uint32_t timeoutMs);

    // Read a PID=0x02/0x08 data stream (used after UpChar ACK).
    // Returns total payload bytes written into out[].
    uint16_t _recvStream(uint8_t *out, uint16_t maxLen, uint32_t timeoutMs = 5000);

    // Send data as a PID=0x02/0x08 packet stream (used before DownChar store).
    void _sendStream(const uint8_t *data, uint16_t len, uint16_t pktSize = 128);

    // Core send/receive: build packet, flush RX, write TX, read + parse response.
    // Returns the confirm code (CC). 0xFF = timeout, 0xFE = parse error.
    // dataOut: caller buffer for response payload (may be nullptr).
    // dataLen: set to actual payload byte count on return.
    uint8_t _sendRecv(uint8_t ins, const uint8_t *params, uint8_t plen,
                      uint8_t *dataOut, uint8_t &dataLen,
                      uint32_t timeoutMs = 3000);
};
