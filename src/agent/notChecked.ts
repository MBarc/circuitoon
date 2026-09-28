// What the toolkit does not check (agent toolkit spec 5). Every verify, check and gate output ends
// with this list, and the skill tells the agent to report it to the user.
export const NOT_CHECKED: string[] = [
  'Current and heat: wire gauge against current, regulator and battery limits, and part temperatures.',
  'I2C and SPI addresses and bus conflicts.',
  'Required configuration inputs left floating (for example an MCP23017 RESET or its address pins): unless the intent lists them, they are only as checked as the checker\'s no-power rules.',
  'Firmware behaviour: pin modes, pull-ups, boot strapping pins.',
  'Timing and signal integrity.',
  'Mechanical fit: enclosures, connector sizes and cable lengths.',
  'Mains wiring beyond its connections.',
  'Each part\'s own correctness beyond its cited sources; custom parts embedded in the netlist are unverified.',
]
