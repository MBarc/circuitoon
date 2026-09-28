// Sheet colors. On the site the paper and grid come from CSS variables (styles.css); a standalone
// export (the CLI's SVG and PNG) needs them inline, light or dark.
export interface SheetTheme {
  paper: string
  grid: string
  /** Captions, frames and note text. Wire casings and part outlines keep the Sticker ink. */
  ink: string
  /** Fill of a note box and a frame's label tab. */
  note: string
}

/** The Sticker ink (Part.tsx INK), repeated here so this file has no JSX dependency. */
const INK = '#23282F'

export const SITE_THEME: SheetTheme = { paper: 'var(--paper)', grid: 'var(--grid)', ink: INK, note: '#FFFFFF' }
export const LIGHT_THEME: SheetTheme = { paper: '#F7F8F3', grid: '#E1E6DB', ink: INK, note: '#FFFFFF' }
export const DARK_THEME: SheetTheme = { paper: '#1B211E', grid: '#2B342F', ink: '#E4EAE5', note: '#26302B' }
