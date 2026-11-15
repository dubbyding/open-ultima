# Ultima Open — Reverse Engineering & Protocol Specification

Complete clean-room protocol, feature, and architecture specification derived from disassembling:
1. **`Ultima Link` (`com.yscoco.kanha`, v1.0.31)** — Earbuds / Headphones / Speaker companion app
2. **`ULTIMA Fit` (`com.crrepa.band.ultima_fit`, v2.9.19-3)** — Smartwatch / Fitness Band companion app

Both original applications suffer from remote phone-home dependencies or severe white-label bloatware that degrade offline reliability and responsiveness. This document specifies the exact wire protocols required to implement **Ultima Open**, a single, 100% offline-first, bloat-free React Native companion application covering every hardware feature of both apps.

---

## 1. Why the Original Apps Fail Offline & Run Slowly

### 1.1 `Ultima Link` (`com.yscoco.kanha`, v1.0.31)
* **Remote License Check (`YSAppSDK`)**: During startup/scanning, `YSAppSDK` checks an external endpoint (`home/index/a` & `home/index/b`) using the 16-byte ASCII license embedded in the BLE advertisement packet and caches authorization for only 7 days (`604800000 ms`). After 7 days offline, or on a fresh install without internet access, device validation and pairing flows stall or fail.
* **Third-party telemetry**: Ships Tencent Bugly crash/reporting SDKs and native `libnrb.so`.
* **Fragmented dual SDK wrapper**: Wraps two separate native chip vendor stacks — **Bluetrum (`com.bluetrum.devicemanager`)** and **Jieli (`com.jieli.bluetooth` RCSP)** — behind legacy Android LiveData adapters.

### 1.2 `ULTIMA Fit` (`com.crrepa.band.ultima_fit`, v2.9.19-3)
* **Extreme White-Label Bloatware**: Compiled across **8 DEX files** (`classes.dex` .. `classes8.dex`) plus dynamically loaded ad DEX (`audience_network.dex`).
* **Four Embedded Ad Networks**: Meta Audience Network, MBridge, ByteDance/Pangle, and Google AdMob run background ad prefetchers and intercept app launches/transitions.
* **Heavy Map/Location Bloat**: Bundles ~10 MB of Baidu Map & Baidu Location SDKs even when no GPS workout is active.
* **Oversized Config Payload**: Ships a **16.8 MB Base64-encoded JSON blob** (`assets/config.txt`) for white-label SKU branding and remote feature toggles.
* **Cloud Sync Gate & Serialized Command Queue**: Tightly couples health summaries/watch-face catalogs to remote HTTP APIs while queuing BLE writes through fixed 50/150/300/500 ms delays in `zc8`.

### 1.3 How `Ultima Open` Solves This
* **100% Offline-First**: Zero network calls required at startup or runtime; local license/PID matching is deterministic; all earbuds profiles, equalizer presets, health metrics, alarms, and backups live locally in on-device storage with manual JSON/CSV export & import.
* **Single Unified Stack**: One TypeScript protocol layer driving both **Bluetrum ABMate**, **Jieli RCSP**, and **CRREPA/MOY (`0xFEEA`)** simultaneously (e.g., watch + earbuds connected together).
* **Built-in Hardware Simulator & Hex Inspector**: Allows testing every packet encoder/decoder offline without physical hardware attached, plus live TX/RX byte-level diagnostics.

---

## 2. `Ultima Link` Protocol & Feature Specification

