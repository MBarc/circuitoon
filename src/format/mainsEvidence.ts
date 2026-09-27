// Source evidence for the built-in mains parts (spec section 4): what each exact datasheet or
// standard says, transcribed with the line it came from, and whether it was verified. Generators
// build the parts from it; tests compare the parts against it. A value a source does not state is
// absent here, never guessed. The research log with the reasoning, the rejected sources and every
// blocking item is docs/superpowers/evidence/2026-09-27-mains-parts.md (Task 0, 2026-09-27).
//
// Reading rules used throughout:
// - `quote` is the source's own words (translated only where the source is Japanese or French, and
//   then the original is given too). Where a value is read from a drawing, the quote says what the
//   drawing shows and where.
// - Isolation is recorded only when a source names the insulation class of the mains-to-output
//   barrier. A dielectric or isolation test voltage, a class II statement, a MOPP icon or a
//   safety listing is kept in `extra` and never turned into `isolation` (plan Global Constraints).
// - `lSide` is given in the frame of plan Task 12's patterns: seen from the front of the socket
//   (a plug in the same frame, as it sits in the socket), with the earth contact where Task 12 puts
//   it. A standard that leaves the L side open says so and the value is 'not fixed'.
// - A rating whose source does not say AC or DC (IEC 60664 rated voltages) is 'ac/dc'.

export type Verdict = 'VERIFIED' | 'NOT VERIFIED'
export interface Fact<T> { value: T; quote: string; url: string }
export interface RatingFact { volts: number; amps?: number; service: 'ac' | 'dc' | 'ac/dc'; conditions?: string; quote: string; url: string }
export interface PartEvidence {
  /** The exact part (maker and part number) or standard the part is built from. */
  subject: string
  /** Every URL used, standard or datasheet first; becomes the module's `source`. */
  sources: string[]
  verdict: Verdict
  /** For NOT VERIFIED: what is missing and what the part does meanwhile ("not generated", or "generated with isolation unknown"). */
  blocking?: string
  /** Pin or terminal names in physical order per side, as the source shows them. */
  pins?: Fact<Record<string, string[]>>
  /** Which contact is L, N, PE, seen from the front (outlets, plugs). */
  lSide?: Fact<string>
  ratings?: RatingFact[]
  /** The insulation class the source states for the mains-to-output barrier; absent when it states none. */
  isolation?: Fact<'reinforced' | 'double' | 'basic'>
  acInput?: Fact<[number, number]>
  output?: Fact<{ volts: number }>
  protection?: Fact<'class-1' | 'class-2'>
  loadRange?: Fact<[number, number]>
  /** Anything else a generator needs (fuse rating, control range, leakage, revision, part numbers). */
  extra?: Record<string, Fact<unknown>>
}

const fact = <T>(value: T, quote: string, url: string): Fact<T> => ({ value, quote, url })

// ---------------------------------------------------------------------------------------------
// Sources

/** ANSI/NEMA WD 6-2016, Wiring Devices - Dimensional Specifications (public copy on archive.org). */
const NEMA_WD6 = 'https://archive.org/details/NEMA-WD-6-2016'
const NEMA_WD6_PDF = 'https://archive.org/download/NEMA-WD-6-2016/ANSI-NEMA%20WD%206-2016.pdf'
const WIKI_NEMA = 'https://en.wikipedia.org/wiki/NEMA_connector'
const LEVITON_T5320 = 'https://leviton.com/products/t5320-w'
const LEVITON_5352 = 'https://leviton.com/products/5352'
const LEVITON_515PV = 'https://leviton.com/products/515pv'
const LEVITON_101P = 'https://leviton.com/products/101-p'
/** JIS C 8303:2007 as transcribed by kikakurui.com (the official JISC viewer does not allow download). */
const JIS_C8303 = 'https://kikakurui.com/c8/C8303-2007-01.html'
const JIS_C8303_FIG_A1 = 'https://kikakurui.com/c8/C8303-2007-01/page-25.png'
const WIKI_PLUGS = 'https://en.wikipedia.org/wiki/AC_power_plugs_and_sockets'
const WIKI_BS1363 = 'https://en.wikipedia.org/wiki/BS_1363'
const WIKI_AS3112 = 'https://en.wikipedia.org/wiki/AS/NZS_3112'
const ACCESS_AS3112 = 'https://www.accesscomms.com.au/australian-mains-plug/'
const WIKI_SCHUKO = 'https://en.wikipedia.org/wiki/Schuko'
const WIKI_EUROPLUG = 'https://en.wikipedia.org/wiki/Europlug'
const FR_PHASE = 'https://www.installation-renovation-electrique.com/installation-electrique/conseils-electricite/conseils-travaux-electriques/branchement-prise-electrique-phase-a-droite-a-gauche/'

const HLK_PM01_PAGE = 'https://www.hlktech.net/index.php?id=105'
const HLK_PM03_PAGE = 'https://www.hlktech.net/index.php?id=106'
/** Hi-Link "3W Ultra small series power module" datasheet V2.6, Apr. 12th 2020 (mirror; hlktech.com serves it only through Google Drive). */
const HLK_3W_DS = 'https://geeksvalley.com/wp-content/uploads/2021/07/098-HLK-PM-3W.pdf'

/** Mean Well NGE12 series specification, file NGE12-SPEC 2026-01-14. */
const MW_NGE12 = 'https://www.meanwell.com/Upload/PDF/NGE12/NGE12-SPEC.PDF'

const SONGLE_DS = 'https://www.songlerelay.com/upload/8670/srd-t73-relay-290486.pdf'
const SONGLE_PAGE = 'https://www.songlerelay.com/srd-t73-relay.html'
/** The older two-page Songle SRD sheet that splits the contact rating by contact form. */
const SONGLE_OLD_DS = 'https://www.circuitbasics.com/wp-content/uploads/2015/11/SRD-05VDC-SL-C-Datasheet.pdf'
const RELAY_MODULE_AMAZON = 'https://www.amazon.com/dp/B00LW15A4W'
const RELAY_MODULE_KONNECTED = 'https://konnected.io/products/1-channel-5v-relay-module-with-high-low-level-trigger'

/** Fotek "Solid State Module" catalogue section (SSR series), PDF created 2022-06-21. */
const FOTEK_MANUAL = 'https://www.fotek.com.tw/en-gb/download/61'
const FOTEK_PRODUCT = 'https://www.fotek.com.tw/en-gb/product/801'
const FOTEK_SERIES = 'https://www.fotek.com.tw/en-gb/product-category/143'
const FOTEK_PHOTO = 'https://www.fotek.com.tw/image/catalog/product/Type/SSR-SSR-DA.png'

const LEVITON_9880 = 'https://leviton.com/products/9880'
const OSHA_1910_305 = 'https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.305'
const PHILIPS_A19 = 'https://www.usa.lighting.philips.com/consumer/p/led-bulb-60w-a19-e26/046677568948/specifications'
const VS_CATALOGUE = 'https://old.vossloh-schwabe.com/uploads/tx_sbdownloader/VS-Main-Cat_Standard-2017_EN.pdf'
const PHILIPS_A60 = 'https://www.lighting.philips.co.uk/consumer/p/led-bulb-60-w-a60-e27/8720169324398/specifications'
const IET_559 = 'https://engx.theiet.org/f/wiring-and-regulations/20952/reg-559-5-1-206-e-s-lampholders'

const LF_150274 = 'https://www.littelfuse.com/products/fuses-overcurrent-protection/fuse-holders-fuse-blocks-accessories/fuse-holders/in-line-fuse-holders/150/150274'
const LF_150_DS = 'https://www.littelfuse.com/assetdocs/fuse-holder-150-datasheet?assetguid=fb66d437-9218-4fb5-a6fa-17ac6284bb2e'

