// Sheet colors. On the site the paper and grid come from CSS variables (styles.css); a standalone
// export (the CLI's SVG and PNG) needs them inline, light or dark.
export interface SheetTheme {
  paper: string
  grid: string
  /** Captions, frames and note text. Part outlines and cable-end art keep the Sticker ink. */
  ink: string
  /** Wire casings and the dots where a wire meets a pin: the Sticker ink on light paper, a light
   *  grey on dark paper so a black wire and its ends stay visible. */
  casing: string
  /** Fill of a note box and a frame's label tab. */
  note: string
  /** Outline behind each part caption, so it reads over a board's white body as well as on the
   *  paper (a light caption on a breadboard in the dark theme). None on the site. */
  halo?: string
  /** Outline of a dark-bodied part (a tilt switch, an ESP32), so it stays visible on dark paper
   *  (amendment A18.4). None on the site and on light paper, where the Sticker ink reads. */
  outline?: string
}

/** The Sticker ink (Part.tsx INK), repeated here so this file has no JSX dependency. */
const INK = '#23282F'

export const SITE_THEME: SheetTheme = { paper: 'var(--paper)', grid: 'var(--grid)', ink: INK, casing: INK, note: '#FFFFFF' }
export const LIGHT_THEME: SheetTheme = { paper: '#F7F8F3', grid: '#E1E6DB', ink: INK, casing: INK, note: '#FFFFFF', halo: '#F7F8F3' }
export const DARK_THEME: SheetTheme = { paper: '#1B211E', grid: '#2B342F', ink: '#E4EAE5', casing: '#C9D1D9', note: '#26302B', halo: '#1B211E', outline: '#C9D1D9' }