### 2.1 BLE Manufacturer Advertisement Parser (`BleAdvMsg`)
* **Company Identifiers**: `0xD222` (primary), `0xFE22` (alternate); also Bluetrum IDs `0x0642`, `0x0301`, `0x4301`.
* **Manufacturer Specific Data Layout (>= 27 bytes)**:
  | Offset | Length | Field | Decoding |
  |---|---|---|---|
  | `0..1` | 2 | `bid` (Brand ID) | Big-endian uint16 (`(b[0] << 8) \| b[1]`) |
  | `2..3` | 2 | `pid` (Product ID) | Big-endian uint16 (`(b[2] << 8) \| b[3]`) |
  | `4` | 1 | `edrConnectState` | `1` = Classic BT A2DP/HFP connected, `0` = disconnected |
  | `5..10` | 6 | `edrMac` | Each byte XORed with `0xAD` -> formatted as `XX:XX:XX:XX:XX:XX` |
  | `11..26` | 16 | `license` | US-ASCII string matching `/^[a-z0-9]{16}$/` (verified offline in Ultima Open) |

### 2.2 Supported Ultima Product Catalog (14 Products from `Product$1..14`)
| PID (Hex) | Enum / Name | Display Name | Chip | Type | ANC | Game Mode | Case Keys | Dual Connect | LDAC | Spatial Audio | Sig/Bal EQ | OTA |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `0x0001` | `TW_538` | Ultima Prime1 | `JL` | `TWS` | Yes | Yes | No | No | No | No | Yes | Yes |
| `0x0002` | `BOOM_141` | BOOM_141 | `JL` | `TWS` | Yes | Yes | No | No | No | No | No | Yes |
| `0x0003` | `BOOM_311` | BOOM_311 | `JL` | `TWS` | No | Yes | No | No | No | No | Yes | Yes |
| `0x0004` | `BOOM_181` | BOOM_181 | `JL` | `TWS` | Yes | Yes | No | No | No | No | No | Yes |
| `0x0005` | `BOOM_211` | BOOM_211 | `BT` | `TWS` | No | Yes | No | No | No | No | Yes | Yes |
| `0x0006` | `N1` | BOOM_181 | `JL` | `TWS` | No | Yes | No | No | No | No | No | Yes |
| `0x0008` | `x2` | BOOM_181 | `JL` | `TWS` | Yes | Yes | No | No | No | No | No | Yes |
| `0x0009` | `AK` | BOOM_181 | `JL` | `TWS` | No | Yes | No | No | No | No | No | Yes |
| `0x000A` | `XH68` | XH-68B ANC | `BT` | `TWS` | Yes | Yes | Yes | Yes | Yes | Yes | No | No |
| `0x000B` | `X1` | X1 | `JL` | `TWS` | No | Yes | No | No | No | No | Yes | Yes |
| `0x000C` | `HNC69MB` | HNC69MB | `JL` | `HEAD_MOUNTED` | No | Yes | No | No | No | No | No | No |
| `0x000D` | `YT06_PRO` | YT06 Pro | `BT` | `TWS` | No | Yes | No | No | No | No | No | No |
| `0x000E` | `ABC` | Mega 7 | `BT` | `TWS` | No | Yes | No | No | No | No | Yes | No |
| `0x000F` | `GL06` | Melody | `JL` | `SPEAKER` | No | No | No | No | No | No | No | No |

### 2.3 Bluetrum ABMate Protocol (`DeviceChip.BT`)
* **GATT Service UUID**: `0000fdb3-0000-1000-8000-00805f9b34fb` (SPP fallback UUID: `00001101-0000-1000-8000-00805f9b34fb`; custom BLE notify/write UUID `B6632277-0642-458B-A7A0-23FB1DC92C93`).
* **5-Byte Frame Header (`RequestHandler` / `ResponseHandler`)**:
  ```
  [byte0] = hostSeqNum & 0x0F              (bits 0..3 sequence 0..15)
  [byte1] = cmd                            (opcode)
  [byte2] = cmdType                        (0x01 = REQUEST, 0x02 = RESPONSE, 0x03 = NOTIFY)
  [byte3] = ((fragTotal - 1) << 4) | fragIdx
  [byte4] = fragmentPayloadLen             (0x00 if empty; max default fragment payload 15 bytes = 20 - 5)
  [5..]   = payload bytes
  ```
