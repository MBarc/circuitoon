// Pin capability tables shared by the board generators (gen-boards.mjs, and gen-typewriter.mjs for
// the ESP32 DevKitC on its screw terminal board), so one datasheet fact is written once.
// Pin capabilities (PRD "Pin capabilities"): what each GPIO can do, per the chip maker's datasheet,
// cross-checked against a second source. Only pins that exist on the board's header are marked.
//
// ESP32 (Espressif "ESP32 Series Datasheet" v5.3, https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf):
//   - GPIO34-39 are input only, "do not feature an output driver or internal pull-up/pull-down
//     circuitry" (IO_MUX note; SENSOR_VP = GPIO36, SENSOR_VN = GPIO39).
//   - SD_CLK, SD_DATA_0..3 and SD_CMD (GPIO6-11) connect to the off-package flash (Table 2-6).
//   - Strapping pins (section 3, Tables 3-1 to 3-5): GPIO0 (pull-up; 1 = SPI boot, 0 = download),
//     GPIO2 (pull-down; must be 0 for download boot, any value for SPI boot), MTDI = GPIO12
//     (pull-down; 1 = VDD_SDIO 1.8 V), MTDO = GPIO15 (pull-up; 0 = boot log on U0TXD silenced,
//     with GPIO5 it sets SDIO slave timing), GPIO5 (pull-up; SDIO slave timing only).
//   Cross-checked: ESP-IDF GPIO reference (docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/peripherals/gpio.html)
//   and Last Minute Engineers' ESP32 pinout reference (lastminuteengineers.com/esp32-pinout-reference/),
//   which agree on every pin. LME also says GPIO5 and GPIO15 "must be HIGH during boot"; the
//   datasheet shows those two only change the SDIO slave timing and the boot log, so they are
//   "either": a normal boot works at both levels.
const ESP32_IN = (gpio) => ({ inputOnly: true, noPullup: true, note: `GPIO${gpio} has no output driver and no internal pull-up or pull-down.` })
const ESP32_FLASH = (label, gpio) => ({ flash: true, note: `${label} is GPIO${gpio}, wired to the module's SPI flash.` })
export const ESP32_STRAP = {
  0: { strapping: 'high', note: 'GPIO0 low at reset starts the serial download mode instead of your program.' },
  2: { strapping: 'low', note: 'GPIO2 must be low or floating at reset to upload over USB; it does not change a normal boot.' },
  5: { strapping: 'either', note: 'GPIO5 only sets the SDIO slave timing at reset.' },
  12: { strapping: 'low', note: 'GPIO12 (MTDI) high at reset sets the flash voltage to 1.8 V, and the 3.3 V flash on this module then fails to boot.' },
  15: { strapping: 'either', note: 'GPIO15 (MTDO) low at reset only silences the boot messages on UART0.' },
}
/** ESP32 caps for a board's pin names: `gpio` maps a header name to its GPIO number. */
export const esp32Caps = (names, gpio) => Object.fromEntries(names.flatMap((n) => {
  const g = gpio(n)
  if (g === null) return []
  if (g >= 34 && g <= 39) return [[n, ESP32_IN(g)]]
  if (g >= 6 && g <= 11) return [[n, ESP32_FLASH(n, g)]]
  return ESP32_STRAP[g] ? [[n, ESP32_STRAP[g]]] : []
}))
// ESP32-S3 (Espressif "ESP32-S3 Series Datasheet" v2.2, section 3, Tables 3-1 to 3-5): GPIO0 (weak
// pull-up; 1 = SPI boot), GPIO46 (weak pull-down; must be 0 with GPIO0 = 0 for download boot, any
// value for SPI boot), GPIO45 (weak pull-down; 1 = VDD_SPI 1.8 V unless an eFuse forces it),
// GPIO3 (floating; JTAG source, only read when EFUSE_STRAP_JTAG_SEL is burnt). GPIO26-32 are
// flash/PSRAM and GPIO33-37 octal flash/PSRAM (none of 26-34 is on the DevKitC-1 header).
// Cross-checked: ESP-IDF GPIO reference for the ESP32-S3 (same pins; "on boards embedded with
// ESP32-S3R8 / ESP32-S3R8V chip, GPIO33 ~ GPIO37 are also not recommended for other uses") and
// Random Nerd Tutorials' ESP32-S3 DevKitC pinout (strapping GPIO0, 3, 45, 46; GPIO26-32 flash).
export const S3_STRAP = {
  0: { strapping: 'high', note: 'GPIO0 low at reset starts the download mode instead of your program.' },
  3: { strapping: 'either', note: 'GPIO3 picks the JTAG source at reset only when an eFuse enables it.' },
  45: { strapping: 'low', note: 'GPIO45 high at reset sets the flash voltage to 1.8 V, and a module with 3.3 V flash then fails to boot.' },
  46: { strapping: 'low', note: 'GPIO46 must be low at reset to upload in download mode; it does not change a normal boot.' },
}
export const S3_OCTAL = (g) => ({ note: `On boards with octal flash or PSRAM (N8R8, N16R8, WROOM-2) GPIO${g} belongs to the memory: leave it free on those.` })
// ESP32-C3 (Espressif "ESP32-C3 Series Datasheet" v2.4, section 3, Tables 3-1 to 3-3): GPIO9 (weak
// pull-up; 1 = SPI boot, 0 = download), GPIO8 (floating; must be 1 for download boot, any value
// for SPI boot), GPIO2 (floating; "does not determine SPI Boot and Joint Download Boot mode, but it
// is recommended to pull this pin up due to glitches"). GPIO12-17 are the flash pins (not on the
// SuperMini or XIAO headers). Cross-checked: ESP-IDF GPIO reference for the ESP32-C3 ("GPIO2, GPIO8
// and GPIO9 are strapping pins") and Last Minute Engineers' ESP32-C3 SuperMini pinout (GPIO2 and
// GPIO8 high, GPIO9 high for a normal boot). LME also calls GPIO4-7 flash pins; the datasheet says
// they are JTAG pins, so they are not marked.
export const C3_STRAP = {
  2: { strapping: 'high', note: 'Espressif recommends keeping GPIO2 high at reset to avoid boot glitches.' },
  8: { strapping: 'high', note: 'GPIO8 must be high at reset to upload in download mode; it does not change a normal boot.' },
  9: { strapping: 'high', note: 'GPIO9 low at reset starts the download mode instead of your program.' },
}
/** Caps from a strap table, each note prefixed by the header name when it differs ("D9 is GPIO9: ..."). */
export const strapCaps = (table, map) => Object.fromEntries(Object.entries(map).map(([name, g]) => [name, name === String(g) ? table[g] : { ...table[g], note: `${name} is GPIO${g}. ${table[g].note}` }]))
