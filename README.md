# HLK-ZW Fingerprint Sensor Arduino Library

[![PlatformIO Registry](https://badges.registry.platformio.org/packages/gavinnntann/library/HLK_fingerprint.svg)](https://registry.platformio.org/libraries/gavinnntann/HLK_fingerprint)
[![Arduino Library Manager](https://www.ardu-badge.com/badge/HLK_fingerprint.svg)](https://www.ardu-badge.com/HLK_fingerprint)
[![Download](https://img.shields.io/github/v/release/GavinnnTann/HLK-ZW-Fingerprint-Sensor?label=Download%20Tester&style=for-the-badge)](https://github.com/GavinnnTann/HLK-ZW-Fingerprint-Sensor/releases/download/v1.1.0/HLK-ZW.Tester.Program.exe)

Arduino library and desktop GUI tester for the **HLK-ZW series capacitive fingerprint scanner** (EF-01 UART protocol) by Shenzhen Hi-Link Electronic Co., Ltd. Add fingerprint enrollment, 1:N matching, RGB LED control, and template management to any Arduino or ESP32 project in minutes. Also supports AS608, R307, and all EF-01-compatible fingerprint sensor modules.

Includes a **Python desktop tester** — evaluate and manage the sensor over USB without writing a single line of firmware.

<img src="extras/Images/HL-ZW101%20Product.png" width="450" alt="HLK-ZW101 capacitive fingerprint sensor with CH340 USB adapter">
<img src="extras/Images/Program%20screenshot.png" width="450" alt="HLK-ZW fingerprint sensor desktop tester GUI for Windows">

---

## Why This Library Exists

No good English-language Arduino library existed for the HLK-ZW fingerprint sensor family. The official Hi-Link tools shipped with:

- Chinese-only demo software with no English documentation
- No Arduino library or example sketches
- No LED control support
- No testing workflow without custom firmware

This project fills that gap: a clean Arduino API installable from the Arduino IDE Library Manager, six ready-to-run example sketches, and a no-code desktop testing application for Windows, macOS, and Linux.

---

## Compatible Boards

Works with any board that has a hardware UART or software serial port, including:

| Board | Notes |
|-------|-------|
| ESP32 / ESP32-S3 | Primary target; uses `Serial1` or `Serial2` |
| Arduino Uno / Nano | Use SoftwareSerial at lower baud rates |
| Arduino Mega 2560 | Hardware `Serial1`–`Serial3` available |
| Arduino Leonardo | Hardware `Serial1` available |
| STM32 (Blue Pill, Nucleo) | Any hardware UART |
| Raspberry Pi Pico / Pico W | `Serial1` or `Serial2` |

---

## Architecture

Two independent workflows depending on your use case:

**Embedded workflow — Arduino / ESP32**
```
+-------------------------+
|  HLK-ZW Fingerprint     |
|  Scanner (UART)         |
+-----------+-------------+
            |
            v
+-------------------------+
|  Arduino Library        |
|  (HLK_fingerprint.h)   |
+-----------+-------------+
            |
            v
+-------------------------+
|  Your Sketch / App      |
+-------------------------+
```

**Desktop testing workflow — no firmware required**
```
+-------------------------+
|  HLK-ZW Fingerprint     |
|  Scanner (UART)         |
+-----------+-------------+
            |
            v
+-------------------------+
|  USB–Serial Bridge      |
|  CH340 adapter or ESP32 |
+-----------+-------------+
            |
            v
+-------------------------+
|  Python GUI Tester      |
|  (Windows / Mac / Linux)|
+-------------------------+
```

---

## Use Cases

- Smart locks and door access control
- Employee attendance and time-tracking systems
- IoT device authentication
- Embedded biometric security
- Arduino and ESP32 educational projects
- Rapid product prototyping
- Biometric research platforms

---

## Where to Buy

| Item | Link |
|------|------|
| HLK-ZW101 Fingerprint Sensor + CH340 USB Adapter | https://www.aliexpress.com/item/1005011644712935.html?spm=a2g0o.order_list.order_list_main.23.417f18020u6hpK |

---

## Arduino Library

### Installation

**Arduino Library Manager (recommended):** In the Arduino IDE go to Sketch → Include Library → Manage Libraries, search for `HLK_fingerprint`, and click Install. Works in Arduino IDE 1.x and 2.x.

**Manual install:** Download or clone this repo and copy `HLK_fingerprint.h` and `HLK_fingerprint.cpp` into your Arduino libraries folder, or place them alongside your sketch.

**Zip install:** Sketch → Include Library → Add .ZIP Library… → select the downloaded zip.

### Quick Start (ESP32)

```cpp
#include <HLK_fingerprint.h>

// ESP32: sensor TX → GPIO16, sensor RX → GPIO17
FingerprintModule fp(Serial1, /*RX=*/16, /*TX=*/17);

void setup() {
    Serial.begin(115200);
    fp.begin();           // verifies password, reads capacity
}

void loop() {
    uint16_t score;
    int16_t id = fp.matchFingerprint(score);  // blocks up to 10 s
    if (id >= 0)  Serial.printf("Match: ID %d  score %d\n", id, score);
    else          Serial.println("No match");
}

// Expected serial output:
//
//   Match: ID 3  score 85
//
//   or
//
//   No match
```

### Supported Fingerprint Sensor Modules

| Module | Template Slots | RGB LED |
|--------|---------------|---------|
| HLK-ZW101 | 50 | Yes (AURALEDCONFIG) |
| HLK-ZW111 | 100 | Yes (AURALEDCONFIG) |
| HLK-ZW06xx | 50 or 100 | No (simple on/off) |
| HLK-ZW09xx | 50 or 100 | No (simple on/off) |
| HLK-ZW30xx (ZW3020 / ZW3021) | 100 | None — no LED on the module |
| AS608 / R307 compatible | varies | depends on firmware |

LED wrappers (`ledBreathing`, `ledFlash`, `ledSteady`, etc.) automatically fall back to simple on/off for passive-LED variants — no code changes needed when switching modules. The ZW302x has no LED hardware at all (6-pin: VCC-S, INT, VCC-D, UART-TX, UART-RX, GND), so all LED calls return `false` there.

**Note on ZW302x matching:** `matchFingerprint()` prefers HiSpeedSearch (`0x1B`), which is a Synochip/AS608-era extension rather than part of the Hi-Link EF-01 instruction set. ZW30xx firmware rejects it with confirm code `0x13` ("wrong password"). The library probes it once, then falls back to the documented Search (`0x04`) for the rest of the session — no configuration needed. Call `useHiSpeedSearch(false)` after `begin()` to skip the probe.

### API Reference

```cpp
// Initialization
bool begin(uint32_t baud = 57600);

// Fingerprint enrollment and matching
int16_t enrollFingerprint(uint16_t id = 0xFFFF); // 0xFFFF = auto-assign next free slot
int16_t matchFingerprint(uint16_t &score);        // returns template ID or -1

// Template management
bool deleteFingerprint(uint16_t id);
bool deleteRange(uint16_t first, uint16_t last);
bool deleteAllFingerprints();
bool getStorageMap(bool *states, uint16_t maxSlots);

// RGB LED control (auto-fallback for passive-LED modules)
bool ledBreathing(uint8_t color = FP_LED_WHITE);
bool ledFlash(uint8_t color, uint8_t cycles = 3);
bool ledSteady(uint8_t color = FP_LED_WHITE);
bool ledOff();

// System configuration
bool readSysParam(uint16_t *capacity, uint8_t *secLevel, uint8_t *pktIdx, uint8_t *baudN);
bool setSecurityLevel(uint8_t level);  // 1 (lowest) – 5 (highest)
```

### Example Sketches

| Sketch | Description |
|--------|-------------|
| `enroll` | Two-scan fingerprint enrollment with serial prompt for ID slot |
| `fingerprint` | 1:N fingerprint matching with RGB LED feedback |
| `delete_fingerprint` | Delete a single template, a range, or all fingerprints |
| `storage_map` | ASCII grid of occupied and free template slots, auto-refreshes every 5 s |
| `led_effects` | Cycles through all LED modes and colours |
| `system_info` | Reads and prints module capacity, security level, and baud settings |
| `MCU_Adapter` | Uses an ESP32 as a USB-CDC ↔ UART bridge for the Python desktop tester |

All examples include an optional **CTRL pin** for low-power circuit designs — set `constexpr int CTRL = -1` (default, no pin) to a GPIO number to control sensor power.

### Performance Notes

- Default fingerprint match timeout: 10 seconds
- Enrollment requires two successful scans of the same finger
- Default UART baud rate: 57600
- Matching is blocking during active scan window
- Template storage capacity: 50–100 slots depending on module variant

---

## Python Desktop Tester

A **no-code testing environment** for HLK-ZW fingerprint sensors. Evaluate enrollment, 1:N matching, LED effects, and full template management over USB — no firmware required. Compatible with the CH340 adapter or any ESP32 running the `MCU_Adapter` sketch.

### Circuit

**Fingerprint Sensor (MX1.0-6P connector) → CH340 USB Adapter**

<img src="extras/Images/Circuit.png" width="450" alt="HLK-ZW101 fingerprint sensor wiring diagram to CH340 USB adapter">

### Wiring — CH340 USB Adapter

> **Note:** TX and RX labels are from the adapter's perspective.
> Colour scheme matches the Hi-Link distributor linked above; wire colours vary between vendors.
>
> **TOUCH_OUT (Blue):** Leave unconnected for USB desktop testing.
> For embedded use, connect to any GPIO — the sensor asserts this HIGH when a finger is detected,
> which makes it ideal for interrupt-driven wakeup from deep sleep on ESP32 and STM32.
> See the [datasheet](extras/HLK-ZW101%20Datasheet.pdf) for low-power circuit design details.

| HLK-ZW101 Wire | CH340 Adapter Pin |
|----------------|-------------------|
| 🔴 Red (GND) | GND |
| ⚫ Black (RX) | TX |
| 🟡 Yellow (TX) | RX |
| 🟢 Green (VCC) | 3V3 |
| 🔵 Blue (TOUCH_OUT) | NC (not connected for USB testing) |
| ⚪ White (V_SENSOR) | 3V3 |

### ESP32 Wiring (MCU_Adapter sketch)

Use an ESP32 as the USB bridge instead of a CH340 adapter:

| HLK-ZW101 Wire | ESP32 Pin |
|----------------|-----------|
| 🟡 Yellow (TX) | GPIO16 (RX2) |
| ⚫ Black (RX)  | GPIO17 (TX2) |
| 🟢 Green (VCC) | 3.3V |
| 🔴 Red (GND)   | GND |
| ⚪ White (V_SENSOR) | 3V3 |
| 🔵 Blue (TOUCH_OUT) | NC (not connected for USB testing) |

### Requirements (running from source)

- Python 3.10+
- Windows, macOS, or Linux
- USB-serial adapter (CH340, CP2102, or FTDI — recommended for auto COM port detection)

### Installation (running from source)

```bash
pip install -r requirements.txt
python HLK_ZW_Tester_Program.py
```

### Quick Start

1. Plug in your USB-serial adapter with the fingerprint sensor wired up
2. Click **Refresh** — the correct COM port is usually detected automatically
3. Set baud rate to **57600** (default for HLK-ZW sensors)
4. Click **Connect** — the tester verifies the module password and loads the template storage map
5. Click **Enrollment** to register a fingerprint, then **Match** under Verification to test recognition

### Features

- **Auto-connect** — on connect, verifies module password, reads system parameters, and loads the full storage map automatically
- **Storage map** — visual grid of all occupied and free fingerprint template slots
- **Enrollment** — two-scan enrollment with live progress feedback; auto-selects the next available slot
- **1:N Matching** — fingerprint recognition with adjustable timeout and confidence score display
- **Template management** — inspect, delete single slot, delete a range, or wipe all templates
- **LED control** — all 6 LED modes (Breathing, Flash, Steady On, Gradually Open, Gradually Close, Off); auto-falls back to simple on/off for passive-LED modules
- **Settings panel** — configure security level, baud rate, packet size, and module password

---

## Comparison with Adafruit Fingerprint Sensor Library

| Feature | Adafruit Library | HLK-ZW Library |
|---------|-----------------|----------------|
| HLK-ZW101 / ZW111 support | ❌ | ✅ |
| AS608 / R307 support | ✅ | ✅ |
| RGB LED control (6 modes) | Limited | ✅ |
| Desktop GUI tester | ❌ | ✅ |
| Template storage map viewer | ❌ | ✅ |
| Auto slot assignment on enroll | ❌ | ✅ |
| TOUCH_OUT interrupt / low-power support | ❌ | ✅ |
| Arduino Library Manager | ✅ | ✅ |

---

## Acknowledgements

This project is heavily inspired by the [Adafruit Fingerprint Sensor Library](https://github.com/adafruit/Adafruit-Fingerprint-Sensor-Library) by Adafruit Industries, which pioneered an accessible Arduino API for EF-01 UART fingerprint modules. The packet framing, confirm-code handling, and overall driver architecture in `HLK_fingerprint.cpp` follow the same conventions established by their library. Credit to Adafruit and the contributors of that project for laying the groundwork.