* **Opcodes (`Command.smali`) & Request Payloads**:
  * `0x20` **EQ**: `[segmentCount (0x0A), eqMode, ...gainBytes[10]]` (`eqMode >= 0x20` = custom slot, `< 0x20` = preset)
  * `0x21` **Music Control**: `[controlType]` (`0x01` Volume+`[vol]`, `0x02` Play, `0x03` Pause, `0x04` Prev, `0x05` Next)
  * `0x22` **Key Mapping**: `[keyType, 0x01, keyFunction]`
    * Key Types: `0x01` L-Single, `0x02` R-Single, `0x03` L-Double, `0x04` R-Double, `0x05` L-Triple, `0x06` R-Triple, `0x07` L-LongPress, `0x08` R-LongPress
    * Key Functions: `0x00` None, `0x01` Recall, `0x02` Voice Assistant, `0x03` Previous, `0x04` Next, `0x05` Vol+, `0x06` Vol-, `0x07` Play/Pause, `0x08` Game Mode, `0x09` ANC Mode
  * `0x23` **Auto Shutdown**: `[setting]` (`0xFF` = cancel, `0x00` = immediate, or timer code)
  * `0x24` **Factory Reset**: empty payload
  * `0x25` **Work Mode**: `[0x00 = Normal, 0x01 = Gaming (Low Latency)]`
  * `0x26` **In-Ear Detect**: `[0x00 | 0x01]`
  * `0x27` **Device Info (TLV Request)**: concatenated pairs `[infoTag, 0x00]`
    * Info tags (`DeviceInfoRequest`): `0x01` Power, `0x02` FW Version, `0x03` BT Name, `0x04` EQ, `0x05` Keys, `0x06` Volume, `0x07` PlayState, `0x08` WorkMode, `0x09` InEar, `0x0A` Language, `0x0B` AutoAnswer, `0x0C` ANC Mode, `0x0D` IsTWS, `0x0E` TWS Connected, `0x0F` LED Switch, `0x10` FW Checksum, `0x11` ANC Gain, `0x12` Transparency Gain, `0x13` ANC Gain Steps, `0x14` Transparency Gain Steps, `0x15` All EQs, `0x16` Main Side, `0x17` Product Color, `0x18` SoundEffect 3D, `0x19` Dual Connect (OneDragTwo), `0x30` Case Key Settings, `0x31` Spatial Audio (`DeviceSpace`), `0x32` LDAC, `0xFE` Device Capabilities bitmask (`0x01` TWS, `0x02` 3D, `0x04` Multipoint, `0x08` ANC), `0xFF` Max Packet Size.
  * `0x28` **Notify**: Async device state TLV pushes (same tags as `0x27`).
  * `0x29` **Voice Prompt Language**: `[0x00 = English, 0x01 = Chinese]`
  * `0x2A` **Find Device**: `[0x01 = start ring, 0x00 = stop]`
  * `0x2B` **Auto Answer**: `[0x00 | 0x01]`
  * `0x2C` **ANC Mode**: `[0x00 = Off, 0x01 = ANC On, 0x02 = Transparency]`
  * `0x2D` **Bluetooth Rename**: `UTF-8 bytes(name)`
  * `0x2E` **LED Mode**: `[0x00 | 0x01]`
  * `0x2F` **Clear Pair Record**: empty
  * `0x30` **ANC Gain**: `[gainByte]`
  * `0x31` **Transparency Gain**: `[gainByte]`
  * `0x32` **Sound Effect 3D**: `[0x00 | 0x01]`
  * `0x33` **Dual Connect (OneDragTwo)**: `[0x01, 0x01, 0x00|0x01]`
  * `0x40` **Case Key Setting**: `[keyType (1..5: Single, Double, Triple, Long, Rotation), length, keyFunction, callControl]`
  * `0x41` **Spatial Audio**: `[0x00 | 0x01]`
  * `0x42` **LDAC Mode**: `[0x00 | 0x01]`
