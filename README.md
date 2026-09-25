# Circuitoon

Lucidchart for electronics wiring diagrams. Drag cartoon pictures of real modules onto a canvas, wire them pin to pin, and move anything while the wires follow.

Early development. Live at https://mbarc.github.io/circuitoon/; the editor is at https://mbarc.github.io/circuitoon/#/editor (place parts, draw wires, import and export JSON).

```bash
npm install
npm run dev       # local dev server
npm test          # unit tests
npm run validate  # check every file in modules/
npm run deploy    # validate, test, build, publish to GitHub Pages
```

- `docs/PRD.md` - product requirements (V1 editor and art studio, V2 simulation, V3 animation)
- `modules/` - module definitions: one JSON file per part, listing its pins and which side each sits on

## Module example

```json
{
  "format": "circuitoon-module/1",
  "id": "resistor",
  "name": "Resistor",
  "pins": [
    { "name": "1", "side": "left" },
    { "name": "2", "side": "right" }
  ]
}
```

Pins on a side appear in array order: left to right on `top` and `bottom`, top to bottom on `left` and `right`. Full format in `docs/PRD.md`.
