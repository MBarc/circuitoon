// What the toolkit does not check (agent toolkit spec 5). Every verify, check and gate output ends
// with this list, and the skill tells the agent to report it to the user.
export const NOT_CHECKED: string[] = [
  'Current and heat beyond the simulated DC operating point: wire gauge against current, part temperatures, and anything that changes over time (PWM, start-up, inrush, battery discharge). The simulation solves the saved switch and GPIO state only.',
  'SPI bus conflicts; I2C addresses and pull-ups only as far as the parts declare them (not a part with no I2C data, nor a bus that continues on another sheet).',
  'Required configuration inputs left floating (for example an MCP23017 RESET): unless the intent lists them, only I2C address pins are checked.',
  'Firmware behaviour: pin modes, the internal pull-ups firmware turns on, and what drives a strapping pin at reset (only what is wired to it is checked).',
  'Timing and signal integrity.',
  'Mechanical fit: enclosures, connector sizes and cable lengths.',
  'Mains wiring beyond its connections.',
  'Each part\'s own correctness beyond its cited sources; custom parts (made in the part maker or embedded in a netlist) are user-made and unverified.',
]