* **Battery Component Byte (`DeviceComponentPower`)**: bit 7 (`0x80`) = `isCharging`, bits 0..6 (`& 0x7F`) = percentage `0..100` (`[left, right, case]`).
* **Standard ACK Response (`ResponsePayloadHandler`)**: single-byte payload `0x00` = success, non-zero = error.

### 2.4 Jieli RCSP Protocol (`DeviceChip.JL`)
* **GATT UUIDs (`BluetoothConstant`)**:
  * Service: `0000ae00-0000-1000-8000-00805f9b34fb`
  * Write Char: `0000ae01-0000-1000-8000-00805f9b34fb`
  * Notify Char: `0000ae02-0000-1000-8000-00805f9b34fb`
* **RCSP Packet Frame (`ParseHelper.packSendBasePacket`)**:
  ```
  [0..2]  = 0xFE 0xDC 0xBA           (magic preamble)
  [3]     = flags                    (bit 7: 0x80 = Command / 0x00 = Response; bit 6: 0x40 = wantsResponse)
  [4]     = opCode                   (0x02 FeatureMap, 0x03 GetTargetInfo, 0x07 GetSysInfo, 0x08 SetSysInfo,
                                      0x19 SearchDev, 0xC0 SetADVInfo, 0xC1 GetADVInfo, 0xFF CustomCmd)
  [5..6]  = paramLen (uint16 BE)
  [7..]   = Command:  [opCodeSn, ...(opCode == 1 ? [xmOpCode] : []), ...paramData]
            Response: [status, opCodeSn, ...(opCode == 1 ? [xmOpCode] : []), ...paramData]
  [last]  = 0xEF                     (end delimiter)
  ```
* **Ultima Custom Jieli EQ Commands (`EqModelImpl` + `EqConstant`)**:
  * **Frequencies**: `[31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]` Hz.
  * **Factory Ultima Curves** (exact floats from `EqConstant.smali`):
    * `DEFAULT_GAIN` / Flat: `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]`
    * `Signature_Sound`: `[3, 12, 6, -3, 0, 8, 12, -3, 4, 10]`
    * `Signature_Sound_311`: `[2, -3, 0, 1, 0, 2, 3, 2, 3, -4]`
    * `Signature_SoundBT`: `[2, 5, 8, 0, -7, -6, 11, 8, 6, -1]`
    * `Balance_Sound`: `[2, 8, 6, -4, 0, 8, 12, -3, 4, 10]`
    * `Balance_Sound_311`: `[1, 2, 1, -2, 1, 2, 5, -2, 5, 0]`
    * `Balance_Soundbt`: `[1, 1, -1, -2, -7, -6, 11, 8, 6, -1]`
  * **Custom Opcode `0xFF`**: `[0x10]` queries Ultima EQ mode; `[0x10, 0x00]` selects **Signature Sound**; `[0x10, 0x01]` selects **Balance Sound**.
  * **CRC-16 (`EqModelImpl.crc16`)**: CCITT-variant bit-swap polynomial initialized at `0xFFFF`, serialized big-endian (`ByteUtil.intToTwoBytes`).

---

## 3. `ULTIMA Fit` Protocol & Feature Specification (`com.crrepa.ble`)

### 3.1 BLE Advertisement (`CRPScanRecordParser`)
* **AD Type `0x09`**: UTF-8 Local Name.
* **AD Type `0x16` (Service Data)** starting with `0xEA 0xFE` (Little-Endian `0xFEEA`):
  * `[2..4]`: 3 ASCII bytes = Firmware type string
  * `[5]`: Platform ID
  * `[6]`: Chip ID
  * `[7..8]`: Supported feature bitmask `((arr[8] << 8) + arr[7])`

