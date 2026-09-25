import { describe, expect, it } from 'vitest'
import {
  CAPACITOR_VALUES,
  RESISTOR_VALUES,
  formatValue,
  parseValue,
  partValue,
  primaryParam,
  resistorBands,
} from './values.ts'
import type { ModuleDef } from './module.ts'

const OHM = 'Ω' // ohm sign
const MICRO = 'µ' // micro sign

describe('formatValue', () => {
  it('formats ohms with the ohm sign, adding an SI prefix past 1000', () => {
    expect(formatValue(220, 'ohm')).toBe(`220 ${OHM}`)
    expect(formatValue(4700, 'ohm')).toBe(`4.7 k${OHM}`)
    expect(formatValue(1000000, 'ohm')).toBe(`1 M${OHM}`)
  })
  it('formats farads with nano, micro and pico prefixes', () => {
    expect(formatValue(1e-7, 'F')).toBe('100 nF')
    expect(formatValue(1e-5, 'F')).toBe(`10 ${MICRO}F`)
    expect(formatValue(1e-11, 'F')).toBe('10 pF')
  })
  it('formats volts plainly', () => {
    expect(formatValue(3.7, 'V')).toBe('3.7 V')
  })
  it('keeps at most 3 significant digits with no trailing zeros', () => {
    expect(formatValue(4700, 'ohm')).toBe(`4.7 k${OHM}`)
    expect(formatValue(1000, 'ohm')).toBe(`1 k${OHM}`)
    expect(formatValue(10, 'ohm')).toBe(`10 ${OHM}`)
  })
})

describe('parseValue', () => {
  it('parses a plain number for the unit implied by context', () => {
    expect(parseValue('220', 'ohm')).toBe(220)
    expect(parseValue('3.7', 'V')).toBe(3.7)
  })
  it('parses a trailing SI prefix with no unit suffix', () => {
    expect(parseValue('4.7k', 'ohm')).toBe(4700)
    expect(parseValue('1M', 'ohm')).toBe(1000000)
    expect(parseValue('100n', 'F')).toBeCloseTo(1e-7)
    expect(parseValue('0.1u', 'F')).toBeCloseTo(1e-7)
    expect(parseValue('10µ', 'F')).toBeCloseTo(1e-5)
  })
  it('parses a prefix plus the full unit name or sign', () => {
    expect(parseValue(`4.7 k${OHM}`, 'ohm')).toBe(4700)
    expect(parseValue('4.7kohm', 'ohm')).toBe(4700)
    expect(parseValue('100nF', 'F')).toBeCloseTo(1e-7)
    expect(parseValue('10uF', 'F')).toBeCloseTo(1e-5)
    expect(parseValue('3.7V', 'V')).toBe(3.7)
  })
  it('parses the embedded-decimal form', () => {
    expect(parseValue('4k7', 'ohm')).toBe(4700)
  })
  it('rejects empty, negative, zero, non-numeric and wrong-unit input', () => {
    expect(parseValue('', 'ohm')).toBeNull()
    expect(parseValue('   ', 'ohm')).toBeNull()
    expect(parseValue('-5', 'ohm')).toBeNull()
    expect(parseValue('0', 'ohm')).toBeNull()
    expect(parseValue('abc', 'ohm')).toBeNull()
    expect(parseValue('4.7F', 'ohm')).toBeNull()
    expect(parseValue('3.7ohm', 'V')).toBeNull()
  })
})

describe('RESISTOR_VALUES', () => {
  it('is the E12 series from 10 ohm to 1 Mohm inclusive', () => {
    expect(RESISTOR_VALUES[0]).toBe(10)
    expect(RESISTOR_VALUES.at(-1)).toBe(1000000)
    expect(RESISTOR_VALUES).toContain(4700)
    expect(RESISTOR_VALUES).toContain(220)
    expect(RESISTOR_VALUES.length).toBe(61)
  })
})

describe('CAPACITOR_VALUES', () => {
  it('is the E6 series from 10 pF to 1000 uF inclusive', () => {
    expect(CAPACITOR_VALUES[0]).toBeCloseTo(10e-12)
    expect(CAPACITOR_VALUES.at(-1)).toBeCloseTo(1000e-6)
    expect(CAPACITOR_VALUES.some((v) => Math.abs(v - 1e-7) < 1e-15)).toBe(true)
  })
})

describe('resistorBands', () => {
  it('gives the standard 4-band code for values that fit two significant digits', () => {
    expect(resistorBands(4700)).toEqual(['#F4C430', '#8E5BD6', '#D8413A', '#E0B43C'])
    expect(resistorBands(220)).toEqual(['#D8413A', '#D8413A', '#8B5A2B', '#E0B43C'])
    expect(resistorBands(10)).toEqual(['#8B5A2B', '#1B1B1B', '#1B1B1B', '#E0B43C'])
    expect(resistorBands(1000000)).toEqual(['#8B5A2B', '#1B1B1B', '#2F9E6E', '#E0B43C'])
  })
  it('is null outside 1 ohm to 99 Mohm or when the value needs 3 significant digits', () => {
    expect(resistorBands(123)).toBeNull()
    expect(resistorBands(0.5)).toBeNull()
    expect(resistorBands(150000000)).toBeNull()
  })
})

describe('primaryParam', () => {
  const base = { format: 'circuitoon-module/1' as const, id: 'r', name: 'R', pins: [{ name: 'A', side: 'left' as const }] }
  it('finds the first param with an editable unit and numeric default', () => {
    const m: ModuleDef = { ...base, electrical: { params: { resistance: { unit: 'ohm', default: 1000 } } } }
    expect(primaryParam(m)).toEqual({ name: 'resistance', unit: 'ohm', default: 1000 })
  })
  it('skips params with no numeric default or an unsupported unit', () => {
    const m: ModuleDef = { ...base, electrical: { params: { color: { unit: 'enum', default: 'red' }, voltage: { unit: 'V', default: 2 } } } }
    expect(primaryParam(m)).toEqual({ name: 'voltage', unit: 'V', default: 2 })
  })
  it('is null with no electrical params at all', () => {
    expect(primaryParam({ ...base })).toBeNull()
  })
})

describe('partValue', () => {
  const m: ModuleDef = {
    format: 'circuitoon-module/1', id: 'r', name: 'R', pins: [{ name: 'A', side: 'left' }],
    electrical: { params: { resistance: { unit: 'ohm', default: 1000 } } },
  }
  it('falls back to the module default when the part has no override', () => {
    expect(partValue({}, m)).toEqual({ name: 'resistance', unit: 'ohm', value: 1000 })
  })
  it('uses the stored override when present', () => {
    expect(partValue({ values: { resistance: { value: 220, unit: 'ohm' } } }, m)).toEqual({ name: 'resistance', unit: 'ohm', value: 220 })
  })
  it('is null when the module has no primary param', () => {
    expect(partValue({}, { format: 'circuitoon-module/1', id: 'x', name: 'X', pins: [{ name: 'A', side: 'left' }] })).toBeNull()
  })
})