const KCD1_DS = 'https://www.chinadaier.com/wp-content/uploads/2017/07/KCD1-2-101.pdf'
const KCD1_PAGE = 'https://www.chinadaier.com/kcd1-2-101-spst-rocker-switch/'

const wago = (n: string): string[] => [`https://www.wago.com/221-${n}`, `https://assets.cef.co.uk/downloads/pdg/wago_221-${n}_datasheet/wago_221-${n}_datasheet.pdf`]

const phoenix = (slug: string): string => `https://www.phoenixcontact.com/en-us/products/${slug}`

const KEFA_KF2EDG = 'https://www.kefaelectronic.com/KF2EDG-STD-5-08-Pluggable-terminal-block-pd40291464.html'
const KEFA_KF301 = 'https://www.kefaelectronic.com/KF301-5-0-PCB-Terminal-Block-pd47313945.html'
const LCSC_KF301_2 = 'https://www.lcsc.com/product-detail/C474881.html'
const LCSC_KF301_3 = 'https://www.lcsc.com/product-detail/C474882.html'

// ---------------------------------------------------------------------------------------------
// Shared facts

const B_STANDARD = 'Standard not read: BS 1363, AS/NZS 3112, CEE 7, DIN 49440, NF C 61-314, EN 50075 and IEC/TR 60083 are paywalled and no public copy was found. The contact layout, L side and rating here are quoted from secondary sources (Wikipedia and a supplier guide), which agree with each other. Disposition: not generated until Michael either accepts these secondary sources for this part or the standard text is obtained.'

const NEMA_5_15_RATING: RatingFact = { volts: 125, amps: 15, service: 'ac', quote: 'FIGURE 5-15 PLUG AND RECEPTACLE 125 volts, 15 amperes, 2 pole, 3 wire, Grounding type', url: NEMA_WD6_PDF }
const NEMA_5_20_RATING: RatingFact = { volts: 125, amps: 20, service: 'ac', quote: 'FIGURE 5-20 PLUG AND RECEPTACLE 125 volts, 20 amperes, 2 pole, 3 wire, Grounding type', url: NEMA_WD6_PDF }
const NEMA_1_15_RATING: RatingFact = { volts: 125, amps: 15, service: 'ac', quote: 'FIGURE 1-15 PLUG AND RECEPTACLE 125 volts, 15 amperes, 2 pole, 2 wire', url: NEMA_WD6_PDF }
const NEMA_L_SIDE = fact(
  'front view, earth hole down: N (W, the wider slot) left, L right',
  'WD 6 p.143 configuration chart and Figure 5-15 (receptacle face): the receptacle is drawn with G (grounding hole) at the top and the slot marked W on the right, so with the earth hole down W is on the left; W is the longer slot (.350/.330 in against .285/.265 in). WD 6 does not define the letter W on the pages read; Wikipedia (NEMA connector) states the layout directly: "In practice, most receptacles have their ground blade on the bottom; in this case, the neutral blade is on the upper left and the hot blade is on the upper right."',
  NEMA_WD6_PDF,
)
const NEMA_SPACING = fact('blade slots 0.500 in (12.7 mm) apart; earth hole centre 0.468 in (11.9 mm) from the slot line', 'Figure 5-15 receptacle: ".500" between the slot centre lines, ".468" from the slot line to the grounding hole centre', NEMA_WD6_PDF)

const JIS_RATING: RatingFact = { volts: 125, amps: 15, service: 'ac', quote: '図A.1−2極差込接続器 15 A 125 V (Figure A.1, 2-pole plug and receptacle 15 A 125 V)', url: JIS_C8303 }

const BS_RATING: RatingFact = { volts: 250, amps: 13, service: 'ac', quote: 'BS 1363 plugs and sockets are rated for use at a maximum of 250 V AC and 13 A.', url: WIKI_BS1363 }
const BS_L_SIDE = fact(
  'front view, earth up: N bottom left, L bottom right',
  'When looking at the front of the socket with the earth aperture uppermost (as normally mounted) the lower left aperture is for the neutral contact, and the lower right is for the line contact.',
  WIKI_BS1363,
)
const AS_RATING: RatingFact = { volts: 250, amps: 10, service: 'ac', quote: 'By the early 1930s this design had been up-rated to 250 V 10 A capacity ... Standard single phase 230 V domestic socket outlets in Australia and New Zealand are rated at 10 A.', url: WIKI_AS3112 }
const AS_L_SIDE = fact(
  'front view, earth down: L (active) top left, N top right',
  'The active terminal is the first \'socket\' from the earth \'socket\' in a clockwise direction when viewing the front of a socket-outlet. (Wikipedia) / On the socket (viewing from the front), the positions are mirrored: top-left is Active and top-right is Neutral. (Access Communications)',
  WIKI_AS3112,
)
const CEE_UNPOLARIZED = fact('not fixed', 'The Schuko system is unpolarized, allowing live and neutral to be reversed.', WIKI_PLUGS)

// ---------------------------------------------------------------------------------------------
// Converters

const HLK_ISOLATION_NOTE = fact(
  'test voltage only, no insulation class',
  'Input and output isolation voltage 3000VAC (product page); Insulation voltage I/P-O/P:2500Vac (datasheet V2.6, 9.2). No insulation class (basic, double, reinforced) is stated anywhere in either source.',
  HLK_3W_DS,
)
const HLK_BLOCKING = 'Isolation class not stated: Hi-Link gives only test voltages (3000 Vac on the product page, 2500 Vac in datasheet V2.6 section 9.2, which also disagree with each other) and "Safety standard meets UL1012,EN60950,UL60950". Disposition: generated with isolation unknown (the checker treats its output as live). This contradicts the spec circuit "HLK-PM01 feeding an ESP32 (clean apart from cable-unverified)" (Resolution 21): Michael decides whether that circuit changes its expected result.'
const HLK_PINS = fact(
  { left: ['AC 1', 'AC 2'], right: ['-Vo', '+Vo'] },
  '11. Dimensions and weight, top side view: pins 1 AC and 2 AC on the left end (1 above 2), pin 3 -Vo top right, pin 4 +Vo bottom right. Pin Function table: 1 AC, 2 AC, 3 -V0, 4 +V0.',
  HLK_3W_DS,
)
const HLK_AC_INPUT = fact<[number, number]>([85, 264], 'Rated input voltage 100-240Vac Input vlotage range 85-264VAC/70-350VDC (product page, spelling as published). Datasheet V2.6 5.1 gives Input voltage range 85-265 Vac; the narrower 85-264 is kept.', HLK_PM01_PAGE)

const MW_ISOLATION_NOTE = fact(
  'class II and a withstand voltage, no insulation class',
  'Class II power (no earth pin); WITHSTAND VOLTAGE I/P-O/P:4000Vac; a "2xMOPP" icon on page 1. No insulation class (basic, double, reinforced) for the input-output barrier is stated.',
  MW_NGE12,
)
const MW_AC_INPUT = fact<[number, number]>([80, 264], '80~264Vac Universal AC input; VOLTAGE RANGE 80 ~ 264Vac 113 ~ 370Vdc', MW_NGE12)
const MW_PROTECTION = fact<'class-2'>('class-2', 'Class II power (no earth pin) ... NGE12 is a Class II power unit (no FG)', MW_NGE12)
const MW_BLOCKING_CORE = 'Isolation class not stated: Mean Well states "Class II power (no earth pin)", a withstand voltage (I/P-O/P 4000Vac) and a 2xMOPP icon, but no insulation class for the barrier. Disposition: generated with isolation unknown (the checker treats the output as live), unless Michael rules that a maker\'s explicit "Class II" statement may be recorded as double insulation.'