### 3.2 GATT Services & Characteristics (`v78.smali`)
* **Primary Vendor Service `0000feea-0000-1000-8000-00805f9b34fb`**:
  * `fee1`: Main command RX/TX notify
  * `fee2`: Main command write (without/with response)
  * `fee3`: Data stream / sensor notifications (steps/sleep/HR/SpO2/BP/ECG/GPS)
  * `fee4`: OTA / Watch face / Extended bulk transfer (`newVersion` / `face`)
  * `fee5`: Fast UI / E-card / Contact push
  * `fee6`: Auxiliary sensor notify
  * `fee7` / `fee8` / `fee9`: Extended watch face, voice/call & file characteristics
* **Standard SIG Services**:
  * `180a` Device Info (`2a28` Firmware Revision, `2a29` Manufacturer, `2a24` Model Number)
  * `180f` Battery (`2a19` Battery Level 0..100%)
  * `180d` Heart Rate (`2a37` HRM measurement)
  * `3802` / `4a02`: Extended MOY/CRREPA service

### 3.3 Packet Framing (`l98.smali`)
```
Byte 0: 0xFE
Byte 1: 0xEA
Byte 2: protoByte  ->  (mtu === 20) ? 0x10 : (totalLen > 0xFF ? (0x20 + (totalLen >> 8)) : 0x20)
Byte 3: (payload.length + 5) & 0xFF   (where totalLen = payload.length + 5)
Byte 4: cmd & 0xFF
Byte 5..: payload bytes
```
*(In standard 23-byte MTU (`usable = 20`), `protoByte = 0x10`; for negotiated larger MTU (`> 20`), `protoByte = 0x20`, enabling multi-byte length encoding up to extended frames).*

### 3.4 Complete Command & Decoder Matrix (`z48` + `m38` + helper classes)
| Cmd Hex | Helper | Feature | Payload Format / Response Decoding |
|---|---|---|---|
| `0x11` | `zb8` | Legacy Alarm (0..2) | Encode: `[id, enabled?1:0, hour, min, repeatMask, ...]` |
| `0x16` | `ol8` | Daily Goal Steps | Encode: 4-byte uint32 BE steps (or status query) |
| `0x17` | `tg8` | Time Format (12/24h) | `[0x00 = 12h, 0x01 = 24h]` |
| `0x18` | `wf8` | Quick View (Raise-to-Wake) | `[0x01 \| 0x00]` |
| `0x19` | `lg8` | Watch Face Select | `[faceId]` (1-based index) |
| `0x1A` | `mp8` | Unit System | `[0x00 = Metric, 0x01 = Imperial]` |
| `0x1B` | `tg8` | Watch Language | `[langId]` (0=EN, 1=ZH_S, 2=ZH_T, 3=DE, 4=ES, 5=FR, etc.) |
| `0x1C` | `tg8` | Sedentary Reminder | `[0x01 \| 0x00]` |
| `0x1F` | `nl8` | 24h Timing HR Interval | `[intervalIn5MinUnits]` (`0` = off, e.g., `1` = 5m, `6` = 30m) |
| `0x21..0x29` | Various | Query Settings | Empty payload queries Goal, TimeSystem, QuickView, Face, Units, Lang, Sedentary |
| `0x31` | `pl8` | Time Sync | `[uint32 BE (epochSec + 28800 GMT+8 adjustment), 0x08]` (plus `0xBB` `[0x07, 0x00, int32 BE offset]` for exact local TZ) |
| `0x32` | `le8` | Sync Today Steps & Sleep | Steps: `[steps(3B BE), distM(3B BE), kcal(3B BE)]`; Sleep: `[startH, startM, endH, endM, state]` chunks (light=0, deep=1, awake=2, REM=3) |
| `0x33` | `le8` | Sync History Steps/Sleep | Query `[dayOffset]` (`1`=yesterday, `2`=2 days ago) |
| `0x35..0x37` | `bo8` | Continuous/Movement HR | 288-slot (5-min buckets) / 1440-byte day array (`c[0..1439]`) |
| `0x3C` / `0x3E` | `oi8` | 24h Continuous SpO2 | Per-slot SpO2 % list for today/yesterday |
| `0x3D` | `dl8` | 24h Continuous BP | Pairs of `[sbp, dbp]` slots |
| `0x41` | `r48` | Push Notification Message | `[messageType (0x00..0x83: Call, SMS, WhatsApp, Instagram, Gmail, etc.), ...UTF-8 emoji-filtered text]` |
| `0x61` | `qm8` | Find Watch | Empty payload -> watch vibrates/rings |
| `0x68` | `ol8.a(Z)` | Dynamic HR / training mode (`startMeasureDynamicRate`) — starts a workout on the watch | `[0x00]` start / `[0xFF]` stop |
| `0x69` | `dl8` | Blood Pressure Measure | `[0, 0, 0]` start / `[0xFF, 0xFF, 0xFF]` stop; Response `[0, sbp, dbp]` |
| `0x6B` | `oi8` | Single SpO2 Measure | `[0x00]` start / `[0xFF]` stop; Response byte 0 = SpO2 % |
| `0x6D` | `ol8.b(Z)` | Single HR Measure (`startMeasureOnceHeartRate`) | `[0x00]` start / `[0xFF]` stop; Response byte 0 = BPM |
| `0x72` | `jg8` | Drink Water / DND Period | `[startHour, startMin, endHour, endMin]` |
| `0x7E` | `oi8`/`dl8` | Timing SpO2 / Cont. Measure | `[subCmd, enable, ...]` |
| `0xB6` | `sd8` | Steps Category & Workout HR | 48 half-hour slots (`96` bytes, 2B BE per slot) & workout HR logs |
| `0xB9` | `zb8`/`mg8` | 8-Slot Alarms & Stress/HRV | Subcmd `0x05`: query (`0x02`), set (`[0x05, 0x00, id, enabled, hour, min, repeat, year-2015BE, month, day]`); Stress `0..100` |
| `0xBB` | `pl8` | Timezone Sync | `[0x07, 0x00, int32 BE tzOffsetSeconds]` |
| `0xBC` | `le8` | Nap Sleep Records | `[year, month, day, startMin2B, duration2B]` |

