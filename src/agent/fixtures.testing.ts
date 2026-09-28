// Netlists the layout tests and the visual checks share. Plain data (no imports), so a script can
// load this file with Node's type stripping.

/** The spec's example (section 1): a battery lights an LED through a 220 ohm resistor on a breadboard. */
export function ledNetlist() {
  return {
    format: 'circuitoon-netlist/1',
    title: 'LED on a breadboard',
    parts: [
      { ref: 'BB1', module: 'breadboard-half' },
      { ref: 'BT1', module: 'battery-holder-2xaa' },
      { ref: 'R1', module: 'resistor', values: { resistance: { value: 220, unit: 'ohm' } }, on: 'BB1' },
      { ref: 'D1', module: 'led', on: 'BB1' },
    ],
    nets: [
      { name: 'VCC', pins: [{ ref: 'BT1', pin: '+' }, { ref: 'R1', pin: '1' }] },
      { name: 'LED_A', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['D1.K', 'BT1.-'] },
    ],
    wires: { color: { VCC: 'red', GND: 'black' }, ends: 'dupont-male' },
  }
}

/** Eight tilt switches (a repeat) on ESP32 inputs, their grounds on a rail strip. */
export function tiltSensors() {
  const inputs = ['IO13', 'IO14', 'IO25', 'IO26', 'IO27', 'IO32', 'IO33', 'IO4']
  return {
    format: 'circuitoon-netlist/1',
    title: 'Eight tilt sensors',
    parts: [
      { ref: 'U1', module: 'esp32-devkitc-v4' },
      { ref: 'BB1', module: 'power-rail-strip' },
    ],
    nets: [{ name: 'GND', pins: ['U1.GND', 'BB1.-'] }],
    repeat: {
      name: 'tilt',
      count: inputs.length,
      template: {
        parts: [{ ref: 'S', module: 'tilt-switch-sw520d' }],
        nets: [{ name: 'SIG', pins: ['S.1'] }, { name: 'GND', pins: ['S.2'] }],
        ports: ['SIG', 'GND'],
      },
      bindings: inputs.map((io) => ({ SIG: `U1.${io}` })),
      shared: { GND: 'GND' },
    },
    wires: { color: { GND: 'black' }, ends: 'dupont-female' },
  }
}