/** Which CUI parts were checked first (the plan's first choice) and why they were not used. */
const CUI_NOTE = fact(
  'CUI SWI5-N-USB and SWI5-E-USB exist; no UK or AU USB or barrel version',
  'CUI SWI5-N-USB (input plug "North America, 2-pin") and SWI5-E-USB (input plug "Europe"), both 90~264 Vac, "isolation voltage input to output at 10 mA for 1 minute 3,000 Vac", no class statement. cui.com and belfuse.com list no UK or Australian version of either, so one maker for all four regions meant Mean Well NGE12.',
  'https://www.cui.com/product/resource/swi5-n-usb.pdf',
)

function charger(region: 'us' | 'eu' | 'uk' | 'au', kind: 'usb' | 'barrel'): PartEvidence {
  const plug = { us: 'AC PLUG-US4', eu: 'AC PLUG-EU4', uk: 'AC PLUG-UK4', au: 'AC PLUG-AU4' }[region]
  const model = kind === 'usb' ? 'NGE12I05-USB' : 'NGE12I12-P1J'
  const family = { us: WIKI_NEMA, eu: WIKI_EUROPLUG, uk: WIKI_BS1363, au: WIKI_AS3112 }[region]
  const missing = [
    MW_BLOCKING_CORE,
    region === 'uk' ? 'UK plug fuse not stated: the NGE12 sheet gives no BS 1362 fuse rating for AC PLUG-UK4 and does not say it is fused; the UK device\'s integral fuse edge cannot be generated with a rating.' : '',
    region === 'us' ? 'Plug polarity not stated: the sheet does not say whether AC PLUG-US4 has a wider neutral blade; treating it as the unpolarized nema-1-15p (as the plan does) is the conservative reading.' : '',
    region === 'eu' ? 'The sheet calls AC PLUG-EU4 only "EU"; that it is a CEE 7/16 Europlug is read from the photo, not stated.' : '',
    region === 'au' ? 'The sheet calls AC PLUG-AU4 only "AU"; its AS/NZS 3112 geometry is read from the photo, not stated.' : '',
  ].filter(Boolean).join(' ')
  return {
    subject: `Mean Well ${model} with ${plug} (NGE12 series, interchangeable AC plug)`,
    sources: [MW_NGE12, family],
    verdict: 'NOT VERIFIED',
    blocking: missing,
    acInput: MW_AC_INPUT,
    output: kind === 'usb'
      ? fact({ volts: 5 }, 'NGE12 05-USB: DC VOLTAGE 5V, RATED CURRENT 2.4A; USB: USB-type A for 5V model only', MW_NGE12)
      : fact({ volts: 12 }, 'NGE12 12-P1J: DC VOLTAGE 12V, RATED CURRENT 1.0A; P1J: Plug for standard model, 2.1φ×5.5φ×11mm, C+ tuning fork type', MW_NGE12),
    protection: MW_PROTECTION,
    extra: {
      isolationNote: MW_ISOLATION_NOTE,
      acPlug: fact(plug, `Interchangeable AC Plug ... AC plug: EU US UK AU CN KR IN; AC Plugs Accessory: ${plug}`, MW_NGE12),
      revision: fact('NGE12-SPEC 2026-01-14', 'File Name:NGE12-SPEC 2026-01-14', MW_NGE12),
      cuiChecked: CUI_NOTE,
      ...(kind === 'barrel' ? { barrel: fact('2.1 x 5.5 mm, centre positive', 'P1J :Plug for standard model, 2.1φ×5.5φ×11mm,C+ tuning fork type', MW_NGE12) } : {}),
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Phoenix Contact COMBICON

/** The ratings Phoenix gives, per overvoltage category / pollution degree, for plug and header; the assembly keeps the lower of each pair. */
function phoenixRatings(series: 'mstb' | 'mc', plugUrl: string, headerUrl: string): RatingFact[] {
  if (series === 'mstb')
    return [
      { volts: 250, amps: 12, service: 'ac/dc', conditions: 'overvoltage category III, pollution degree 3 (IEC 60664-1)', quote: 'Plug: Rated voltage (III/3) 250 V, Nominal current IN 12 A. Header: Rated voltage (III/3) 320 V, Nominal current IN 12 A. The lower (plug) value is kept.', url: plugUrl },
      { volts: 320, amps: 12, service: 'ac/dc', conditions: 'overvoltage category III, pollution degree 2 (IEC 60664-1)', quote: 'Plug and header: Rated voltage (III/2) 320 V, Nominal current IN 12 A.', url: headerUrl },
      { volts: 630, amps: 12, service: 'ac/dc', conditions: 'overvoltage category II, pollution degree 2 (IEC 60664-1)', quote: 'Plug and header: Rated voltage (II/2) 630 V, Nominal current IN 12 A.', url: plugUrl },
    ]
  return [
    { volts: 160, amps: 8, service: 'ac/dc', conditions: 'overvoltage category III, pollution degree 3 (IEC 60664-1)', quote: 'Plug and header: Rated voltage (III/3) 160 V, Nominal current IN 8 A.', url: plugUrl },
    { volts: 160, amps: 8, service: 'ac/dc', conditions: 'overvoltage category III, pollution degree 2 (IEC 60664-1)', quote: 'Plug and header: Rated voltage (III/2) 160 V, Nominal current IN 8 A.', url: plugUrl },
    { volts: 250, amps: 8, service: 'ac/dc', conditions: 'overvoltage category II, pollution degree 2 (IEC 60664-1)', quote: 'Plug: Rated voltage (II/2) 320 V. Header: Rated voltage (II/2) 250 V. The lower (header) value is kept. Nominal current IN 8 A.', url: headerUrl },
  ]
}

const PHOENIX_ITEMS = {
  mstb: { 2: ['1757019', '1757242'], 3: ['1757022', '1757255'], 4: ['1757035', '1757268'], 5: ['1757048', '1757271'], 6: ['1757051', '1757284'] },
  mc: { 2: ['1803578', '1803277'], 3: ['1803581', '1803280'], 4: ['1803594', '1803293'], 5: ['1803604', '1803303'], 6: ['1803617', '1803316'] },
} as const

/** Item numbers whose own Phoenix product page was read (the page title names the type and item number). */
const PHOENIX_READ = new Set(['1757019', '1757242', '1757255', '1803578', '1803277', '1803581'])

function phoenixPart(series: 'mstb' | 'mc', n: 2 | 3 | 4 | 5 | 6): PartEvidence {
  const [plug, header] = PHOENIX_ITEMS[series][n]
  const plugType = series === 'mstb' ? `MSTB 2,5/ ${n}-ST-5,08` : `MC 1,5/ ${n}-ST-3,81`
  const headerType = series === 'mstb' ? `MSTBA 2,5/ ${n}-G-5,08` : `MC 1,5/ ${n}-G-3,81`
  const plugUrl = phoenix(series === 'mstb' ? `pcb-plug-mstb-25-${n}-st-508-${plug}` : `pcb-plug-mc-15-${n}-st-381-${plug}`)
  const headerUrl = phoenix(series === 'mstb' ? `pcb-header-mstba-25-${n}-g-508-${header}` : `pcb-header-mc-15-${n}-g-381-${header}`)
  const unread = [plug, header].filter((i) => !PHOENIX_READ.has(i))
  const verified = unread.length === 0
  return {
    subject: `Phoenix Contact ${plugType} (plug ${plug}) with ${headerType} (header ${header})`,
    sources: [plugUrl, headerUrl],
    verdict: verified ? 'VERIFIED' : 'NOT VERIFIED',
    ...(verified ? {} : { blocking: `Item number(s) ${unread.join(' and ')} not confirmed: phoenixcontact.com answered HTTP 403 (bot protection) after the first pages, so the product page of each unread item was not opened. The item numbers are the plan's; the ratings are the same family's (MSTB 2,5/..-ST and MSTBA 2,5/..-G, or MC 1,5/..-ST and MC 1,5/..-G) as read on the 2- and 3-position pages, but ratings are only recorded here per read item. Disposition: not generated until each page is read.` }),
    ...(verified ? { ratings: phoenixRatings(series, plugUrl, headerUrl) } : {}),
    extra: {
      plug: fact(plug, verified || PHOENIX_READ.has(plug) ? `${plugType} - PCB connector ${plug}` : `(plan value, page not read) ${plugType} ${plug}`, plugUrl),
      header: fact(header, verified || PHOENIX_READ.has(header) ? `${headerType} - PCB header ${header}` : `(plan value, page not read) ${headerType} ${header}`, headerUrl),
      pitch: fact(series === 'mstb' ? 5.08 : 3.81, series === 'mstb' ? 'pitch 5.08 mm' : 'Pitch 3.81 mm', plugUrl),
      ...(verified
        ? {
            ul: fact(series === 'mstb' ? 'cULus 300 V 15 A (use group B), 300 V 10 A (use group D)' : 'cULus 300 V 8 A (use groups B and D)', series === 'mstb' ? 'cULus Recognized, Approval ID: E60425-19931011: B 300 V 15 A; D 300 V 10 A' : 'cULus Recognized, Approval ID: E60425-20110128: B 300 V 8 A; D 300 V 8 A', plugUrl),
            noHotPlug: fact(true, 'In accordance with IEC 61984, COMBICON connectors have no switching power (COC). During designated use, they must not be plugged in or disconnected when carrying voltage or under load.', plugUrl),
          }
        : {}),
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The table

export const EVIDENCE: Record<string, PartEvidence> = {
  // ----- Outlets -----
  'outlet-us-5-15r-duplex': {
    subject: 'NEMA 5-15R duplex receptacle (ANSI/NEMA WD 6-2016 Figure 5-15); face reference Leviton T5320-W',
    sources: [NEMA_WD6, NEMA_WD6_PDF, WIKI_NEMA, LEVITON_T5320],
    verdict: 'VERIFIED',
    lSide: NEMA_L_SIDE,
    ratings: [NEMA_5_15_RATING],
    extra: {
      spacing: NEMA_SPACING,
      product: fact('Leviton T5320-W, 15 A 125 VAC, NEMA 5-15R', 'Amperage : 15 A; NEMA : 5-15R; Voltage : 125 VAC; NEMA : WD-6', LEVITON_T5320),
    },
  },
  'outlet-us-5-20r-duplex': {
    subject: 'NEMA 5-20R duplex receptacle (ANSI/NEMA WD 6-2016 Figure 5-20, T-slot neutral); face reference Leviton 5352',
    sources: [NEMA_WD6, NEMA_WD6_PDF, WIKI_NEMA, LEVITON_5352],
    verdict: 'VERIFIED',
    lSide: fact(NEMA_L_SIDE.value, 'WD 6 p.143 chart and Figure 5-20 (receptacle face): G at the top, the T-shaped slot marked W on the right; with the earth hole down W (neutral) is on the left and L on the right.', NEMA_WD6_PDF),
    ratings: [NEMA_5_20_RATING],
    extra: {
      spacing: fact('blade slots 0.500 in (12.7 mm) apart; earth hole centre 0.468 in from the slot line', 'Figure 5-20 receptacle: ".500" between the slot centre lines, ".468" to the grounding hole', NEMA_WD6_PDF),
      product: fact('Leviton 5352, 20 A 125 V, NEMA 5-20R', 'Duplex Receptacle Outlet, Heavy-Duty Industrial Specification Grade, Smooth Face, 20 Amp, 125 Volt, Back or Side Wire, NEMA 5-20R, 2-Pole, 3-Wire, Self-Grounding', LEVITON_5352),
    },
  },
  'outlet-uk-bs1363': {
    subject: 'BS 1363 13 A single socket-outlet',
    sources: [WIKI_BS1363, WIKI_PLUGS],
    verdict: 'NOT VERIFIED',
    blocking: B_STANDARD,
    lSide: BS_L_SIDE,
    ratings: [BS_RATING],
    extra: {
      spacing: fact('line and neutral centres 22.2 mm apart; earth centre line 22.2 mm from the line/neutral centre line', '... 17.7 mm long and with centres 22.2 mm apart. ... with a centre line 22.2 mm from the line/neutral pin centre line.', WIKI_BS1363),
      standardPolarity: fact('earth top, live right', 'The polarity of all grounded British sockets is standardized: earth is at the top and live is at the right of the socket.', WIKI_PLUGS),
    },
  },
  'outlet-schuko-cee7-3': {
    subject: 'CEE 7/3 (Schuko, DIN 49440) single socket-outlet',
    sources: [WIKI_SCHUKO, WIKI_PLUGS],
    verdict: 'NOT VERIFIED',
    blocking: `${B_STANDARD} No rated voltage was found at all: the sources give 16 A and "circuits with 230 V", so no rating is recorded (the plan's 250 V is unsourced).`,
    lSide: CEE_UNPOLARIZED,
    extra: {
      spacing: fact('pins 4.8 mm diameter, centres 19 mm apart', 'two round pins of 4.8 mm diameter (19 mm long, centres 19 mm apart)', WIKI_SCHUKO),
      rated16: fact(16, 'The CEE 7/3 socket and CEE 7/4 plug are commonly called Schuko ... It is rated at 16 A.', WIKI_PLUGS),
    },
  },
  'outlet-fr-cee7-5': {
    subject: 'CEE 7/5 (French, NF C 61-314) single socket-outlet with earth pin',
    sources: [WIKI_PLUGS, FR_PHASE],
    verdict: 'NOT VERIFIED',
    blocking: `${B_STANDARD} In addition, no source fixes which hole is L: the French installation guide says no standard does ("Niveau norme, il n'y a rien qui indique que la phase doit etre branchee a droite ou a gauche") and that the usual practice is phase on the right seen from the front ("l'usage veut que la phase soit a droite"), while plan Task 12 puts L on the left for the CEE patterns. Proposed: treat cee7-5 like cee7-3 for polarity (Resolution 22's unpolarized list), since the plug's orientation is fixed by the earth pin but the socket's wiring is not; Michael decides. No rating was found in any source read (the plan's 16 A 250 V is unsourced), so none is recorded.`,
    lSide: fact('not fixed', 'Niveau norme, il n\'y a rien qui indique que la phase doit être branchée à droite ou à gauche ... l\'usage veut que la phase soit à droite (no standard says the phase goes right or left; practice puts it on the right)', FR_PHASE),
    extra: {
      spacing: fact('holes 19 mm apart; earth pin centred between them, offset 10 mm', 'The earth pin is centred between the apertures, offset by 10 mm (0.394 in). The plug has two round pins measuring 4.8 by 19 mm (0.189 by 0.748 in), spaced 19 mm (0.748 in) apart', WIKI_PLUGS),
    },
  },
  'outlet-au-as3112': {
    subject: 'AS/NZS 3112 10 A single socket-outlet',
    sources: [WIKI_AS3112, ACCESS_AS3112],
    verdict: 'NOT VERIFIED',
    blocking: `${B_STANDARD} Also: both sources put the active (L) at the top LEFT seen from the front with the earth down, but plan Task 12's AS pattern puts L at (10, -10), top right. Task 12 must swap L and N for as3112 (pattern and plug profile together).`,
    lSide: AS_L_SIDE,
    ratings: [AS_RATING],
    extra: {
      spacing: fact('active and neutral centred 7.92 mm from the midpoint at 30 degrees to the vertical, earth centred 10.31 mm away', 'The pins are arranged at 120° angles around a common midpoint, with the active and neutral centred 7.92 mm (5⁄16 in) from the midpoint, and the earth pin centred 10.31 mm (3⁄8 in) away.', WIKI_AS3112),
    },
  },
  'outlet-jp-1-15r-duplex': {
    subject: 'JIS C 8303 2-pole 15 A 125 V receptacle, unpolarized (Figure A.1, note a)), duplex',
    sources: [JIS_C8303, JIS_C8303_FIG_A1, WIKI_PLUGS],
    verdict: 'VERIFIED',
    lSide: fact('not fixed', '注a) 極性を付けないときは刃幅を6.3±0.3 mm，刃受穴の幅を7±0.3 mmとする。(Figure A.1 note a): when not polarized, the blade width is 6.3 mm and both receptacle holes are 7 mm wide, so neither hole is marked.)', JIS_C8303),
    ratings: [JIS_RATING],
    extra: {
      spacing: fact('slots 12.7 mm apart', 'Figure A.1, 刃受穴 (receptacle holes): 12.7 between the hole centre lines', JIS_C8303_FIG_A1),
      jisPolarityRule: fact('JIS C 8303:2007 allows omitting polarity except on receptacles', '注b) コンセントを除き，極性を付けることが使用上必要がないもの，又は構造上困難なものは，極性を付けなくてもよい。(Except receptacles, devices for which polarity is unnecessary or hard to build may be unpolarized.) So a new JIS C 8303:2007 receptacle is polarized; the unpolarized face is the older one still in service ("Older Japanese sockets ... are unpolarized", Wikipedia).', JIS_C8303),
    },
  },
  'outlet-jp-1-15r-duplex-polarized': {
    subject: 'JIS C 8303 2-pole 15 A 125 V receptacle, polarized (Figure A.1), duplex',
    sources: [JIS_C8303, JIS_C8303_FIG_A1, WIKI_PLUGS],
    verdict: 'VERIFIED',
    lSide: fact('front view: N (接地側極, the longer 8.7 mm slot) left, L right', 'Figure A.1, 刃受穴 (receptacle holes, face view): the left hole is labelled 接地側極 (grounded-side pole) and is 8.7±0.4 mm long, the right hole 7±0.3 mm; the plug drawing (刃) beside it is mirrored, with 接地側極 on the right, which confirms the receptacle is drawn from the front.', JIS_C8303_FIG_A1),
    ratings: [JIS_RATING],
    extra: {
      spacing: fact('slots 12.7 mm apart', 'Figure A.1, 刃受穴: 12.7 between the hole centre lines', JIS_C8303_FIG_A1),
    },
  },

  // ----- USB chargers and barrel adapters -----
  'charger-usb-5v-us': charger('us', 'usb'),
  'charger-usb-5v-eu': charger('eu', 'usb'),
  'charger-usb-5v-uk': charger('uk', 'usb'),
  'charger-usb-5v-au': charger('au', 'usb'),
  'adapter-barrel-us': charger('us', 'barrel'),
  'adapter-barrel-eu': charger('eu', 'barrel'),
  'adapter-barrel-uk': charger('uk', 'barrel'),
  'adapter-barrel-au': charger('au', 'barrel'),

  // ----- Cord plugs -----
  'plug-us-5-15p': {
    subject: 'NEMA 5-15P plug (ANSI/NEMA WD 6-2016 Figure 5-15); reference Leviton 515PV',
    sources: [NEMA_WD6_PDF, LEVITON_515PV],
    verdict: 'VERIFIED',
    lSide: fact('in the socket frame (earth down): N left, L right', 'WD 6 p.143 chart: the 5-15P blade-end view is the mirror of the 5-15R face (G top, W on the left for the one-wide-blade plug), so in the socket\'s frame the plug\'s W (neutral) blade sits in the W slot, left with the earth down.', NEMA_WD6_PDF),
    ratings: [NEMA_5_15_RATING, { volts: 125, amps: 15, service: 'ac', quote: '15 Amp, 125 Volt, NEMA 5-15P, 2-Pole, 3-Wire Plug, Straight Blade ... Amperage : 15 A; Voltage : 125 VAC', url: LEVITON_515PV }],
  },
  'plug-us-1-15p': {
    subject: 'NEMA 1-15P polarized plug (ANSI/NEMA WD 6-2016 Figure 1-15); reference Leviton 101-P',
    sources: [NEMA_WD6_PDF, LEVITON_101P],
    verdict: 'VERIFIED',
    lSide: fact('in the socket frame: N (wide blade) left, L right', 'WD 6 p.143 chart: 1-15P POLARIZED is drawn with the W blade wider; it enters the W slot of a 1-15R or 5-15R only. Leviton 101-P: "Feature : Polarized".', NEMA_WD6_PDF),
    ratings: [NEMA_1_15_RATING, { volts: 125, amps: 15, service: 'ac', quote: 'Plug, Straight Blade, Residential Grade, 15 Amp, 125 Volt, NEMA 1-15P, 2-Pole, 2-Wire, Polarized, Non-Grounding', url: LEVITON_101P }],
  },
  'plug-jp-1-15p': {
    subject: 'JIS C 8303 2-pole 15 A 125 V plug, unpolarized blades (Figure A.1, note a))',
    sources: [JIS_C8303, JIS_C8303_FIG_A1],
    verdict: 'VERIFIED',
    lSide: fact('not fixed', '注a) 極性を付けないときは刃幅を6.3±0.3 mm (when not polarized, both blades are 6.3 mm wide)', JIS_C8303),
    ratings: [JIS_RATING],
    extra: {
      spacing: fact('blades 12.7 mm apart', 'Figure A.1, 刃 (blades): 12.7 between the blade centre lines', JIS_C8303_FIG_A1),
    },
  },
  'plug-eu-cee7-7': {
    subject: 'CEE 7/7 hybrid Schuko/French plug (earth clips and earth hole)',
    sources: [WIKI_PLUGS, WIKI_SCHUKO],
    verdict: 'NOT VERIFIED',
    blocking: `${B_STANDARD} No rated voltage was found for CEE 7/7, so no rating is recorded.`,
    lSide: fact('not fixed', 'Due to its compatibility with the inherently unpolarized Schuko (CEE 7/4) plugs, appliances using it cannot expect the current to flow in any particular direction.', WIKI_PLUGS),
    extra: {
      rated16: fact(16, 'The plug is rated at 16 A and looks similar to CEE 7/4 plugs, but with earth contacts to fit both CEE 7/5 and CEE 7/3 sockets.', WIKI_PLUGS),
    },
  },
  'plug-eu-cee7-16': {
    subject: 'CEE 7/16 Europlug (EN 50075)',
    sources: [WIKI_EUROPLUG, WIKI_PLUGS],
    verdict: 'NOT VERIFIED',
    blocking: B_STANDARD,
    lSide: fact('not fixed', 'It can be inserted in either direction, so live and neutral are connected arbitrarily.', WIKI_PLUGS),
    ratings: [{ volts: 250, amps: 2.5, service: 'ac', quote: 'The Europlug ... is a flat, non-rewirable two-pole, round-pin domestic AC power plug, rated for voltages up to 250 V and currents up to 2.5 A.', url: WIKI_EUROPLUG }],
  },
  'plug-uk-bs1363-3lead': {
    subject: 'BS 1363-1 13 A fused plug, 3 leads',
    sources: [WIKI_BS1363, WIKI_PLUGS],
    verdict: 'NOT VERIFIED',
    blocking: B_STANDARD,
    lSide: fact('in the socket frame (earth up): N bottom left, L bottom right', 'When looking at the plug pins with the earth uppermost the lower left pin is live, and the lower right is neutral. (pin-face view; mirrored into the socket frame this is L bottom right)', WIKI_BS1363),
    ratings: [BS_RATING],
    extra: {
      fuse: fact(13, 'BS 1363 ... rated for up to 250 V and 13 A ... The standard specifies breaking time versus current characteristics only for 3 A or 13 A fuses. (13 A is the plan\'s default fuseRating; a moulded plug may carry less.)', WIKI_BS1363),
    },
  },
  'plug-uk-bs1363-2lead': {
    subject: 'BS 1363-1 13 A fused plug, 2 leads (earth pin present, nothing joined to it)',
    sources: [WIKI_BS1363, WIKI_PLUGS],
    verdict: 'NOT VERIFIED',
    blocking: B_STANDARD,
    lSide: fact('in the socket frame (earth up): N bottom left, L bottom right', 'When looking at the plug pins with the earth uppermost the lower left pin is live, and the lower right is neutral.', WIKI_BS1363),
    ratings: [BS_RATING],
    extra: {
      fuse: fact(13, 'The standard specifies breaking time versus current characteristics only for 3 A or 13 A fuses.', WIKI_BS1363),
    },
  },
  'plug-au-as3112-3lead': {
    subject: 'AS/NZS 3112 10 A plug, 3 leads',
    sources: [WIKI_AS3112, ACCESS_AS3112],
    verdict: 'NOT VERIFIED',
    blocking: `${B_STANDARD} Plan Task 12's AS L side is reversed (see outlet-au-as3112).`,
    lSide: fact('in the socket frame (earth down): L top left, N top right', 'When viewing a plug from its face (Earth facing downwards), the top left prong is Neutral and the top right is Active (Live/Phase). (pin-face view; mirrored into the socket frame the active is top left)', WIKI_AS3112),
    ratings: [AS_RATING],
  },
  'plug-au-as3112-2lead': {
    subject: 'AS/NZS 3112 10 A plug, 2 leads (class II appliance)',
    sources: [WIKI_AS3112, ACCESS_AS3112],
    verdict: 'NOT VERIFIED',
    blocking: `${B_STANDARD} Plan Task 12's AS L side is reversed (see outlet-au-as3112). Whether a 2-lead AS/NZS 3112 plug keeps an earth pin was not established (the plan gives it roles L and N only).`,
    lSide: fact('in the socket frame (earth down): L top left, N top right', 'When viewing a plug from its face (Earth facing downwards), the top left prong is Neutral and the top right is Active (Live/Phase).', WIKI_AS3112),
    ratings: [AS_RATING],
  },

  // ----- AC-DC modules -----
  'hlk-pm01': {
    subject: 'Hi-Link HLK-PM01 (5 V, 3 W), datasheet "3W Ultra small series power module" V2.6, Apr. 12th 2020',
    sources: [HLK_3W_DS, HLK_PM01_PAGE, 'https://components101.com/sites/default/files/component_datasheet/HLK-PM01%20AC%20to%20DC%205V%20Power%20Module.pdf'],
    verdict: 'NOT VERIFIED',
    blocking: HLK_BLOCKING,
    pins: HLK_PINS,
    acInput: HLK_AC_INPUT,
    output: fact({ volts: 5 }, 'HLK-PM01 ... Output voltage (V) 5, Output current (mA) 600', HLK_3W_DS),
    extra: {
      isolationNote: HLK_ISOLATION_NOTE,
      fuse: fact('1A/250Vac slow blow, external, recommended', 'External fuse recommended 1A / 250Vac ... Fuse and varistor are basic protective circuits (must be connected).', HLK_3W_DS),
      certification: fact('certification is the customer\'s', 'Product design meets UL and CE safety certification requirements. (The UL and CE certifications are made by the customer and need to be designed according to the reference circuit.)', HLK_3W_DS),
    },
  },
  'hlk-pm03': {
    subject: 'Hi-Link HLK-PM03 (3.3 V, 3 W), datasheet "3W Ultra small series power module" V2.6, Apr. 12th 2020',
    sources: [HLK_3W_DS, HLK_PM03_PAGE],
    verdict: 'NOT VERIFIED',
    blocking: HLK_BLOCKING,
    pins: HLK_PINS,
    acInput: fact<[number, number]>([85, 264], 'Rated input voltage 100-240Vac Input vlotage range 85-264VAC/70-350VDC (product page, spelling as published). Datasheet V2.6 5.1 gives Input voltage range 85-265 Vac; the narrower 85-264 is kept.', HLK_PM03_PAGE),
    output: fact({ volts: 3.3 }, 'HLK-PM03 ... Output voltage (V) 3.3, Output current (mA) 1000', HLK_3W_DS),
    extra: {
      isolationNote: fact('test voltage only, no insulation class', 'Input and output isolation voltage 3000VAC (product page); Insulation voltage I/P-O/P:2500Vac (datasheet). No insulation class is stated.', HLK_PM03_PAGE),
      fuse: fact('1A/250Vac slow blow, external, recommended', 'External fuse recommended 1A / 250Vac ... Fuse and varistor are basic protective circuits (must be connected).', HLK_3W_DS),
    },
  },

  // ----- Loads and wiring -----
  'lamp-holder-e26': {
    subject: 'Leviton 9880 keyless porcelain medium-base (E26) lampholder; lamp Philips 9.5A19/PER/827RGBOP/FR/P/E26 (UPC 046677568948)',
    sources: [LEVITON_9880, OSHA_1910_305, PHILIPS_A19],
    verdict: 'VERIFIED',
    ratings: [{ volts: 250, service: 'ac', quote: 'Voltage : 250 Volt; Wattage Rating : 660W (no current rating is given)', url: LEVITON_9880 }],
    loadRange: fact<[number, number]>([120, 120], 'Voltage AC 120 V; Socket E26; Product title 9.5A19/PER/827RGBOP/FR/P/E26/SS 4/1PF', PHILIPS_A19),
    extra: {
      earth: fact(false, 'Termination : 2 Terminal Screws (no earth terminal listed)', LEVITON_9880),
      lampVolts: fact(120, 'Voltage AC 120 V', PHILIPS_A19),
      shellIsN: fact(true, 'Lampholders of the screw-shell type shall be installed for use as lampholders only. Where supplied by a circuit having a grounded conductor, the grounded conductor shall be connected to the screw shell. (29 CFR 1910.305(j)(1))', OSHA_1910_305),
      watts: fact(660, 'Wattage Rating : 660W', LEVITON_9880),
    },
  },
  'lamp-holder-e27': {
    subject: 'Vossloh-Schwabe E27 porcelain lampholder, three-piece, type 62061, Ref. No. 535685 (with earth screw); lamp Philips LED 60W A60 E27 WW FR ND 1SRT4 UK (12NC 929003817684)',
    sources: [VS_CATALOGUE, PHILIPS_A60, IET_559],
    verdict: 'NOT VERIFIED',
    blocking: 'The shell-on-N requirement is not established for E27: BS 7671 reg. 559.5.1.206 (as reported by the IET forum; the regulation text was not read) requires the outer contact on N for Edison screw lampholders but exempts E14 and E27 lampholders to BS EN 60238, and no free source for IEC 60364-5-55 was found. The holder, its rating, its earth screw and the lamp range are verified. Disposition: generate the holder with L and N terminals but without the N requirement on the shell (so no polarity finding), unless Michael wants the requirement kept as good practice.',
    ratings: [{ volts: 250, amps: 4, service: 'ac', quote: 'E27 lampholder, three-piece. Material: porcelain, white, T240, nominal rating: 4/250 (IEC 60238 marking: 4 A, 250 V; the catalogue does not spell out the units)', url: VS_CATALOGUE }],
    loadRange: fact<[number, number]>([220, 240], 'Voltage AC 220-240 V; Socket E27; Product title LED 60W A60 E27 WW FR ND 1SRT4 UK', PHILIPS_A60),
    extra: {
      earth: fact(true, 'Type: 62061 female nipple: M10x1 ... Ref. No.: 535685 with earth screw', VS_CATALOGUE),
      lampVolts: fact(230, 'Voltage AC 220-240 V (230 V taken as the lamp\'s nominal, inside the stated range)', PHILIPS_A60),
    },
  },
  'fuse-holder-5x20-inline': {
    subject: 'Littelfuse 150274 (ordering number 01500274Z) in-line fuseholder for 5 x 20 mm fuses',
    sources: [LF_150_DS, LF_150274],
    verdict: 'VERIFIED',
    ratings: [{ volts: 350, amps: 10, service: 'ac/dc', quote: 'Maximum current ratings are 5 amperes at 350V for the 2AG size fuses and 10 amperes at 350V for the 5 × 20mm size fuses. ... Maximum AC Voltage (V) 350; Maximum DC Voltage (V) 350', url: LF_150_DS }],
    extra: {
      planReferenceRejected: fact('Schurter FPG4 is a PCB-mount holder, not in-line', 'FPG4: Shock-Safe Fuseholder, 5 x 20 mm, Slotted Cap/Fingergrip, vertical ... Mounting PCB, Terminal Solder THT', 'https://www.schurter.com/en/datasheet/typ_FPG4.pdf'),
      changingFuse: fact('power off above 32 V', '** If use above 32V, power must be turn off when changing the fuse.', LF_150_DS),
      leads: fact('16 AWG red leads', 'Wire 16 Awg size; Nominal o.d. 0.104"; color Red', LF_150_DS),
    },
  },
  'rocker-switch-kcd1': {
    subject: 'Yueqing Daier KCD1-2-101 SPST rocker switch (generic KCD1-101 parts are copies of this sheet)',
    sources: [KCD1_DS, KCD1_PAGE],
    verdict: 'VERIFIED',
    ratings: [
      { volts: 250, amps: 6, service: 'ac', quote: 'The Main Technology Performance: Rated voltage, Rated current 6A 250V AC, 10A 125V AC', url: KCD1_DS },
      { volts: 125, amps: 10, service: 'ac', quote: 'The Main Technology Performance: Rated voltage, Rated current 6A 250V AC, 10A 125V AC', url: KCD1_DS },
    ],
    extra: {
      dielectric: fact('1500 V AC', 'Dielectric strength ≥1500V AC/5S', KCD1_DS),
    },
  },
  'wago-221-412': {
    subject: 'WAGO 221-412 splicing connector with levers, 2-conductor',
    sources: wago('412'),
    verdict: 'VERIFIED',
    ratings: [{ volts: 450, amps: 32, service: 'ac/dc', conditions: 'overvoltage category II, pollution degree 2 (EN 60664); rated surge voltage 4 kV', quote: 'Ratings per EN 60664: Overvoltage category II, Pollution degree 2: Nominal voltage 450 V, Rated surge voltage 4 kV, Rated current 32 A (the III/3 and III/2 columns are "-")', url: wago('412')[1] }],
    extra: {
      ul: fact('UL 486C use group C: 600 V 20 A', 'Approvals per UL 486C, Use group C: Rated voltage 600 V, Rated current 20 A', wago('412')[1]),
      positions: fact(2, 'Connection points 2; Total number of potentials 1', wago('412')[1]),
      revision: fact('Version 11.03.2024', 'Page 1/8 Version 11.03.2024', wago('412')[1]),
    },
  },
  'wago-221-413': {
    subject: 'WAGO 221-413 splicing connector with levers, 3-conductor',
    sources: wago('413'),
    verdict: 'VERIFIED',
    ratings: [{ volts: 450, amps: 32, service: 'ac/dc', conditions: 'overvoltage category II, pollution degree 2 (EN 60664); rated surge voltage 4 kV', quote: 'Ratings per EN 60664: Overvoltage category II, Pollution degree 2: Nominal voltage 450 V, Rated surge voltage 4 kV, Rated current 32 A (the III/3 and III/2 columns are "-")', url: wago('413')[1] }],
    extra: {
      ul: fact('UL 486C use group C: 600 V 20 A', 'Approvals per UL 486C, Use group C: Rated voltage 600 V, Rated current 20 A', wago('413')[1]),
      positions: fact(3, 'Connection points 3; Total number of potentials 1', wago('413')[1]),
      revision: fact('Version 18.03.2024', 'Page 2/6 Version 18.03.2024', wago('413')[1]),
    },
  },
  'wago-221-415': {
    subject: 'WAGO 221-415 splicing connector with levers, 5-conductor',
    sources: wago('415'),
    verdict: 'VERIFIED',
    ratings: [{ volts: 450, amps: 32, service: 'ac/dc', conditions: 'overvoltage category II, pollution degree 2 (EN 60664); rated surge voltage 4 kV', quote: 'Ratings per EN 60664: Overvoltage category II, Pollution degree 2: Nominal voltage 450 V, Rated surge voltage 4 kV, Rated current 32 A (the III/3 and III/2 columns are "-")', url: wago('415')[1] }],
    extra: {
      ul: fact('UL 486C use group C: 600 V 20 A', 'Approvals per UL 486C, Use group C: Rated voltage 600 V, Rated current 20 A', wago('415')[1]),
      positions: fact(5, 'Connection points 5; Total number of potentials 1', wago('415')[1]),
    },
  },

  // ----- Terminal blocks -----
  'terminal-block-mstb-508-2': phoenixPart('mstb', 2),
  'terminal-block-mstb-508-3': phoenixPart('mstb', 3),
  'terminal-block-mstb-508-4': phoenixPart('mstb', 4),
  'terminal-block-mstb-508-5': phoenixPart('mstb', 5),
  'terminal-block-mstb-508-6': phoenixPart('mstb', 6),
  'terminal-block-mc-381-2': phoenixPart('mc', 2),
  'terminal-block-mc-381-3': phoenixPart('mc', 3),
  'terminal-block-mc-381-4': phoenixPart('mc', 4),
  'terminal-block-mc-381-5': phoenixPart('mc', 5),
  'terminal-block-mc-381-6': phoenixPart('mc', 6),
  'terminal-block-kf2edg-508-2': {
    subject: 'Cixi Kefa KF2EDG-STD-5.08 pluggable terminal block, 2 positions (clone of the MSTB style)',
    sources: [KEFA_KF2EDG],
    verdict: 'VERIFIED',
    ratings: [{ volts: 300, amps: 10, service: 'ac/dc', quote: 'KF2EDG-STD-5.08 Pluggable terminal block ... Rated Voltage/Current:300V/10A (vendor listing; recorded with provenance unverified)', url: KEFA_KF2EDG }],
  },
  'terminal-block-kf2edg-508-3': {
    subject: 'Cixi Kefa KF2EDG-STD-5.08 pluggable terminal block, 3 positions',
    sources: [KEFA_KF2EDG],
    verdict: 'VERIFIED',
    ratings: [{ volts: 300, amps: 10, service: 'ac/dc', quote: 'KF2EDG-STD-5.08 Pluggable terminal block ... Rated Voltage/Current:300V/10A (vendor listing; recorded with provenance unverified)', url: KEFA_KF2EDG }],
  },
  'terminal-block-kf301-500-2': {
    subject: 'Cixi Kefa KF301-5.0-2P PCB screw terminal block (LCSC C474881)',
    sources: [LCSC_KF301_2, KEFA_KF301],
    verdict: 'VERIFIED',
    ratings: [{ volts: 250, amps: 17, service: 'ac/dc', quote: 'Cixi Kefa Elec KF301-5.0-2P ... Current Rating 17A; Voltage Rating (Max) 250V; Pitch 5mm (vendor listing; recorded with provenance unverified)', url: LCSC_KF301_2 }],
  },
  'terminal-block-kf301-500-3': {
    subject: 'Cixi Kefa KF301-5.0-3P PCB screw terminal block (LCSC C474882)',
    sources: [LCSC_KF301_3, KEFA_KF301],
    verdict: 'VERIFIED',
    ratings: [{ volts: 250, amps: 17, service: 'ac/dc', quote: 'Cixi Kefa Elec KF301-5.0-3P ... Current Rating 17A; Voltage Rating (Max) 250V; Pitch 5mm (vendor listing; recorded with provenance unverified)', url: LCSC_KF301_3 }],
  },

  // ----- Relay module and SSR -----
  'relay-module-1ch-5v': {
    subject: 'Generic 1-channel 5 V relay module with Songle SRD-05VDC-SL-C (form C); Songle SRD (T73) series datasheet, version V1',
    sources: [SONGLE_DS, SONGLE_PAGE, SONGLE_OLD_DS, RELAY_MODULE_AMAZON, RELAY_MODULE_KONNECTED],
    verdict: 'NOT VERIFIED',
    blocking: 'No insulation class, for the relay or the board: the Songle sheet gives only "Dielectric strength (Leakage current 1mA): Between coil and contacts 1500VAC 1min" and "Insulation level B/F" (the coil\'s thermal insulation class, not a mains-to-coil class); the module listings give no rating or isolation at all ("The Maximum voltage that can pass through the Switched (NO/NC) side of the relays is written on them"). Disposition: generated with isolation unknown (the checker treats IN, DC- and DC+ as live whenever the contacts carry mains). This contradicts the spec circuit "relay switching a fused lamp ... (only the relay module\'s unverified-rating and cable-unverified warnings)" (Resolution 21): Michael decides whether that circuit changes its expected result.',
    ratings: [
      { volts: 125, amps: 10, service: 'ac', conditions: 'resistive load (cos φ = 1); the relay\'s rating, not the module\'s', quote: 'CONTACT RATING, FORM C, Contact Capacity Resistive Load (cosΦ=1): 7A 28VDC, 10A 125VAC, 7A 240VAC', url: SONGLE_OLD_DS },
      { volts: 240, amps: 7, service: 'ac', conditions: 'resistive load (cos φ = 1); the relay\'s rating, not the module\'s', quote: 'CONTACT RATING, FORM C, Contact Capacity Resistive Load (cosΦ=1): 7A 28VDC, 10A 125VAC, 7A 240VAC', url: SONGLE_OLD_DS },
      { volts: 28, amps: 7, service: 'dc', conditions: 'resistive load; the relay\'s rating, not the module\'s', quote: 'CONTACT RATING, FORM C, Contact Capacity Resistive Load (cosΦ=1): 7A 28VDC, 10A 125VAC, 7A 240VAC', url: SONGLE_OLD_DS },
    ],
    extra: {
      dielectric: fact('1500 VAC coil to contacts, 1 min', 'Dielectric strength (Leakage current 1mA): Between coil and contacts 1500VAC 1min; Between open contacts 1000VAC 1min', SONGLE_DS),
      insulationLevel: fact('B/F (coil thermal class)', '绝缘等级 Insulation level: B/F', SONGLE_DS),
      currentSheetRating: fact('7A/10A/15A 250VAC/28VDC; 10A 125VAC; max 277VAC/30VDC', 'Contact rating(Res. load) 7A/10A/15A 250VAC/28VDC, 10A 125VAC; Max switching voltage 277VAC/30VDC; Max switching current 15A (the current sheet does not split these by contact form; the older sheet\'s FORM C figures are kept as the ratings)', SONGLE_DS),
      inductive: fact('3A 120VAC, 3A 28VDC (form C, inductive)', 'Inductive Load (cosΦ=0.4 L/R=7msec): FORM C 3A 120VAC, 3A 28VDC', SONGLE_OLD_DS),
      moduleListing: fact('no rating on the module listing', 'The Maximum voltage that can pass through the Switched (NO/NC) side of the relays is written on them.', RELAY_MODULE_KONNECTED),
    },
  },
  'ssr-fotek-25da': {
    subject: 'Fotek SSR-25DA (standard type, zero cross), SSR series catalogue pages 05 and 28-29, PDF created 2022-06-21',
    sources: [FOTEK_MANUAL, FOTEK_PRODUCT, FOTEK_SERIES, FOTEK_PHOTO],
    verdict: 'NOT VERIFIED',
    blocking: 'No insulation class between input and output: Fotek gives "Isolation strength 4 KVrms (EN60950/VDE0805)" and "Insulation strength 100MΩ / 500VDC", test values only. Disposition: generated with isolation unknown (the checker treats terminals 3 and 4 as live when 1 and 2 carry mains), so an SSR driven from a GPIO is an error; Michael decides whether that is the intended result. Everything else (pins, control range, load rating, leakage, notes) is verified. Note: SSR-25DA is widely counterfeited; these values are for the genuine Fotek part.',
    pins: fact({ top: ['1', '2'], bottom: ['4', '3'] }, 'Fotek SSR-DA product photo: top row 1 (left) and 2 (right), each marked ~, "24 - 380VAC" between them; bottom row 4 (left, marked -) and 3 (right, marked +), "4 - 32VDC" between them. Connection diagram: 1 and 2 load side, - 4 and + 3 input.', FOTEK_PHOTO),
    ratings: [{ volts: 380, amps: 25, service: 'ac', conditions: 'rated current for a resistive load on a heatsink with thermal grease; incandescent lamps: module rating over 4 times the lamp current; Fotek heatsink HS-50 is rated 15 A max per SSR, so 25 A needs a larger heatsink', quote: 'Specification [Rated current corresponding to Resistive load]: SSR - 25DA Rated current 25A max., Output voltage 24 ~ 380VAC. Notice of use: The thermal conductive silicone rubber or thermal grease is required When the solid state module is mounted on a heat sink ... Incandescent lamp: The rated current of the module must be over 4 times of the incandescent lamp current. Heat sink standard type HS-50: Current duration 15A max.', url: FOTEK_MANUAL }],
    extra: {
      control: fact([4, 32], 'Input voltage 4 ~ 32 VDC; Turn off voltage <3.5 VDC; Trigger current 12.0mA max.', FOTEK_MANUAL),
      load: fact([24, 380], 'Output voltage 24 ~ 380VAC (standard type); Peak voltage 1200VAC min.', FOTEK_MANUAL),
      leakage: fact('5 mA max.', 'Leakage current 5 mA max.', FOTEK_MANUAL),
      isolationNote: fact('test values only, no insulation class', 'Isolation strength 4 KVrms (EN60950/VDE0805); Insulation strength 100MΩ / 500VDC (EN60950/VDE0805)', FOTEK_MANUAL),
      fuse: fact('I²t 259 A²s; fuse I²t below half of it', 'SSR - 25DA I2t for fuse 259A2S, Surge current 275A ... please use a fuse with a I2t value < 1/2 I2t value specified.', FOTEK_MANUAL),
      revision: fact('SSR series catalogue, PDF created 2022-06-21 (Adobe InDesign CS3); series page states 4~32VDC', 'SSR-25DA Input voltage:4~32VDC、Max Rated Load Voltage:24~380VAC、Max Load Current:25A', FOTEK_SERIES),
      zeroCross: fact(true, 'Control method: Zero cross', FOTEK_MANUAL),
    },
  },
}