---

## 4. Unified `Ultima Open` App Architecture

* **`src/protocols/`**: Pure zero-dependency TypeScript byte encoders/decoders (100% unit-testable in Node & React Native):
  * `ultimaLinkConstants.ts` — 14 Ultima Link SKUs, frequencies, factory EQ curves, opcodes
  * `ultimaLinkAdvParser.ts` — `0xD222`/`0xFE22` manufacturer adv parser + MAC XOR `0xAD` + offline license check
  * `ultimaLinkBluetrum.ts` — Bluetrum ABMate 5-byte framer/deframer, fragmented reassembly, TLV builder & all command encoders/decoders
  * `ultimaLinkJieli.ts` — Jieli RCSP `FE DC BA ... EF` framer/parser, Signature/Balance EQ `0xFF`, CRC-16, SearchDev, SetADVInfo
  * `ultimaFitCrrepa.ts` — CRREPA `0xFEEA` scan parser, `FE EA` frame builder/parser, Health/Sleep/HR/SpO2/BP/Steps/Alarm/Notification encoders & decoders
* **`src/storage/offlineStore.ts`**: Zero-network local persistence (custom EQ curves, Ultima Link Find-My last-seen coordinates, Watch Health history, Alarms, Reminder prefs, JSON/CSV backup export & import).
* **`src/services/bleManager.ts`**: Unified BLE transport manager supporting simultaneous Earbuds + Smartwatch connections over `react-native-ble-plx` AND a built-in deterministic **Hardware Simulator** executing real byte frames through the protocol engines.
* **`src/screens/`**: 4 fast, native-feel screens (`DeviceHub`, `AudioStudio`, `HealthWatch`, `InspectorBackup`).
