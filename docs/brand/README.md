# Circuitoon brand

Everything here is generated from code by [`src/build.mjs`](src/build.mjs), except the two editor captures (see "Regenerating").

## The mark

**Chip:** a cartoon DIP chip with a face, the "toon" in Circuitoon. It is drawn in the Sticker style the parts use: flat colours, ink outlines and a hard offset shadow. Beside it, the wordmark is Fredoka 600 in yellow with an ink edge and a hard shadow, the same as `.wordmark` in `src/styles.css`. In the lockups and banners, all text is outlined as SVG paths, so it renders the same anywhere, GitHub's `<img>` included.

## Assets

| File | Size | Use |
| --- | --- | --- |
| `mark.svg`, `mark-dark.svg` | 256 x 256 | the Chip mark; the dark one has the dark-theme shadow |
| `lockup.svg`, `lockup-dark.svg` | 521 x 100 | mark and wordmark |
| `banner.svg`, `banner-dark.svg` | 1280 x 420 | README banner, with the tagline and a real sheet as a sticker |
| `hero.png`, `hero-dark.png` | 1200 x 636 | README hero: the `esp32-bme280` example, laid out and gated by the CLI |
| `editor.png`, `editor-dark.png` | 1440 x 700 | README: the editor showing a short in the Problems panel |
| `social-preview.png` | 1280 x 640 | GitHub social preview; upload it by hand in the repo's Settings, General, Social preview |
| `../../public/favicon.svg` | 64 x 64 | browser tab icon |
| `../../public/favicon.ico` | 16, 32, 48 | browser tab icon for browsers without SVG favicons |
| `../../public/apple-touch-icon.png` | 180 x 180 | iOS home screen |
| `../../public/icon-192.png`, `icon-512.png` | 192, 512 | web app manifest icons |
| `../../public/icon-maskable-512.png` | 512 x 512 | maskable manifest icon; the mark sits inside the 80% safe zone |
| `../../public/og-card.png` | 1200 x 630 | Open Graph and Twitter card for links to the site |
| `../../public/site.webmanifest` | | the web app manifest |

Sources in `src/`: `motif.circuitoon.json` is the banner and card sheet (9 V battery, push button, 220 ohm resistor, LED), and `editor-short.circuitoon.json` is the same sheet with a short, for the editor captures.

## Colours

Dark mode is **Graphite**: neutral greys with no tint, so the yellow is the only colour in the chrome, and the drawing paper dimmed rather than dark, so every part keeps its light-mode colours without the glare.

| Token | Light | Dark (Graphite) |
| --- | --- | --- |
| yellow (wordmark, chip) | `#F4B400` | `#F4B400` |
| ink (outlines) | `#23282F` | `#23282F` |
| green (boards) | `#2F9E6E` | `#2F9E6E` |
| background | `#E9EEE6` | `#1B1D20` |
| panel | `#FBFCF9` | `#25282C` |
| text | `#23282F` | `#E8EAED` (14:1 on the background) |
| muted text | `#56615B` | `#A3A9B0` (7.1:1) |
| rules | `#CCD5CC` | `#363A40` |
| card edge | `#23282F` | `#747B84` (3.9:1) |
| hard shadow | `#23282F` | `#0C0D0F` |
| paper (sheets) | `#F7F8F3` | `#DDDFE0` |
| sheet grid | `#E1E6DB` | `#CDD0D2` |

The app's full token set is at the top of `src/styles.css`. The CLI's own `render --dark` still uses its separate dark sheet theme (`DARK_THEME` in `src/render/theme.ts`); the README's dark hero is drawn on the Graphite paper instead.

## Fonts

Both fonts are under the SIL Open Font License 1.1, which allows embedding them as outlines and redistributing them alongside this project. The font files and their licence texts are in `src/fonts/`.

- **Fredoka** (600 for the wordmark, 500 for the tagline), by The Fredoka Project Authors. `src/fonts/OFL-Fredoka.txt`. The files are the Latin subsets from `@fontsource/fredoka`.
- **Atkinson Hyperlegible** (400 and 700, for sheet labels and card text), by the Braille Institute of America. `src/fonts/OFL-AtkinsonHyperlegible.txt`. The files are from the google/fonts repository.

## Regenerating

The tagline and how it breaks across lines are in `TAGLINE` at the top of `src/build.mjs`; `index.html` and `src/Landing.tsx` carry the same text.

```bash
cd docs/brand/src
npm install
npm run build              # every asset above except the editor captures
```

The build uses the repo's own CLI for the banner sheet and the hero, and it fails if the hero does not pass `circuitoon gate` cleanly. PNGs are drawn by the locally installed Chrome through playwright-core.

The editor captures need the dev server running:

```bash
npx vite --port 5291 --strictPort     # from the repo root, in another terminal
cd docs/brand/src && node capture-editor.mjs
```
