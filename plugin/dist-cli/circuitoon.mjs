import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
//#region src/cli/args.ts
var VALUE_FLAGS = /* @__PURE__ */ new Set([
	"--out",
	"--svg",
	"--scale",
	"--focus",
	"--search",
	"--keep"
]);
var BOOL_FLAGS = /* @__PURE__ */ new Set([
	"--json",
	"--dark",
	"--help"
]);
var ALIASES = {
	"-o": "--out",
	"-h": "--help"
};
function parseArgs(argv) {
	const positionals = [];
	const flags = /* @__PURE__ */ new Map();
	for (let i = 0; i < argv.length; i++) {
		const raw = argv[i];
		const name = Object.hasOwn(ALIASES, raw) ? ALIASES[raw] : raw;
		if (!name.startsWith("-")) {
			positionals.push(raw);
			continue;
		}
		if (BOOL_FLAGS.has(name)) {
			flags.set(name, true);
			continue;
		}
		if (!VALUE_FLAGS.has(name)) return {
			ok: false,
			error: `unknown option ${raw}`
		};
		const v = argv[i + 1];
		if (v === void 0 || v.startsWith("--")) return {
			ok: false,
			error: `${raw} needs a value`
		};
		flags.set(name, v);
		i++;
	}
	const [command, ...rest] = positionals;
	return {
		ok: true,
		value: {
			command,
			positionals: rest,
			flags
		}
	};
}
//#endregion
//#region src/format/module.ts
var MODULE_FORMAT = "circuitoon-module/1";
var SIDES = [
	"top",
	"right",
	"bottom",
	"left"
];
var PIN_TYPES = [
	"power_in",
	"power_out",
	"ground",
	"input",
	"output",
	"io",
	"passive",
	"nc"
];
var isSpacer = (p) => "spacer" in p && p.spacer === true;
/** A board accepts mounted parts: it has hole groups and is not a routing obstacle (breadboards, rail strips). */
var isBoard = (m) => !!m && !!m.holes?.length && m.obstacle === false;
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isNum = (v) => typeof v === "number" && Number.isFinite(v);
var isPos = (v) => isNum(v) && v > 0;
/** True when `v` is a finite number that is 0 or has a magnitude from VALUE_MIN to VALUE_MAX. */
var representableValue = (v) => isNum(v) && (v === 0 || Math.abs(v) >= 1e-15 && Math.abs(v) <= 0xe8d4a51000);
/**
* The editable value params: each has one unit and a valid range, shared by module defaults, the
* per-part overrides a diagram stores and the value field (parseValue). Every value must be
* representable (see VALUE_MIN); on top of that a 0 ohm resistor is a real part (a jumper), a
* capacitance must be above 0 and a voltage may be negative.
*/
var PARAM_RULES = {
	resistance: {
		unit: "ohm",
		valid: (v) => v >= 0,
		range: "0, or from 1e-15 to 1e12"
	},
	capacitance: {
		unit: "F",
		valid: (v) => v > 0,
		range: "from 1e-15 to 1e12"
	},
	voltage: {
		unit: "V",
		valid: () => true,
		range: "0, or a magnitude from 1e-15 to 1e12"
	}
};
/** True when `v` is a valid value for the named param: representable and allowed by PARAM_RULES. */
function validParamValue(name, v) {
	return Object.hasOwn(PARAM_RULES, name) && representableValue(v) && PARAM_RULES[name].valid(v);
}
/** Checks a parsed JSON value against the module format. Errors name the exact path. */
function validateModule(raw) {
	const errors = [];
	if (!isObj(raw)) return {
		ok: false,
		errors: ["module must be a JSON object"]
	};
	if (raw.format === void 0) errors.push("format: missing (expected \"circuitoon-module/1\")");
	else if (raw.format !== "circuitoon-module/1") errors.push(`format: unsupported "${String(raw.format)}" (expected "${MODULE_FORMAT}")`);
	if (typeof raw.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(raw.id)) errors.push("id: required, lowercase kebab-case (for example \"mcp23017-breakout\")");
	if (typeof raw.name !== "string" || raw.name.trim() === "") errors.push("name: required");
	if (raw.version !== void 0 && !(Number.isInteger(raw.version) && raw.version >= 1)) errors.push("version: must be a whole number, 1 or more");
	if (raw.category !== void 0 && typeof raw.category !== "string") errors.push("category: must be a string");
	if (raw.source !== void 0 && typeof raw.source !== "string") errors.push("source: must be a string (one or more URLs)");
	const checkType = (t, at) => {
		if (t.type !== void 0 && !PIN_TYPES.includes(t.type)) errors.push(`${at}.type: must be one of ${PIN_TYPES.join(", ")}`);
	};
	const checkSupply = (t, at) => {
		if (t.supply !== void 0 && typeof t.supply !== "string") errors.push(`${at}.supply: must be a string`);
		else if (typeof t.supply === "string" && !/^[^/\s]+(\/[^/\s]+)*$/.test(t.supply)) errors.push(`${at}.supply: must be one or more rail names separated by "/", for example "3V3/5V"`);
	};
	const names = /* @__PURE__ */ new Set();
	const hasHoles = Array.isArray(raw.holes) && raw.holes.length > 0;
	if (!Array.isArray(raw.pins) || raw.pins.length === 0 && !hasHoles) errors.push("pins: required, at least one pin");
	else raw.pins.forEach((p, i) => {
		const at = `pins[${i}]`;
		if (!isObj(p)) return void errors.push(`${at}: must be an object`);
		if (!SIDES.includes(p.side)) errors.push(`${at}.side: must be top, bottom, left or right`);
		if (p.spacer !== void 0) {
			if (p.spacer !== true) errors.push(`${at}.spacer: must be true`);
			if (p.name !== void 0) errors.push(`${at}: a spacer takes no name`);
			return;
		}
		if (typeof p.name !== "string" || p.name === "") return void errors.push(`${at}.name: required`);
		if (names.has(p.name)) errors.push(`${at}.name: duplicate pin name "${p.name}"`);
		names.add(p.name);
		checkType(p, at);
		if (p.bus !== void 0 && !(isObj(p.bus) && Number.isInteger(p.bus.length) && p.bus.length >= 2)) errors.push(`${at}.bus: must be { "length": <whole number, 2 or more> }`);
		if (p.label !== void 0 && typeof p.label !== "string") errors.push(`${at}.label: must be a string`);
		checkSupply(p, at);
		if (p.capacity !== void 0 && !(Number.isInteger(p.capacity) && p.capacity >= 1 && p.capacity <= 8)) errors.push(`${at}.capacity: must be a whole number from 1 to 8`);
	});
	const positions = /* @__PURE__ */ new Set();
	if (raw.holes !== void 0) {
		if (!Array.isArray(raw.holes)) errors.push("holes: must be a list of hole groups");
		else raw.holes.forEach((g, i) => {
			const at = `holes[${i}]`;
			if (!isObj(g)) return void errors.push(`${at}: must be an object`);
			if (typeof g.name !== "string" || g.name === "") errors.push(`${at}.name: required`);
			else if (names.has(g.name)) errors.push(`${at}.name: duplicate name "${g.name}" (pins and hole groups share one namespace)`);
			else names.add(g.name);
			if (g.label !== void 0 && typeof g.label !== "string") errors.push(`${at}.label: must be a string`);
			if (g.rail !== void 0 && g.rail !== "+" && g.rail !== "-") errors.push(`${at}.rail: must be "+" or "-"`);
			if (g.holeStyle !== void 0 && g.holeStyle !== "pad") errors.push(`${at}.holeStyle: must be "pad"`);
			checkType(g, at);
			checkSupply(g, at);
			if (g.capacity !== void 0) {
				if (g.holeStyle !== "pad") errors.push(`${at}.capacity: only pins and header pads (holeStyle "pad") take a capacity`);
				else if (!(Number.isInteger(g.capacity) && g.capacity >= 1 && g.capacity <= 8)) errors.push(`${at}.capacity: must be a whole number from 1 to 8`);
			}
			if (!Array.isArray(g.at) || g.at.length === 0) return void errors.push(`${at}.at: required, at least one [x, y] position`);
			g.at.forEach((p, j) => {
				if (!(Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) return void errors.push(`${at}.at[${j}]: must be [x, y]`);
				if (p[0] % 10 !== 0 || p[1] % 10 !== 0) errors.push(`${at}.at[${j}]: must sit on the 10 px grid`);
				const key = `${p[0]},${p[1]}`;
				if (positions.has(key)) errors.push(`${at}.at[${j}]: another hole already sits at ${p[0]}, ${p[1]}`);
				positions.add(key);
			});
		});
	}
	if (raw.obstacle !== void 0 && typeof raw.obstacle !== "boolean") errors.push("obstacle: must be true or false");
	if (raw.internal !== void 0) {
		if (!Array.isArray(raw.internal)) errors.push("internal: must be a list of pin-name groups");
		else raw.internal.forEach((group, i) => {
			if (!Array.isArray(group) || group.length < 2) return void errors.push(`internal[${i}]: needs 2 or more pin names`);
			group.forEach((n, j) => {
				if (!names.has(n)) errors.push(`internal[${i}][${j}]: no pin named "${String(n)}"`);
			});
		});
	}
	if (raw.size !== void 0 && !(isObj(raw.size) && isPos(raw.size.w) && isPos(raw.size.h))) errors.push("size: must be { \"w\": <units>, \"h\": <units> } with positive numbers");
	if (raw.art !== void 0) {
		const art = raw.art;
		if (!isObj(art) || !isPos(art.w) || !isPos(art.h) || !Array.isArray(art.shapes)) errors.push("art: must be { \"w\", \"h\", \"shapes\": [...] } with positive w and h");
		else {
			if (art.pinLabels !== void 0 && art.pinLabels !== "inside") errors.push("art.pinLabels: must be \"inside\"");
			art.shapes.forEach((s, i) => {
				const at = `art.shapes[${i}]`;
				if (!isObj(s) || s.type !== "rect") return void errors.push(`${at}: only "rect" shapes are supported`);
				for (const k of [
					"x",
					"y",
					"w",
					"h"
				]) if (!isNum(s[k])) errors.push(`${at}.${k}: must be a number`);
				if (typeof s.fill !== "string") errors.push(`${at}.fill: required color`);
				if (s.radius !== void 0 && !isNum(s.radius)) errors.push(`${at}.radius: must be a number`);
				if (s.outline !== void 0 && typeof s.outline !== "boolean") errors.push(`${at}.outline: must be true or false`);
				if (s.label !== void 0 && typeof s.label !== "string") errors.push(`${at}.label: must be a string`);
				if (s.labelColor !== void 0 && typeof s.labelColor !== "string") errors.push(`${at}.labelColor: must be a string`);
				if (s.labelSize !== void 0 && !isPos(s.labelSize)) errors.push(`${at}.labelSize: must be a positive number`);
				if (s.band !== void 0 && !(Number.isInteger(s.band) && s.band >= 1 && s.band <= 4)) errors.push(`${at}.band: must be a whole number from 1 to 4`);
			});
		}
	}
	if (!errors.length && Array.isArray(raw.holes)) {
		const lay = computeLayout(raw);
		raw.holes.forEach((g, i) => g.at.forEach(([x, y], j) => {
			if (x < 0 || y < 0 || x > lay.w || y > lay.h) errors.push(`holes[${i}].at[${j}]: outside the body (0 to ${lay.w}, 0 to ${lay.h})`);
		}));
	}
	if (isObj(raw.electrical) && raw.electrical.params !== void 0) {
		const params = raw.electrical.params;
		if (!isObj(params)) errors.push("electrical.params: must be an object");
		else for (const [name, rule] of Object.entries(PARAM_RULES)) {
			if (!Object.hasOwn(params, name)) continue;
			const p = params[name];
			const at = `electrical.params.${name}`;
			if (!isObj(p)) {
				errors.push(`${at}: must be { "unit": "${rule.unit}", "default": <number> }`);
				continue;
			}
			if (p.unit !== rule.unit) errors.push(`${at}.unit: must be "${rule.unit}"`);
			if (!validParamValue(name, p.default)) errors.push(`${at}.default: must be ${rule.range}`);
		}
	}
	if (isObj(raw.electrical) && raw.electrical.external !== void 0) {
		const ext = raw.electrical.external;
		if (!Array.isArray(ext)) errors.push("electrical.external: must be a list of { \"pin\", \"volts\", \"via\" }");
		else ext.forEach((e, i) => {
			const at = `electrical.external[${i}]`;
			if (!isObj(e)) return void errors.push(`${at}: must be { "pin", "volts", "via" }`);
			if (typeof e.pin !== "string" || !names.has(e.pin)) errors.push(`${at}.pin: no pin named "${String(e.pin)}"`);
			if (!isPos(e.volts)) errors.push(`${at}.volts: must be a number above 0`);
			if (typeof e.via !== "string" || e.via.trim() === "") errors.push(`${at}.via: required, what powers the pin (for example "USB")`);
			if (e.diode !== void 0 && typeof e.diode !== "boolean") errors.push(`${at}.diode: must be true or false`);
			if (e.max !== void 0 && !(isNum(e.max) && isPos(e.volts) && e.max >= e.volts)) errors.push(`${at}.max: must be a number, at least volts`);
		});
	}
	if (isObj(raw.electrical) && raw.electrical.commonReturn !== void 0) {
		const groups = raw.electrical.commonReturn;
		const grounds = new Set([...Array.isArray(raw.pins) ? raw.pins : [], ...Array.isArray(raw.holes) ? raw.holes : []].filter((p) => isObj(p) && p.type === "ground" && typeof p.name === "string").map((p) => p.name));
		if (!Array.isArray(groups)) errors.push("electrical.commonReturn: must be a list of ground pin name groups");
		else groups.forEach((g, i) => {
			if (!Array.isArray(g) || g.length < 2) return void errors.push(`electrical.commonReturn[${i}]: needs 2 or more ground pin names`);
			g.forEach((n, j) => {
				if (typeof n !== "string" || !grounds.has(n)) errors.push(`electrical.commonReturn[${i}][${j}]: no ground pin named "${String(n)}"`);
			});
		});
	}
	if (isObj(raw.electrical) && raw.electrical.returns !== void 0) {
		const returns = raw.electrical.returns;
		const items = [...Array.isArray(raw.pins) ? raw.pins : [], ...Array.isArray(raw.holes) ? raw.holes : []].filter((p) => isObj(p) && typeof p.name === "string");
		const ext = Array.isArray(raw.electrical.external) ? raw.electrical.external.filter(isObj).map((e) => e.pin) : [];
		const outs = new Set(items.filter((p) => p.type === "power_out" || ext.includes(p.name)).map((p) => p.name));
		const grounds = new Set(items.filter((p) => p.type === "ground").map((p) => p.name));
		if (!isObj(returns)) errors.push("electrical.returns: must be an object of output pin name to ground pin name");
		else for (const [out, g] of Object.entries(returns)) {
			if (!outs.has(out)) errors.push(`electrical.returns.${out}: no power_out or external pin named "${out}"`);
			if (typeof g !== "string" || !grounds.has(g)) errors.push(`electrical.returns.${out}: no ground pin named "${String(g)}"`);
		}
	}
	if (isObj(raw.electrical)) {
		const el = raw.electrical;
		const hasVoltage = isObj(el.params) && el.params.voltage !== void 0;
		const outs = [...Array.isArray(raw.pins) ? raw.pins : [], ...Array.isArray(raw.holes) ? raw.holes : []].filter((p) => isObj(p) && p.type === "power_out" && typeof p.name === "string").map((p) => p.name);
		if (el.voltageOutputs !== void 0) {
			if (!hasVoltage) errors.push("electrical.voltageOutputs: only for a module with a voltage param");
			if (!Array.isArray(el.voltageOutputs) || el.voltageOutputs.length === 0) errors.push("electrical.voltageOutputs: must be a list of power_out pin names");
			else el.voltageOutputs.forEach((n, i) => {
				if (typeof n !== "string" || !outs.includes(n)) errors.push(`electrical.voltageOutputs[${i}]: no power_out pin named "${String(n)}"`);
			});
		} else if (hasVoltage && outs.length > 1) errors.push(`electrical.voltageOutputs: required, the module has a voltage value and ${outs.length} power_out pins; name the ones the value sets`);
	}
	return errors.length ? {
		ok: false,
		errors
	} : {
		ok: true,
		module: raw
	};
}
var slotsOn = (m, side) => m.pins.filter((p) => p.side === side).reduce((n, p) => n + (!isSpacer(p) && p.bus ? p.bus.length : 1), 0);
/**
* Body size and pin positions, per the PRD geometry rules: body is the largest of `size`,
* `art`, and what the pins need plus one unit of corner margin; pins sit on grid points,
* centered along their side, in array order (left to right, top to bottom).
*/
function computeLayout(m) {
	const wu = Math.max(m.size?.w ?? 0, Math.ceil((m.art?.w ?? 0) / 10), Math.max(slotsOn(m, "top"), slotsOn(m, "bottom")) + 2, 4);
	const hu = Math.max(m.size?.h ?? 0, Math.ceil((m.art?.h ?? 0) / 10), Math.max(slotsOn(m, "left"), slotsOn(m, "right")) + 2, 3);
	const pins = [];
	for (const side of SIDES) {
		const entries = m.pins.filter((p) => p.side === side);
		const n = slotsOn(m, side);
		if (!n) continue;
		let slot = Math.ceil(((side === "top" || side === "bottom" ? wu : hu) - (n - 1)) / 2);
		for (const p of entries) {
			const span = !isSpacer(p) && p.bus ? p.bus.length : 1;
			if (!isSpacer(p)) {
				const along = (slot + (span - 1) / 2) * 10;
				const dir = {
					top: {
						x: 0,
						y: -1
					},
					bottom: {
						x: 0,
						y: 1
					},
					left: {
						x: -1,
						y: 0
					},
					right: {
						x: 1,
						y: 0
					}
				}[side];
				const edge = side === "top" ? {
					x: along,
					y: 0
				} : side === "bottom" ? {
					x: along,
					y: hu * 10
				} : side === "left" ? {
					x: 0,
					y: along
				} : {
					x: wu * 10,
					y: along
				};
				pins.push({
					name: p.name,
					label: p.label,
					side,
					type: p.type ?? "io",
					edge,
					end: {
						x: edge.x + dir.x * 8,
						y: edge.y + dir.y * 8
					},
					dir,
					bus: p.bus
				});
			}
			slot += span;
		}
	}
	return {
		w: wu * 10,
		h: hu * 10,
		pins
	};
}
var layoutCache = /* @__PURE__ */ new WeakMap();
function layoutModule(m) {
	let lay = layoutCache.get(m);
	if (!lay) layoutCache.set(m, lay = computeLayout(m));
	return lay;
}
/**
* How many wire ends a pin or header pad takes: its `capacity`, default 1. A breadboard hole always
* takes one (a hole holds one leg or one wire end), whatever its group says.
*/
function terminalCapacity(m, name) {
	const pin = m.pins.find((p) => !isSpacer(p) && p.name === name);
	if (pin) return pin.capacity ?? 1;
	const g = m.holes?.find((h) => h.name === name);
	return g?.holeStyle === "pad" ? g.capacity ?? 1 : 1;
}
//#endregion
//#region src/format/geometry.ts
var z = (n) => n + 0;
/** Rotation center: the grid point at or up-left of the body center, so pins stay on grid. */
function pivot(w, h) {
	return {
		x: Math.floor(w / 2 / 10) * 10,
		y: Math.floor(h / 2 / 10) * 10
	};
}
/** Rotates a vector clockwise on screen (y points down). */
function rotateVec(v, rot) {
	switch (rot) {
		case 90: return {
			x: z(-v.y),
			y: z(v.x)
		};
		case 180: return {
			x: z(-v.x),
			y: z(-v.y)
		};
		case 270: return {
			x: z(v.y),
			y: z(-v.x)
		};
		default: return {
			x: z(v.x),
			y: z(v.y)
		};
	}
}
function toWorld(part, lay, local) {
	const c = pivot(lay.w, lay.h);
	const r = rotateVec({
		x: local.x - c.x,
		y: local.y - c.y
	}, part.rotation ?? 0);
	return {
		x: part.x + c.x + r.x,
		y: part.y + c.y + r.y
	};
}
function bodyRect(part, lay) {
	const a = toWorld(part, lay, {
		x: 0,
		y: 0
	});
	const b = toWorld(part, lay, {
		x: lay.w,
		y: lay.h
	});
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(b.x - a.x),
		h: Math.abs(b.y - a.y)
	};
}
function worldPins(part, m) {
	const lay = layoutModule(m);
	const rot = part.rotation ?? 0;
	return lay.pins.map((p) => ({
		name: p.name,
		label: p.label,
		type: p.type,
		edge: toWorld(part, lay, p.edge),
		end: toWorld(part, lay, p.end),
		dir: rotateVec(p.dir, rot),
		bus: p.bus
	}));
}
/** Every hole group of a placed module, with its hole centers in world px. Empty for a module without holes. */
function worldHoles(part, m) {
	if (!m.holes?.length) return [];
	const lay = layoutModule(m);
	return m.holes.map((g) => ({
		name: g.name,
		label: g.label,
		rail: g.rail,
		style: g.holeStyle ?? "hole",
		at: g.at.map(([x, y]) => toWorld(part, lay, {
			x,
			y
		}))
	}));
}
/**
* Where each pin plugs into a board: its edge point on the body, always a grid point, so a leg
* lands exactly on a hole. A bus pin has no plug point.
*/
function plugPoints(part, m) {
	return worldPins(part, m).filter((p) => !p.bus).map((p) => ({
		pin: p.name,
		at: p.edge
	}));
}
/** Removes repeated points and the middle point of any three collinear axis-aligned points. */
function simplify(pts) {
	const out = [];
	for (const p of pts) {
		const q = out[out.length - 1];
		if (q && q.x === p.x && q.y === p.y) continue;
		const r = out[out.length - 2];
		if (q && r && (r.x === q.x && q.x === p.x || r.y === q.y && q.y === p.y)) out.pop();
		out.push(p);
	}
	return out;
}
var H_BIT = 1;
var V_BIT = 2;
/**
* Nodes farther than this many grid cells from the origin on either axis (about 335 million px at
* the 10 px grid) are not recorded. Keeps `packCell` inside the safe-integer range.
*/
var CELL_LIMIT = 2 ** 25;
/** Packs grid cell (cx, cy), each within +-CELL_LIMIT, into one integer below 2^52. */
var packCell = (cx, cy) => (cx + CELL_LIMIT) * 2 ** 26 + (cy + CELL_LIMIT);
/** Largest dense occupancy grid, in cells (bytes); a wire drawn beyond it goes to the sparse map. */
var DENSE_MAX = 1 << 22;
/**
* Runs longer than this many cells are kept as one interval instead of being marked cell by cell,
* so adding a wire costs at most this much per segment however long the segment is.
*/
var LONG_RUN = 4096;
/**
* Grid nodes used by earlier wires, bit 1 = a horizontal run passes through, bit 2 = a vertical run
* does. Only nodes on the routing grid (multiples of `grid`) are kept, since those are the only ones
* the search ever visits. Stored as one byte per cell in a dense grid that grows to cover the wires
* added so far (a sheet of routed wires stays compact), so a search copies its window out row by
* row instead of looking up nodes one at a time. Nodes that would grow the dense grid past
* DENSE_MAX cells (a hand-drawn wire far off the sheet) are kept in a sparse map instead.
*/
var Occupancy = class {
	grid;
	/** Dense grid origin and size, in grid cells. */
	cx0 = 0;
	cy0 = 0;
	cols = 0;
	rows = 0;
	cells = /* @__PURE__ */ new Uint8Array(0);
	/** Nodes outside the dense grid, keyed by `packCell`. */
	far = /* @__PURE__ */ new Map();
	/** Runs longer than LONG_RUN cells, kept whole rather than marked cell by cell. */
	runs = [];
	/** Number of occupied nodes, counting each long run as one; zero only when nothing is occupied. */
	size = 0;
	constructor(grid = 10) {
		this.grid = grid;
	}
	/** Bits at world point (x, y); 0 for a point off the grid or never used. */
	at(x, y) {
		const g = this.grid;
		if (x % g !== 0 || y % g !== 0) return 0;
		const cx = x / g - this.cx0;
		const cy = y / g - this.cy0;
		let bits = 0;
		if (cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows) bits = this.cells[cy * this.cols + cx];
		else if (this.far.size) bits = this.far.get(packCell(x / g, y / g)) ?? 0;
		for (const r of this.runs) {
			const [at, along] = r.bit === H_BIT ? [y / g, x / g] : [x / g, y / g];
			if (at === r.at && along >= r.lo && along <= r.hi) bits |= r.bit;
		}
		return bits;
	}
	/** Records a run longer than LONG_RUN cells as one interval. */
	addRun(bit, at, lo, hi) {
		this.runs.push({
			bit,
			at,
			lo,
			hi
		});
		this.size++;
	}
	/** Grows the dense grid to cover cells cxLo..cxHi x cyLo..cyHi if that stays within DENSE_MAX; false if it cannot. */
	reserve(cxLo, cyLo, cxHi, cyHi) {
		if (this.cols && cxLo >= this.cx0 && cyLo >= this.cy0 && cxHi < this.cx0 + this.cols && cyHi < this.cy0 + this.rows) return true;
		const padX = Math.max(32, this.cols >> 1);
		const padY = Math.max(32, this.rows >> 1);
		const lx = Math.min(cxLo, this.cols ? this.cx0 : cxLo) - padX;
		const ly = Math.min(cyLo, this.rows ? this.cy0 : cyLo) - padY;
		const hx = Math.max(cxHi, this.cols ? this.cx0 + this.cols - 1 : cxHi) + padX;
		const hy = Math.max(cyHi, this.rows ? this.cy0 + this.rows - 1 : cyHi) + padY;
		const cols = hx - lx + 1;
		const rows = hy - ly + 1;
		if (cols * rows > DENSE_MAX) return false;
		const cells = new Uint8Array(cols * rows);
		for (let r = 0; r < this.rows; r++) {
			const from = r * this.cols;
			cells.set(this.cells.subarray(from, from + this.cols), (r + this.cy0 - ly) * cols + (this.cx0 - lx));
		}
		this.cx0 = lx;
		this.cy0 = ly;
		this.cols = cols;
		this.rows = rows;
		this.cells = cells;
		return true;
	}
	/** Marks grid cell (cx, cy) with `bit`. */
	mark(cx, cy, bit) {
		const dx = cx - this.cx0;
		const dy = cy - this.cy0;
		if (dx >= 0 && dy >= 0 && dx < this.cols && dy < this.rows) {
			const i = dy * this.cols + dx;
			if (!this.cells[i]) this.size++;
			this.cells[i] |= bit;
			return;
		}
		if (Math.abs(cx) >= CELL_LIMIT || Math.abs(cy) >= CELL_LIMIT) return;
		const k = packCell(cx, cy);
		const old = this.far.get(k) ?? 0;
		if (!old) this.size++;
		this.far.set(k, old | bit);
	}
	/**
	* Copies the bits for the search window whose top-left node is (x0, y0) and which spans
	* cols x rows nodes `g` px apart into `out` (row-major, cols wide).
	*/
	copyWindow(x0, y0, cols, rows, g, out) {
		if (g !== this.grid) {
			for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out[r * cols + c] = this.at(x0 + c * g, y0 + r * g);
			return;
		}
		const wx = x0 / g - this.cx0;
		const wy = y0 / g - this.cy0;
		const c0 = Math.max(0, -wx);
		const c1 = Math.min(cols, this.cols - wx);
		const r0 = Math.max(0, -wy);
		const r1 = Math.min(rows, this.rows - wy);
		if (c0 < c1) for (let r = r0; r < r1; r++) {
			const from = (r + wy) * this.cols + wx;
			out.set(this.cells.subarray(from + c0, from + c1), r * cols + c0);
		}
		const cxLo = x0 / g;
		const cyLo = y0 / g;
		for (const [k, bits] of this.far) {
			const cy = k % 2 ** 26 - CELL_LIMIT;
			const c = Math.floor(k / 2 ** 26) - CELL_LIMIT - cxLo;
			const r = cy - cyLo;
			if (c >= 0 && r >= 0 && c < cols && r < rows) out[r * cols + c] |= bits;
		}
		this.copyRuns(cxLo, cyLo, cols, rows, out);
	}
	/** ORs the long runs into a window whose top-left node is grid cell (cxLo, cyLo); each run costs at most one window row or column. */
	copyRuns(cxLo, cyLo, cols, rows, out) {
		for (const run of this.runs) if (run.bit === H_BIT) {
			const r = run.at - cyLo;
			if (r < 0 || r >= rows) continue;
			const c0 = Math.max(0, run.lo - cxLo);
			const c1 = Math.min(cols - 1, run.hi - cxLo);
			for (let c = c0; c <= c1; c++) out[r * cols + c] |= H_BIT;
		} else {
			const c = run.at - cxLo;
			if (c < 0 || c >= cols) continue;
			const r0 = Math.max(0, run.lo - cyLo);
			const r1 = Math.min(rows - 1, run.hi - cyLo);
			for (let r = r0; r <= r1; r++) out[r * cols + c] |= V_BIT;
		}
	}
};
/**
* Adds one polyline's axis-aligned segments to `occ`. The work per segment is bounded (at most
* LONG_RUN cells are marked; a longer run is kept as one interval), and coordinates are clamped to
* the recordable range first, so a wire of any length or position (even a malformed one far off the
* sheet, or at a size where stepping one cell no longer changes a float) finishes quickly.
*/
function addToOccupancy(occ, polyline) {
	const g = occ.grid;
	const clampCell = (v) => Math.min(CELL_LIMIT - 1, Math.max(1 - CELL_LIMIT, v));
	const add = (bit, at, a, b) => {
		if (at % g !== 0 || !Number.isFinite(a) || !Number.isFinite(b)) return;
		const line = at / g;
		if (Math.abs(line) >= CELL_LIMIT) return;
		const lo = clampCell(Math.ceil(Math.min(a, b) / g));
		const hi = clampCell(Math.floor(Math.max(a, b) / g));
		if (lo > hi) return;
		if (hi - lo > LONG_RUN) return occ.addRun(bit, line, lo, hi);
		if (bit === H_BIT) occ.reserve(lo, line, hi, line);
		else occ.reserve(line, lo, line, hi);
		for (let c = lo; c <= hi; c++) if (bit === H_BIT) occ.mark(c, line, H_BIT);
		else occ.mark(line, c, V_BIT);
	};
	for (let i = 1; i < polyline.length; i++) {
		const a = polyline[i - 1];
		const b = polyline[i];
		if (a.y === b.y) add(H_BIT, a.y, a.x, b.x);
		else if (a.x === b.x) add(V_BIT, a.x, a.y, b.y);
	}
}
/** Largest search window, in grid cells, before a margin is skipped (keeps memory and time bounded). */
var MAX_CELLS = 25e4;
/** Search windows around the endpoints, in px, tried in order (the default `margins`). */
var MARGINS = [60, 240];
/** About how far apart, in px, a wire's ends may be for the router to search between them. */
var ROUTE_REACH = Math.floor(Math.sqrt(MAX_CELLS)) * 10;
/** Whether the smallest search window between `a` and `b` fits the router's grid, so a route can exist at all. */
function withinReach(a, b, g = 10) {
	const m = MARGINS[0];
	return (Math.ceil((Math.max(a.x, b.x) + m) / g) - Math.floor((Math.min(a.x, b.x) - m) / g) + 1) * (Math.ceil((Math.max(a.y, b.y) + m) / g) - Math.floor((Math.min(a.y, b.y) - m) / g) + 1) <= MAX_CELLS;
}
var DIRS = [
	{
		x: 1,
		y: 0
	},
	{
		x: 0,
		y: 1
	},
	{
		x: -1,
		y: 0
	},
	{
		x: 0,
		y: -1
	}
];
var dirIndex = (d) => DIRS.findIndex((v) => v.x === d.x && v.y === d.y);
/** First grid point reached by stepping out of `p` along `d`. */
function leave(p, d, g) {
	const snap = (v, s) => s > 0 ? Math.ceil((v + 1) / g) * g : s < 0 ? Math.floor((v - 1) / g) * g : Math.round(v / g) * g;
	return {
		x: snap(p.x, d.x),
		y: snap(p.y, d.y)
	};
}
/** Nearest grid point to `p` (a hole center is already on the grid); where a free end's search starts. */
var onGrid = (p, g) => ({
	x: Math.round(p.x / g) * g,
	y: Math.round(p.y / g) * g
});
/**
* Binary min-heap of (state, priority) pairs in typed arrays that grow as needed. One instance is
* reused by every search (routing is synchronous), so a sheet's worth of searches does not
* reallocate it.
*/
var MinHeap = class {
	pri = /* @__PURE__ */ new Float64Array(1024);
	val = /* @__PURE__ */ new Int32Array(1024);
	size = 0;
	clear() {
		this.size = 0;
	}
	push(v, p) {
		if (this.size === this.val.length) {
			const pri = new Float64Array(this.size * 2);
			const val = new Int32Array(this.size * 2);
			pri.set(this.pri);
			val.set(this.val);
			this.pri = pri;
			this.val = val;
		}
		const pr = this.pri;
		const vl = this.val;
		let i = this.size++;
		while (i > 0) {
			const parent = i - 1 >> 1;
			if (pr[parent] <= p) break;
			vl[i] = vl[parent];
			pr[i] = pr[parent];
			i = parent;
		}
		vl[i] = v;
		pr[i] = p;
	}
	pop() {
		const pr = this.pri;
		const vl = this.val;
		const top = vl[0];
		const n = --this.size;
		const lastV = vl[n];
		const lastP = pr[n];
		if (n > 0) {
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				if (l >= n) break;
				const r = l + 1;
				const c = r < n && pr[r] < pr[l] ? r : l;
				if (pr[c] >= lastP) break;
				vl[i] = vl[c];
				pr[i] = pr[c];
				i = c;
			}
			vl[i] = lastV;
			pr[i] = lastP;
		}
		return top;
	}
};
/**
* Search scratch shared by every call (routing is synchronous): the per-state cost, back-pointer
* and closed arrays only grow, so a full re-route allocates them a few times rather than once per
* wire. Each search clears just the part it uses.
*/
var scratch = {
	cost: /* @__PURE__ */ new Float64Array(0),
	prev: /* @__PURE__ */ new Int32Array(0),
	closed: /* @__PURE__ */ new Uint8Array(0),
	heap: new MinHeap()
};
function buffers(n) {
	if (scratch.cost.length < n) {
		const size = Math.max(n, scratch.cost.length * 2);
		scratch.cost = new Float64Array(size);
		scratch.prev = new Int32Array(size);
		scratch.closed = new Uint8Array(size);
	}
	const cost = scratch.cost.subarray(0, n).fill(Infinity);
	const closed = scratch.closed.subarray(0, n).fill(0);
	scratch.heap.clear();
	return {
		cost,
		prev: scratch.prev,
		closed,
		heap: scratch.heap
	};
}
/** Column and row step for each heading in DIRS order (right, down, left, up). */
var STEP_X = [
	1,
	0,
	-1,
	0
];
var STEP_Y = [
	0,
	1,
	0,
	-1
];
function routeOrthogonal(req, opts = {}) {
	const g = opts.grid ?? 10;
	const clearance = opts.clearance ?? 4;
	const bendCost = opts.bendCost ?? 30;
	const parallelCost = opts.parallelCost ?? 40;
	const ahead = (p, d, lead = 0) => ({
		x: p.x + d.x * lead,
		y: p.y + d.y * lead
	});
	const start = req.fromDir ? leave(ahead(req.from, req.fromDir, req.fromLead), req.fromDir, g) : onGrid(req.from, g);
	const goal = req.toDir ? leave(ahead(req.to, req.toDir, req.toLead), req.toDir, g) : onGrid(req.to, g);
	for (const margin of opts.margins ?? MARGINS) {
		const path = search(start, goal, req, g, clearance, bendCost, parallelCost, margin);
		if (path) {
			const first = path[0];
			const last = path[path.length - 1];
			const head = skew(req.from, first) ? [req.fromDir?.x === 0 ? {
				x: req.from.x,
				y: first.y
			} : {
				x: first.x,
				y: req.from.y
			}] : [];
			const tail = skew(last, req.to) ? [req.toDir?.x === 0 ? {
				x: req.to.x,
				y: last.y
			} : {
				x: last.x,
				y: req.to.y
			}] : [];
			return simplify([
				req.from,
				...head,
				...path,
				...tail,
				req.to
			]);
		}
	}
	return null;
}
/** True when a and b differ on both axes, so a straight line between them would be a diagonal. */
var skew = (a, b) => a.x !== b.x && a.y !== b.y;
/** True when `p` lies inside `r` grown by `clearance` on every side (the cells the router blocks). */
var inGrown = (p, r, clearance = 4) => p.x >= r.x - clearance && p.x <= r.x + r.w + clearance && p.y >= r.y - clearance && p.y <= r.y + r.h + clearance;
function search(start, goal, req, g, clearance, bendCost, parallelCost, margin) {
	const x0 = Math.floor((Math.min(start.x, goal.x) - margin) / g) * g;
	const y0 = Math.floor((Math.min(start.y, goal.y) - margin) / g) * g;
	const x1 = Math.ceil((Math.max(start.x, goal.x) + margin) / g) * g;
	const y1 = Math.ceil((Math.max(start.y, goal.y) + margin) / g) * g;
	const cols = (x1 - x0) / g + 1;
	const rows = (y1 - y0) / g + 1;
	if (cols * rows > MAX_CELLS) return null;
	const blocked = new Uint8Array(cols * rows);
	for (const r of req.obstacles) {
		const ax = r.x - clearance, ay = r.y - clearance;
		const bx = r.x + r.w + clearance, by = r.y + r.h + clearance;
		if (bx < x0 || ax > x1 || by < y0 || ay > y1) continue;
		const c0 = Math.max(0, Math.ceil((ax - x0) / g)), c1 = Math.min(cols - 1, Math.floor((bx - x0) / g));
		const r0 = Math.max(0, Math.ceil((ay - y0) / g)), r1 = Math.min(rows - 1, Math.floor((by - y0) / g));
		for (let row = r0; row <= r1; row++) blocked.fill(1, row * cols + c0, row * cols + c1 + 1);
	}
	const cellOf = (p) => (p.y - y0) / g * cols + (p.x - x0) / g;
	const startCell = cellOf(start);
	const goalCell = cellOf(goal);
	if (req.avoid?.length) {
		const inWindow = (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
		const exempt = /* @__PURE__ */ new Set([startCell, goalCell]);
		for (const [p, d] of [[start, req.fromDir], [goal, req.toDir]]) {
			const n = d && {
				x: p.x + d.x * g,
				y: p.y + d.y * g
			};
			if (n && inWindow(n)) exempt.add(cellOf(n));
		}
		const soft = [];
		for (const p of req.avoid) {
			const n = {
				x: Math.round(p.x / g) * g,
				y: Math.round(p.y / g) * g
			};
			if (Math.abs(n.x - p.x) > clearance || Math.abs(n.y - p.y) > clearance || n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1) continue;
			const cell = cellOf(n);
			if (!blocked[cell] && !exempt.has(cell)) soft.push(cell);
		}
		for (const cell of soft) blocked[cell] = 1;
	}
	if (blocked[startCell] || blocked[goalCell]) return null;
	if (startCell === goalCell) return [start];
	let parallel = null;
	if (req.occupied?.size) {
		parallel = new Uint8Array(cols * rows);
		req.occupied.copyWindow(x0, y0, cols, rows, g, parallel);
	}
	const gc = goalCell % cols;
	const gr = Math.floor(goalCell / cols);
	const endDir = req.toDir ? dirIndex({
		x: -req.toDir.x,
		y: -req.toDir.y
	}) : -1;
	const { cost, prev, closed, heap } = buffers(cols * rows * 4);
	const seeds = req.fromDir ? [dirIndex(req.fromDir)] : [
		0,
		1,
		2,
		3
	];
	const h0 = (Math.abs(startCell % cols - gc) + Math.abs(Math.floor(startCell / cols) - gr)) * g;
	for (const sd of seeds) {
		const s = startCell * 4 + sd;
		cost[s] = 0;
		prev[s] = -1;
		heap.push(s, h0);
	}
	let found = -1;
	while (heap.size) {
		const state = heap.pop();
		if (closed[state]) continue;
		closed[state] = 1;
		const cell = state >> 2;
		if (cell === goalCell) {
			found = state;
			break;
		}
		const d = state & 3;
		const back = d + 2 & 3;
		const col = cell % cols;
		const row = (cell - col) / cols;
		const here = cost[state];
		const lanes = parallel !== null && !(here === 0 && cell === startCell);
		for (let nd = 0; nd < 4; nd++) {
			if (nd === back) continue;
			const nc = col + STEP_X[nd];
			const nr = row + STEP_Y[nd];
			if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
			const ncell = nr * cols + nc;
			if (blocked[ncell]) continue;
			let c = here + g + (nd !== d ? bendCost : 0);
			if (ncell === goalCell) {
				if (endDir >= 0 && nd !== endDir && req.toLead) continue;
				if (endDir >= 0 && nd !== endDir) c += bendCost;
			} else if (lanes && parallel[ncell] & (nd & 1 ? V_BIT : H_BIT)) c += parallelCost;
			const ns = ncell * 4 + nd;
			if (c < cost[ns]) {
				cost[ns] = c;
				prev[ns] = state;
				heap.push(ns, c + (Math.abs(nc - gc) + Math.abs(nr - gr)) * g);
			}
		}
	}
	if (found < 0) return null;
	const cells = [];
	for (let st = found; st >= 0; st = prev[st]) {
		const cell = st >> 2;
		cells.push({
			x: x0 + cell % cols * g,
			y: y0 + Math.floor(cell / cols) * g
		});
	}
	return cells.reverse();
}
//#endregion
//#region src/format/wireEdit.ts
var same = (p, q) => p.x === q.x && p.y === q.y;
/** True when q sits on the straight line r..p, strictly between them (a bend the wire runs straight through). */
function straight(r, q, p) {
	if (r.x === q.x && q.x === p.x) return (q.y - r.y) * (p.y - q.y) > 0;
	if (r.y === q.y && q.y === p.y) return (q.x - r.x) * (p.x - q.x) > 0;
	return false;
}
/** True when q is on the line r..p but the wire folds back at it (a spike). */
function spike(r, q, p) {
	return (r.x === q.x && q.x === p.x || r.y === q.y && q.y === p.y) && !straight(r, q, p);
}
/** True when every step of the polyline is horizontal or vertical. */
function isOrthogonal(points) {
	for (let i = 1; i < points.length; i++) if (points[i].x !== points[i - 1].x && points[i].y !== points[i - 1].y) return false;
	return true;
}
/**
* Drops repeated points and spikes (a point the wire runs out to and straight back from). Unlike
* `simplify`, a collinear bend the wire runs straight through is kept.
*/
function tidy(points) {
	const out = [];
	for (const p of points) {
		if (out.length && same(out[out.length - 1], p)) continue;
		while (out.length >= 2 && spike(out[out.length - 2], out[out.length - 1], p)) out.pop();
		if (out.length && same(out[out.length - 1], p)) continue;
		out.push({
			x: p.x,
			y: p.y
		});
	}
	return out;
}
/**
* True when any segment passes through the inside of a part body (running along its edge is
* fine), or is diagonal (a hand-shaped wire should never have one, so it is drawn as blocked).
*/
function manualRouteBlocked(points, obstacles) {
	if (!isOrthogonal(points)) return true;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		for (const r of obstacles) if (a.y === b.y) {
			if (a.y > r.y && a.y < r.y + r.h && Math.min(Math.max(a.x, b.x), r.x + r.w) - Math.max(Math.min(a.x, b.x), r.x) > 0) return true;
		} else if (a.x === b.x) {
			if (a.x > r.x && a.x < r.x + r.w && Math.min(Math.max(a.y, b.y), r.y + r.h) - Math.max(Math.min(a.y, b.y), r.y) > 0) return true;
		}
	}
	return false;
}
//#endregion
//#region src/format/breadboard.ts
var OFF = 2 ** 25;
/**
* One number per world grid point. Unique only for whole-number x and y within +-2^25 px, so
* lookups go through `holeAt`, which checks both and compares the found hole exactly.
*/
var pointKey = (x, y) => (x + OFF) * 2 ** 26 + (y + OFF);
var inRange = (n) => Number.isInteger(n) && n > -OFF && n < OFF;
var indexCache = /* @__PURE__ */ new WeakMap();
/** World hole positions of a part with hole groups, and a lookup from grid point to hole. */
function holeIndex(part, m) {
	const hit = indexCache.get(part);
	if (hit && hit.m === m) return hit.index;
	const groups = worldHoles(part, m);
	const byPoint = /* @__PURE__ */ new Map();
	groups.forEach((g, gi) => g.at.forEach((p, hi) => {
		if (inRange(p.x) && inRange(p.y)) byPoint.set(pointKey(p.x, p.y), [gi, hi]);
	}));
	const index = {
		groups,
		byPoint
	};
	indexCache.set(part, {
		m,
		index
	});
	return index;
}
/** The [group index, hole index] whose center is exactly `pt`, or null. A fractional or out-of-range point never matches. */
function holeAt(index, pt) {
	if (!inRange(pt.x) || !inRange(pt.y)) return null;
	const hit = index.byPoint.get(pointKey(pt.x, pt.y));
	if (!hit) return null;
	const at = index.groups[hit[0]].at[hit[1]];
	return at.x === pt.x && at.y === pt.y ? hit : null;
}
/** One key per hole on the sheet; JSON keeps any character in a uid or group name unambiguous. */
var holeKey$1 = (board, group, hole) => JSON.stringify([
	board,
	group,
	hole
]);
/** Holes holding a leg of a part outside `ignore`. */
var takenBy = (plugs, ignore) => new Set(plugs.filter((p) => !ignore.has(p.part)).map((p) => holeKey$1(p.board, p.group, p.hole)));
/** A part that may mount, with its plug points. Null for a missing part or module, a board, and a part with a bus pin or no pins. */
function mountable$1(d, uid) {
	const part = d.parts.find((p) => p.uid === uid);
	const m = part && moduleOf(d, part.module);
	if (!part || !m || isBoard(m) || m.pins.some((p) => !isSpacer(p) && p.bus)) return null;
	const pts = plugPoints(part, m);
	return pts.length ? {
		part,
		pts
	} : null;
}
/**
* Whether a board drawn above `board` (a later board in `d.parts`; boards draw in list order)
* covers any of `pts` with its body. A leg there looks as if it sits in the upper board, so the
* lower board's hole under it is not the one the user sees.
*/
function obscuredOn(d, board, pts) {
	for (let i = d.parts.indexOf(board) + 1; i < d.parts.length; i++) {
		const q = d.parts[i];
		const qm = moduleOf(d, q.module);
		if (!qm || !isBoard(qm)) continue;
		const r = bodyRect(q, layoutModule(qm));
		if (pts.some(({ at }) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h)) return true;
	}
	return false;
}
/** How plug points land on one part; null when that part is not a board. */
function fitOn(d, board, pts) {
	const bm = moduleOf(d, board.module);
	if (!bm || !isBoard(bm)) return null;
	const idx = holeIndex(board, bm);
	const hits = pts.map((pp) => holeAt(idx, pp.at));
	const landed = hits.filter(Boolean).length;
	return {
		board,
		groups: idx.groups,
		hits,
		landed,
		obscured: landed > 0 && obscuredOn(d, board, pts)
	};
}
/** An obscured board never seats: its fit shows as partial (red), so a drop does not mount. */
function seatFrom(fit, pts, taken) {
	if (!fit.landed) return null;
	return {
		status: !fit.obscured && fit.hits.every((h) => h && !taken.has(holeKey$1(fit.board.uid, fit.groups[h[0]].name, h[1]))) ? "seated" : "partial",
		board: fit.board.uid,
		holes: pts.filter((_, i) => fit.hits[i]).map((pp) => pp.at)
	};
}
/** `seatOf` on one given board (a part's own mount), whatever other board also fits. Null when `board` is missing or not a board. */
function seatOn(d, uid, board, plugs, ignore = /* @__PURE__ */ new Set([uid])) {
	const me = mountable$1(d, uid);
	const b = me && d.parts.find((p) => p.uid === board);
	const fit = me && b && b !== me.part ? fitOn(d, b, me.pts) : null;
	return me && fit && seatFrom(fit, me.pts, takenBy(plugs, ignore));
}
/**
* Walks mounted parts in `d.parts` order. A mount is valid when its part is seated on its own
* `mount.board` given the holes earlier valid mounts took; only valid mounts plug. An invalid
* mount keeps its data (for repair) and is reported with the reason it plugs nothing.
*/
function mounts(d) {
	const plugs = [];
	const issues = [];
	const taken = /* @__PURE__ */ new Set();
	for (const p of d.parts) {
		if (!p.mount) continue;
		const at = p.mount.board;
		const issue = (reason) => void issues.push({
			part: p.uid,
			board: at,
			reason
		});
		const board = d.parts.find((b) => b.uid === at);
		if (!board) {
			issue("missing-board");
			continue;
		}
		if (!isBoard(moduleOf(d, board.module))) {
			issue("not-a-board");
			continue;
		}
		const me = board === p ? null : mountable$1(d, p.uid);
		if (!me) {
			issue("cannot-mount");
			continue;
		}
		const fit = fitOn(d, board, me.pts);
		if (fit.landed < me.pts.length) issue("partial");
		else if (fit.obscured) issue("obscured");
		else if (seatFrom(fit, me.pts, taken).status !== "seated") issue("conflict");
		else me.pts.forEach((pp, i) => {
			const [gi, hi] = fit.hits[i];
			const group = fit.groups[gi].name;
			taken.add(holeKey$1(board.uid, group, hi));
			plugs.push({
				part: p.uid,
				pin: pp.pin,
				board: board.uid,
				group,
				hole: hi,
				at: pp.at
			});
		});
	}
	return {
		plugs,
		issues
	};
}
/**
* `mounts` depends only on the parts and their modules, so it is cached per parts array (a new
* array on every edit). The entry is rechecked part by part (identity of each part and its
* module), which is cheap next to the fit itself, so an array or module map edited in place never
* serves a stale answer. Each drag frame builds one entry that the renderer, the router and
* `resolveEndpoint` all share.
*/
var mountCache = /* @__PURE__ */ new WeakMap();
function cachedMounts(d) {
	const hit = mountCache.get(d.parts);
	if (hit && hit.seen.length === d.parts.length && hit.seen.every(([p, m], i) => d.parts[i] === p && moduleOf(d, p.module) === m)) return hit;
	const entry = {
		seen: d.parts.map((p) => [p, moduleOf(d, p.module)]),
		result: mounts(d)
	};
	mountCache.set(d.parts, entry);
	return entry;
}
var pinKey = (part, pin) => JSON.stringify([part, pin]);
/**
* Every plugged leg on the sheet, from each part's `mount` and positions: each pin of a validly
* mounted part plugs into the hole its plug point sits on. An invalid mount plugs nothing (see
* `mountIssues`). Cached per diagram parts: the array is shared, so callers must not mutate it.
*/
function plugsOf(d) {
	return cachedMounts(d).result.plugs;
}
/**
* The hole center pin `pin` of part `part` is plugged into, or null when that leg is not validly
* plugged. A map lookup after the first call per diagram parts.
*/
function plugOfPin(d, part, pin) {
	const entry = cachedMounts(d);
	if (!entry.byPin) entry.byPin = new Map(entry.result.plugs.map((pl) => [pinKey(pl.part, pl.pin), pl.at]));
	return entry.byPin.get(pinKey(part, pin)) ?? null;
}
/**
* Every mount that plugs nothing, and why: its board is missing or not a board, the part cannot
* mount, not every leg lands on a hole, a board drawn above its board covers a leg (obscured), or
* a hole is already taken by an earlier valid mount.
*/
function mountIssues(d) {
	return cachedMounts(d).result.issues;
}
//#endregion
//#region src/format/cables.ts
var END_KINDS = [
	"bare",
	"dupont-male",
	"dupont-female",
	"solid-jumper",
	"alligator",
	"stripped",
	"ferrule",
	"jst-xh",
	"jst-ph",
	"jst-sh",
	"grove",
	"banana"
];
function isEndKind(v) {
	return typeof v === "string" && END_KINDS.includes(v);
}
function endKind(ends, which) {
	return ends?.[which] ?? "bare";
}
/** The ends as stored: bare ends left out, and undefined when both are bare. */
function normalizeEnds(ends) {
	const out = {};
	if (ends?.from && ends.from !== "bare") out.from = ends.from;
	if (ends?.to && ends.to !== "bare") out.to = ends.to;
	return out.from || out.to ? out : void 0;
}
/**
* How much of the wire each end's connector takes, in px back from the endpoint at full size:
* `reach` is the connector's whole length, and `trim` is where the drawn wire stops, so the wire
* runs into a housing's back or up to a bare metal end. An `exposed` end (a bare leg, a tinned
* tip) shows the wire's own insulation ending there, so the wire is cut back a further half its
* drawn width to keep its round cap off the metal.
*/
var END_SIZE = {
	bare: {
		reach: 0,
		trim: 0,
		exposed: false
	},
	"dupont-male": {
		reach: 21,
		trim: 15,
		exposed: false
	},
	"dupont-female": {
		reach: 17,
		trim: 12,
		exposed: false
	},
	"solid-jumper": {
		reach: 8,
		trim: 8,
		exposed: true
	},
	alligator: {
		reach: 29,
		trim: 24,
		exposed: false
	},
	stripped: {
		reach: 6,
		trim: 6,
		exposed: true
	},
	ferrule: {
		reach: 14,
		trim: 11,
		exposed: false
	},
	"jst-xh": {
		reach: 13,
		trim: 9,
		exposed: false
	},
	"jst-ph": {
		reach: 11,
		trim: 7,
		exposed: false
	},
	"jst-sh": {
		reach: 8,
		trim: 5,
		exposed: false
	},
	grove: {
		reach: 14,
		trim: 10,
		exposed: false
	},
	banana: {
		reach: 28,
		trim: 22,
		exposed: false
	}
};
//#endregion
//#region src/format/diagram.ts
var DIAGRAM_FORMAT = "circuitoon-diagram/1";
var NAMED_COLORS = {
	red: "#E0483E",
	black: "#2B2F36",
	blue: "#3D6FD6",
	green: "#2F9E6E",
	yellow: "#F4B400",
	orange: "#F48C06",
	white: "#FFFFFF",
	purple: "#8E5BD6",
	gray: "#9AA2AD",
	brown: "#8B5A2B",
	pink: "#F07AB0"
};
/**
* The embedded module a part uses. Own keys only, so a module named "constructor" or
* "toString" in a file is simply missing rather than an Object prototype member.
*/
function moduleOf(d, id) {
	return Object.hasOwn(d.modules, id) ? d.modules[id] : void 0;
}
/** Part bodies wires must route around. A module with `obstacle: false` (a breadboard) is not one. */
function partObstacles(d) {
	return d.parts.flatMap((p) => {
		const m = moduleOf(d, p.module);
		return m && m.obstacle !== false ? [bodyRect(p, layoutModule(m))] : [];
	});
}
/**
* Resolves a connection end. A pin resolves to its stub tip and outward direction; a hole group
* resolves to the center of hole `ep.hole` (default 0), which a wire may leave in any direction.
* A pin whose leg is validly plugged into a board (Ruling 25) resolves to that leg's hole, also
* with no direction: a jumper to that pin goes into the same strip as the leg, and the stub tip
* would sit over the neighbouring hole. Null when the part, pin, group or hole does not exist.
*/
function resolveEndpoint(d, ep) {
	const part = d.parts.find((p) => p.uid === ep.part);
	const mod = part && moduleOf(d, part.module);
	if (!part || !mod) return null;
	const group = mod.holes?.find((g) => g.name === ep.pin);
	if (group) {
		const local = ep.offset === void 0 ? group.at[ep.hole ?? 0] : void 0;
		return local ? {
			end: toWorld(part, layoutModule(mod), {
				x: local[0],
				y: local[1]
			}),
			dir: null
		} : null;
	}
	const pin = worldPins(part, mod).find((p) => p.name === ep.pin);
	if (!pin || !validOffset(ep.offset, pin.bus)) return null;
	const hole = part.mount ? plugOfPin(d, part.uid, pin.name) : null;
	return hole ? {
		end: hole,
		dir: null
	} : {
		end: pin.end,
		dir: pin.dir
	};
}
/**
* Whether an endpoint `offset` names a real position: none at all, or on a bus pin a whole number
* from 0 to bus.length - 1. An offset on a pin that is not a bus means nothing, so it is invalid too.
*/
function validOffset(offset, bus) {
	return offset === void 0 || !!bus && Number.isInteger(offset) && offset >= 0 && offset < bus.length;
}
/**
* A hand-routed wire keeps its stored bends; only its end segments stretch to reach a moved
* pin. Where a pin tip and its neighbouring bend no longer line up, a corner is added so the
* wire still leaves the pin along its stub, and every segment stays horizontal or vertical.
* Two stored bends that do not line up (a hand-edited file) get a corner between them too,
* horizontal first. Collinear bends are kept (the user may have split a run to move its halves
* separately), so this polyline is also what the editing handles work on; only spikes and
* repeats are dropped.
*/
function manualPoints(a, b, route) {
	const bends = route.map(([x, y]) => ({
		x,
		y
	}));
	const corner = (pin, next) => {
		if (!next || next.x === pin.end.x || next.y === pin.end.y) return [];
		return [pin.dir === null || pin.dir.x !== 0 ? {
			x: next.x,
			y: pin.end.y
		} : {
			x: pin.end.x,
			y: next.y
		}];
	};
	const head = corner(a, bends.length ? bends[0] : b.end);
	const tail = bends.length ? corner(b, bends[bends.length - 1]) : [];
	const pts = [
		a.end,
		...head,
		...bends,
		...tail,
		b.end
	];
	const out = [pts[0]];
	for (let i = 1; i < pts.length; i++) {
		const p = pts[i - 1];
		const q = pts[i];
		if (p.x !== q.x && p.y !== q.y) out.push({
			x: q.x,
			y: p.y
		});
		out.push(q);
	}
	return tidy(out);
}
/**
* The obstacles one wire must avoid: all of them, minus any body over one of its hole ends. A
* hole under a part (a leg's hole, a hole under a DIP body) has no exit direction and every grid
* node around it is inside that body, so the wire may leave through the part covering it, as a
* real jumper slides out from under one. Only this wire's obstacle list changes; every other
* wire still routes around the part. A pin end always has an exit (its stub), so it drops nothing.
*/
function obstaclesFor(obstacles, a, b) {
	const keep = obstacleFilter(a, b);
	return keep ? obstacles.filter(keep) : obstacles;
}
/**
* The test behind `obstaclesFor`, as a predicate (true keeps the body as an obstacle for this
* wire), or null when the wire has no hole end and keeps every body.
*/
function obstacleFilter(a, b) {
	const free = [a, b].filter((e) => e.dir === null).map((e) => onGrid(e.end, 10));
	if (!free.length) return null;
	return (r) => !free.some((p) => inGrown(p, r));
}
/**
* Stand-in for a wire with no clear route: an L leaving `a` along its stub (vertically from a top
* or bottom pin, horizontally from a side pin or a hole), like manualPoints' corner rule.
*/
function blockedPoints(a, b) {
	const vertical = a.dir !== null && a.dir.x === 0;
	return tidy([
		a.end,
		vertical ? {
			x: a.end.x,
			y: b.end.y
		} : {
			x: b.end.x,
			y: a.end.y
		},
		b.end
	]);
}
/**
* The straight run each end of `c` needs before its first bend: its connector's reach rounded up
* to the grid, on a pin end with a connector (a hole end may leave any way, so it gets none).
* `facing` marks two pins that face each other on one line: when nothing is in the way, the wire
* between them is one straight run that both connectors share, even when that line is off the
* grid. Any other route between them (a detour, a hand-shaped wire) keeps both lead-outs.
*/
function leadsOf(c, a, b) {
	if (!c.ends) return {
		leads: [0, 0],
		facing: false
	};
	const lead = (e, which) => e.dir ? Math.ceil(END_SIZE[endKind(c.ends, which)].reach / 10) * 10 : 0;
	let facing = false;
	if (a.dir && b.dir && a.dir.x === -b.dir.x && a.dir.y === -b.dir.y) {
		const dx = b.end.x - a.end.x;
		const dy = b.end.y - a.end.y;
		facing = a.dir.x !== 0 ? dy === 0 && Math.sign(dx) === a.dir.x : dx === 0 && Math.sign(dy) === a.dir.y;
	}
	return {
		leads: [lead(a, "from"), lead(b, "to")],
		facing
	};
}
/**
* Makes a polyline leave its first point straight along `dir` for at least `lead` px. A shorter
* first run is replaced by a lead-out that then turns toward the next point that is not on it:
* across first when that point lies behind the lead-out's end, so the wire never doubles back
* over its own lead.
*/
function withLeadOut(pts, dir, lead) {
	if (!dir || !lead || pts.length < 2) return pts;
	const p0 = pts[0];
	const along = (p) => (p.x - p0.x) * dir.x + (p.y - p0.y) * dir.y;
	const onAxis = (p) => dir.x !== 0 ? p.y === p0.y : p.x === p0.x;
	if (onAxis(pts[1]) && along(pts[1]) >= lead) return pts;
	const tip = {
		x: p0.x + dir.x * lead,
		y: p0.y + dir.y * lead
	};
	let k = 1;
	while (k < pts.length - 1 && onAxis(pts[k]) && along(pts[k]) >= 0 && along(pts[k]) <= lead) k++;
	const q = pts[k];
	if (onAxis(q)) return pts;
	return tidy([
		p0,
		tip,
		along(q) >= lead ? dir.x !== 0 ? {
			x: q.x,
			y: tip.y
		} : {
			x: tip.x,
			y: q.y
		} : dir.x !== 0 ? {
			x: tip.x,
			y: q.y
		} : {
			x: q.x,
			y: tip.y
		},
		...pts.slice(k)
	]);
}
var holeGroupKey = (board, group) => JSON.stringify([board, group]);
var legKey = (part, pin) => JSON.stringify([part, pin]);
function boardHoles(d) {
	const groups = [];
	for (const p of d.parts) {
		const m = moduleOf(d, p.module);
		if (!m || !isBoard(m)) continue;
		for (const g of worldHoles(p, m)) groups.push({
			key: holeGroupKey(p.uid, g.name),
			at: g.at
		});
	}
	const legGroup = /* @__PURE__ */ new Map();
	if (groups.length) for (const pl of plugsOf(d)) legGroup.set(legKey(pl.part, pl.pin), holeGroupKey(pl.board, pl.group));
	return {
		groups,
		legGroup
	};
}
/** Every board hole wire `c` must not run over: all but those of the groups its ends are in. */
function foreignHoles(c, holes) {
	if (!holes.groups.length) return [];
	const own = /* @__PURE__ */ new Set();
	for (const e of [c.from, c.to]) {
		own.add(holeGroupKey(e.part, e.pin));
		const leg = holes.legGroup.get(legKey(e.part, e.pin));
		if (leg) own.add(leg);
	}
	return holes.groups.flatMap((g) => own.has(g.key) ? [] : g.at);
}
/** True when a straight run from `a` to `b` passes within 3 px of any of `pts`. */
function runsOver(a, b, pts) {
	const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
	const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
	return pts.some((p) => p.x >= x0 - 3 && p.x <= x1 + 3 && p.y >= y0 - 3 && p.y <= y1 + 3);
}
function routeWire(d, c, obstacles, occupied, holes = boardHoles(d)) {
	const a = resolveEndpoint(d, c.from);
	const b = resolveEndpoint(d, c.to);
	if (!a || !b) return null;
	const foreign = foreignHoles(c, holes);
	const own = obstaclesFor(obstacles, a, b);
	const { leads: [fromLead, toLead], facing } = leadsOf(c, a, b);
	if (facing && !c.route && !manualRouteBlocked([a.end, b.end], own) && !runsOver(a.end, b.end, foreign)) return {
		points: [a.end, b.end],
		blocked: false
	};
	if (c.route) {
		let points = manualPoints(a, b, c.route);
		if (fromLead || toLead) points = withLeadOut(withLeadOut(points, a.dir, fromLead).reverse(), b.dir, toLead).reverse();
		return {
			points,
			blocked: manualRouteBlocked(points, own)
		};
	}
	const attached = (pts) => !manualRouteBlocked(pts.slice(0, 3), own) && !manualRouteBlocked(pts.slice(-3), own);
	const tries = [
		[fromLead, toLead],
		[fromLead, 0],
		[0, toLead]
	];
	const attempt = (avoid) => {
		const req = {
			from: a.end,
			fromDir: a.dir,
			to: b.end,
			toDir: b.dir,
			obstacles: own,
			avoid,
			occupied
		};
		for (const [i, [f, t]] of tries.entries()) {
			if (!f && !t || tries.slice(0, i).some(([pf, pt]) => pf === f && pt === t)) continue;
			const pts = routeOrthogonal({
				...req,
				fromLead: f,
				toLead: t
			});
			if (pts && attached(pts)) return pts;
		}
		return routeOrthogonal(req);
	};
	const points = attempt(foreign) ?? (foreign.length ? attempt([]) : null);
	return points ? {
		points,
		blocked: false
	} : {
		points: blockedPoints(a, b),
		blocked: true
	};
}
/**
* Routes every connection in file order, feeding each auto route the grid lanes every earlier
* route (auto or manual) already used, so a wire whose shortest path would run alongside an
* earlier one takes its own lane instead. With `only`, connections outside the set keep their
* route from `prev` (used while dragging so only the moving part's or reshaped wire's routes are
* recomputed each frame); those kept routes still seed the lanes the `only` routes see.
* `occupancy: false` routes every wire as if it were alone on the sheet (no lanes), which is much
* cheaper; the editor uses it for the wires it re-routes on each drag frame, and the full route
* on drop applies lanes again.
*/
function computeRoutes(d, opts = {}) {
	const obstacles = partObstacles(d);
	const holes = boardHoles(d);
	const out = /* @__PURE__ */ new Map();
	const occupied = opts.occupancy === false ? void 0 : new Occupancy();
	for (const c of d.connections) if (opts.only && !opts.only.has(c.uid) && opts.prev?.has(c.uid)) {
		const kept = opts.prev.get(c.uid);
		out.set(c.uid, kept);
		if (kept && occupied) addToOccupancy(occupied, kept.points);
	}
	for (const c of d.connections) {
		if (out.has(c.uid)) continue;
		const route = routeWire(d, c, obstacles, occupied, holes);
		out.set(c.uid, route);
		if (route && occupied) addToOccupancy(occupied, route.points);
	}
	return out;
}
function isValidColor(c) {
	return /^#[0-9a-f]{6}$/i.test(c) || Object.hasOwn(NAMED_COLORS, c.toLowerCase());
}
/** The file text. Cable ends are written only where they are not bare, so plain wires stay unchanged. */
function serializeDiagram(d) {
	const out = d.connections.some((c) => "ends" in c) ? {
		...d,
		connections: d.connections.map((c) => {
			if (!("ends" in c)) return c;
			const { ends: _ends, ...rest } = c;
			const ends = normalizeEnds(c.ends);
			return ends ? {
				...c,
				ends
			} : rest;
		})
	} : d;
	return JSON.stringify(out, null, 2) + "\n";
}
//#endregion
//#region src/cli/io.ts
/** Spec 4.2: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (no browser). */
var EXIT = {
	ok: 0,
	blocked: 1,
	input: 2,
	environment: 3
};
var CliError = class extends Error {
	code;
	constructor(message, code) {
		super(message);
		this.code = code;
	}
};
var pathIn = (io, path) => resolve(io.cwd, path);
function readJson(io, path) {
	let text;
	try {
		text = readFileSync(pathIn(io, path), "utf8");
	} catch {
		throw new CliError(`${path}: cannot read the file`, EXIT.input);
	}
	try {
		return JSON.parse(text);
	} catch (e) {
		throw new CliError(`${path}: not valid JSON (${e.message})`, EXIT.input);
	}
}
function writeFile(io, path, content) {
	const full = pathIn(io, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, content);
}
var printJson = (io, value) => io.stdout(`${JSON.stringify(value, null, 2)}\n`);
function flag(args, name) {
	const v = args.flags.get(name);
	return typeof v === "string" ? v : void 0;
}
var library = Object.entries(/* @__PURE__ */ Object.assign({
	"../modules/ams1117-33-module.json": {
		format: "circuitoon-module/1",
		id: "ams1117-33-module",
		version: 1,
		name: "AMS1117 3.3 V regulator module (3-pin)",
		category: "Power",
		source: "https://www.amazon.com/dp/B07CP4P5XJ https://protosupplies.com/product/ams1117-5v-to-3-3v-step-down-regulator-module/",
		pins: [
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"name": "OUT",
				"side": "bottom",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "VIN",
				"side": "bottom",
				"type": "power_in",
				"supply": "5V/9V/12V"
			}
		],
		size: {
			"w": 8,
			"h": 10
		},
		electrical: {
			"model": "regulator",
			"params": {}
		},
		art: {
			"w": 80,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 80,
					"h": 100,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 24,
					"y": 6,
					"w": 32,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 28,
					"y": 44,
					"w": 4,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38,
					"y": 44,
					"w": 4,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48,
					"y": 44,
					"w": 4,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 16,
					"w": 52,
					"h": 30,
					"fill": "#1E2126",
					"radius": 1,
					"label": "AMS1117",
					"labelColor": "#C9CED6",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 26,
					"y": 34,
					"w": 28,
					"h": 8,
					"fill": "#1E2126",
					"outline": false,
					"label": "3.3",
					"labelColor": "#C9CED6",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 26,
					"y": 89,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 91.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 89,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 91.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 46,
					"y": 89,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 91.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/arduino-nano.json": {
		format: "circuitoon-module/1",
		id: "arduino-nano",
		version: 1,
		name: "Arduino Nano (ATmega328P)",
		category: "Microcontrollers",
		source: "https://docs.arduino.cc/resources/pinouts/A000005-full-pinout.pdf https://docs.arduino.cc/hardware/nano/ https://lastminuteengineers.com/arduino-nano-pinout/ https://docs.arduino.cc/resources/schematics/A000005-schematics.pdf",
		pins: [
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "D13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "3V3",
				"side": "left",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "AREF",
				"side": "left",
				"label": "REF",
				"type": "input"
			},
			{
				"name": "A0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "A1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "A2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "A3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "A4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "A5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "A6",
				"side": "left",
				"type": "input"
			},
			{
				"name": "A7",
				"side": "left",
				"type": "input"
			},
			{
				"name": "5V",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "RST",
				"side": "left",
				"type": "input"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "VIN",
				"side": "left",
				"type": "power_in",
				"supply": "7V/7.4V/9V/12V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "D12",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D11",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D10",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D9",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D8",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D7",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D6",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D5",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D4",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D3",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "RST 2",
				"side": "right",
				"label": "RST",
				"type": "input"
			},
			{
				"name": "RX0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "TX1",
				"side": "right",
				"type": "io"
			}
		],
		internal: [["GND", "GND 2"], ["RST", "RST 2"]],
		size: {
			"w": 8,
			"h": 18
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB",
				"diode": true
			}]
		},
		art: {
			"w": 80,
			"h": 180,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 80,
					"h": 180,
					"fill": "#17708A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 25,
					"w": 8,
					"h": 150,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 70,
					"y": 25,
					"w": 8,
					"h": 150,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27,
					"y": -8,
					"w": 26,
					"h": 24,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 32,
					"y": -6,
					"w": 16,
					"h": 4,
					"fill": "#8A9099",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 50,
					"w": 32,
					"h": 32,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "ATMEGA",
					"labelColor": "#D5DAE1",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 24,
					"y": 72,
					"w": 32,
					"h": 8,
					"fill": "#1B1F24",
					"outline": false,
					"label": "328P",
					"labelColor": "#D5DAE1",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 33,
					"y": 96,
					"w": 14,
					"h": 14,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 37,
					"y": 100,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 122,
					"w": 5,
					"h": 4,
					"fill": "#F4B400",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 33,
					"y": 122,
					"w": 5,
					"h": 4,
					"fill": "#E5484D",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 42,
					"y": 122,
					"w": 5,
					"h": 4,
					"fill": "#3FB56B",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 51,
					"y": 122,
					"w": 5,
					"h": 4,
					"fill": "#F4B400",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 31,
					"y": 154,
					"w": 18,
					"h": 14,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 32.5,
					"y": 156.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 32.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 156.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44.5,
					"y": 156.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/battery-18650-cell.json": {
		format: "circuitoon-module/1",
		id: "battery-18650-cell",
		version: 2,
		name: "18650 cell",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "3.7V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3.7
			} }
		},
		art: {
			"w": 70,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 58,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 9,
					"y": 9,
					"w": 52,
					"h": 22,
					"fill": "#3D6FD6",
					"radius": 11,
					"label": "18650",
					"labelColor": "#EAF6FF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 8,
					"y": 11,
					"w": 6,
					"h": 18,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 58,
					"y": 15,
					"w": 6,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 3
				}
			]
		}
	},
	"../modules/battery-18650-holder-2s.json": {
		format: "circuitoon-module/1",
		id: "battery-18650-holder-2s",
		version: 2,
		name: "18650 holder (2 cells, series)",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "right",
				"type": "power_out",
				"supply": "7.4V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "-",
				"side": "right",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 7.4
			} }
		},
		art: {
			"w": 100,
			"h": 70,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 9,
					"w": 52,
					"h": 16,
					"fill": "#3D6FD6",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 58,
					"y": 10,
					"w": 8,
					"h": 14,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 4,
					"y": 34,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 43,
					"w": 6,
					"h": 10,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 39,
					"w": 52,
					"h": 16,
					"fill": "#3D6FD6",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 58,
					"y": 40,
					"w": 8,
					"h": 14,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 72,
					"y": 28.5,
					"w": 28,
					"h": 3,
					"fill": "#D8413A",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 72,
					"y": 48.5,
					"w": 28,
					"h": 3,
					"fill": "#1B1B1B",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/battery-18650-holder.json": {
		format: "circuitoon-module/1",
		id: "battery-18650-holder",
		version: 2,
		name: "18650 holder (1 cell)",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "right",
				"type": "power_out",
				"supply": "3.7V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "-",
				"side": "right",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3.7
			} }
		},
		art: {
			"w": 100,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 6,
					"w": 78,
					"h": 38,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 20,
					"w": 6,
					"h": 10,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 16,
					"w": 58,
					"h": 18,
					"fill": "#3D6FD6",
					"radius": 9
				},
				{
					"type": "rect",
					"x": 64,
					"y": 18,
					"w": 8,
					"h": 14,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 76,
					"y": 18.5,
					"w": 24,
					"h": 3,
					"fill": "#D8413A",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 76,
					"y": 38.5,
					"w": 24,
					"h": 3,
					"fill": "#1B1B1B",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/battery-9v.json": {
		format: "circuitoon-module/1",
		id: "battery-9v",
		version: 2,
		name: "9V battery",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "top",
				"type": "power_out",
				"supply": "9V"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"name": "-",
				"side": "top",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 9
			} }
		},
		art: {
			"w": 80,
			"h": 90,
			"shapes": [
				{
					"type": "rect",
					"x": 13,
					"y": 0,
					"w": 14,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 62,
					"y": 0,
					"w": 16,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 4,
					"y": 8,
					"w": 72,
					"h": 14,
					"fill": "#3A3F47",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 4,
					"y": 20,
					"w": 72,
					"h": 68,
					"fill": "#D98C2B",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 5,
					"y": 44,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"outline": false,
					"label": "9V",
					"labelColor": "#F4B400",
					"labelSize": 15
				}
			]
		}
	},
	"../modules/battery-aa.json": {
		format: "circuitoon-module/1",
		id: "battery-aa",
		version: 1,
		name: "AA battery",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "1.5V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 1.5
			} }
		},
		art: {
			"w": 60,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 50,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 9,
					"y": 9,
					"w": 42,
					"h": 22,
					"fill": "#C9852E",
					"radius": 11,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 9,
					"y": 9,
					"w": 13,
					"h": 22,
					"fill": "#232323",
					"radius": 11
				},
				{
					"type": "rect",
					"x": 45,
					"y": 15,
					"w": 7,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 3
				}
			]
		}
	},
	"../modules/battery-aaa.json": {
		format: "circuitoon-module/1",
		id: "battery-aaa",
		version: 1,
		name: "AAA battery",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "1.5V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 1.5
			} }
		},
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 8,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 32,
					"y": 18.5,
					"w": 8,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 7,
					"y": 13,
					"w": 26,
					"h": 14,
					"fill": "#C9852E",
					"radius": 7,
					"label": "AAA",
					"labelColor": "#FFFFFF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 7,
					"y": 13,
					"w": 9,
					"h": 14,
					"fill": "#232323",
					"radius": 7
				},
				{
					"type": "rect",
					"x": 29,
					"y": 17,
					"w": 6,
					"h": 6,
					"fill": "#D5DAE1",
					"radius": 3
				}
			]
		}
	},
	"../modules/battery-cr1220.json": {
		format: "circuitoon-module/1",
		id: "battery-cr1220",
		version: 1,
		name: "CR1220 coin cell",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "3V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3
			} }
		},
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 8,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 32,
					"y": 18.5,
					"w": 8,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 6,
					"w": 28,
					"h": 28,
					"fill": "#C9CED6",
					"radius": 14
				},
				{
					"type": "rect",
					"x": 10,
					"y": 10,
					"w": 20,
					"h": 20,
					"fill": "#9AA0AC",
					"radius": 10,
					"label": "CR1220",
					"labelColor": "#20242B",
					"labelSize": 5
				}
			]
		}
	},
	"../modules/battery-cr2016.json": {
		format: "circuitoon-module/1",
		id: "battery-cr2016",
		version: 1,
		name: "CR2016 coin cell",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "3V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3
			} }
		},
		art: {
			"w": 50,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 40,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 7,
					"y": 4,
					"w": 36,
					"h": 32,
					"fill": "#C9CED6",
					"radius": 16
				},
				{
					"type": "rect",
					"x": 12,
					"y": 9,
					"w": 26,
					"h": 22,
					"fill": "#9AA0AC",
					"radius": 11,
					"label": "CR2016",
					"labelColor": "#20242B",
					"labelSize": 6.5
				}
			]
		}
	},
	"../modules/battery-cr2025.json": {
		format: "circuitoon-module/1",
		id: "battery-cr2025",
		version: 1,
		name: "CR2025 coin cell",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "3V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3
			} }
		},
		art: {
			"w": 50,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 40,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 7,
					"y": 4,
					"w": 36,
					"h": 32,
					"fill": "#C9CED6",
					"radius": 16
				},
				{
					"type": "rect",
					"x": 12,
					"y": 9,
					"w": 26,
					"h": 22,
					"fill": "#9AA0AC",
					"radius": 11,
					"label": "CR2025",
					"labelColor": "#20242B",
					"labelSize": 6.5
				}
			]
		}
	},
	"../modules/battery-cr2032.json": {
		format: "circuitoon-module/1",
		id: "battery-cr2032",
		version: 1,
		name: "CR2032 coin cell",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "3V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3
			} }
		},
		art: {
			"w": 50,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 40,
					"y": 18.5,
					"w": 10,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 7,
					"y": 4,
					"w": 36,
					"h": 32,
					"fill": "#C9CED6",
					"radius": 16
				},
				{
					"type": "rect",
					"x": 12,
					"y": 9,
					"w": 26,
					"h": 22,
					"fill": "#9AA0AC",
					"radius": 11,
					"label": "CR2032",
					"labelColor": "#20242B",
					"labelSize": 6.5
				}
			]
		}
	},
	"../modules/battery-holder-2xaa.json": {
		format: "circuitoon-module/1",
		id: "battery-holder-2xaa",
		version: 1,
		name: "2 x AA holder",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "right",
				"type": "power_out",
				"supply": "3V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "-",
				"side": "right",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3
			} }
		},
		art: {
			"w": 100,
			"h": 70,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 9,
					"w": 52,
					"h": 16,
					"fill": "#C9852E",
					"radius": 8,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 58,
					"y": 10,
					"w": 8,
					"h": 14,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 4,
					"y": 34,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 43,
					"w": 6,
					"h": 10,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 39,
					"w": 52,
					"h": 16,
					"fill": "#C9852E",
					"radius": 8,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 72,
					"y": 28.5,
					"w": 28,
					"h": 3,
					"fill": "#D8413A",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 72,
					"y": 48.5,
					"w": 28,
					"h": 3,
					"fill": "#1B1B1B",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/battery-holder-3xaaa.json": {
		format: "circuitoon-module/1",
		id: "battery-holder-3xaaa",
		version: 1,
		name: "3 x AAA holder",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "right",
				"type": "power_out",
				"supply": "4.5V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "-",
				"side": "right",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 4.5
			} }
		},
		art: {
			"w": 100,
			"h": 100,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 70,
					"h": 22,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 8,
					"w": 52,
					"h": 12,
					"fill": "#C9852E",
					"radius": 6,
					"label": "AAA",
					"labelColor": "#FFFFFF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 58,
					"y": 9,
					"w": 8,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 4,
					"y": 34,
					"w": 70,
					"h": 22,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 40,
					"w": 6,
					"h": 8,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 38,
					"w": 52,
					"h": 12,
					"fill": "#C9852E",
					"radius": 6,
					"label": "AAA",
					"labelColor": "#FFFFFF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 4,
					"y": 64,
					"w": 70,
					"h": 22,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 68,
					"w": 52,
					"h": 12,
					"fill": "#C9852E",
					"radius": 6,
					"label": "AAA",
					"labelColor": "#FFFFFF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 58,
					"y": 69,
					"w": 8,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 72,
					"y": 38.5,
					"w": 28,
					"h": 3,
					"fill": "#D8413A",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 72,
					"y": 58.5,
					"w": 28,
					"h": 3,
					"fill": "#1B1B1B",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/battery-holder-4xaa.json": {
		format: "circuitoon-module/1",
		id: "battery-holder-4xaa",
		version: 1,
		name: "4 x AA holder",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "right",
				"type": "power_out",
				"supply": "6V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "-",
				"side": "right",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 6
			} }
		},
		art: {
			"w": 100,
			"h": 130,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 9,
					"w": 52,
					"h": 16,
					"fill": "#C9852E",
					"radius": 8,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 58,
					"y": 10,
					"w": 8,
					"h": 14,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 4,
					"y": 34,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 43,
					"w": 6,
					"h": 10,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 39,
					"w": 52,
					"h": 16,
					"fill": "#C9852E",
					"radius": 8,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 4,
					"y": 64,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 69,
					"w": 52,
					"h": 16,
					"fill": "#C9852E",
					"radius": 8,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 58,
					"y": 70,
					"w": 8,
					"h": 14,
					"fill": "#D5DAE1",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 4,
					"y": 94,
					"w": 70,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 6,
					"y": 103,
					"w": 6,
					"h": 10,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 99,
					"w": 52,
					"h": 16,
					"fill": "#C9852E",
					"radius": 8,
					"label": "AA",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 72,
					"y": 58.5,
					"w": 28,
					"h": 3,
					"fill": "#D8413A",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 72,
					"y": 78.5,
					"w": 28,
					"h": 3,
					"fill": "#1B1B1B",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/battery-holder-cr2032.json": {
		format: "circuitoon-module/1",
		id: "battery-holder-cr2032",
		version: 1,
		name: "CR2032 holder",
		category: "Batteries",
		pins: [
			{
				"name": "+",
				"side": "right",
				"type": "power_out",
				"supply": "3V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "-",
				"side": "right",
				"type": "ground"
			}
		],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 3
			} }
		},
		art: {
			"w": 80,
			"h": 60,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 52,
					"h": 52,
					"fill": "#2B2F36",
					"radius": 26
				},
				{
					"type": "rect",
					"x": 10,
					"y": 10,
					"w": 40,
					"h": 40,
					"fill": "#C9CED6",
					"radius": 20
				},
				{
					"type": "rect",
					"x": 16,
					"y": 16,
					"w": 28,
					"h": 28,
					"fill": "#9AA0AC",
					"radius": 14,
					"label": "CR2032",
					"labelColor": "#20242B",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 54,
					"y": 27,
					"w": 10,
					"h": 6,
					"fill": "#B8BEC7",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 60,
					"y": 18.5,
					"w": 20,
					"h": 3,
					"fill": "#D8413A",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 60,
					"y": 38.5,
					"w": 20,
					"h": 3,
					"fill": "#1B1B1B",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/battery-lr44.json": {
		format: "circuitoon-module/1",
		id: "battery-lr44",
		version: 1,
		name: "LR44 button cell",
		category: "Batteries",
		pins: [{
			"name": "-",
			"side": "left",
			"type": "ground"
		}, {
			"name": "+",
			"side": "right",
			"type": "power_out",
			"supply": "1.5V"
		}],
		electrical: {
			"model": "voltage_source",
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": { "voltage": {
				"unit": "V",
				"default": 1.5
			} }
		},
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 8,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 32,
					"y": 18.5,
					"w": 8,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 11,
					"w": 20,
					"h": 18,
					"fill": "#D5DAE1",
					"radius": 9
				},
				{
					"type": "rect",
					"x": 13,
					"y": 14,
					"w": 14,
					"h": 12,
					"fill": "#9AA0AC",
					"radius": 6,
					"label": "LR44",
					"labelColor": "#20242B",
					"labelSize": 5
				}
			]
		}
	},
	"../modules/bme280-module-4pin.json": {
		format: "circuitoon-module/1",
		id: "bme280-module-4pin",
		version: 1,
		name: "BME280 sensor module (4-pin, I2C: VIN GND SCL SDA)",
		category: "Sensors",
		source: "https://lastminuteengineers.com/bme280-arduino-tutorial/ https://www.makerguides.com/how-to-interface-bme280-pressure-sensor-with-arduino/",
		pins: [
			{
				"name": "VIN",
				"side": "bottom",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"name": "SCL",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "bottom",
				"type": "io"
			}
		],
		size: {
			"w": 7,
			"h": 8
		},
		electrical: {
			"model": "sensor",
			"params": {}
		},
		art: {
			"w": 70,
			"h": 80,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 70,
					"h": 80,
					"fill": "#7B3FA0",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 6,
					"y": 5,
					"w": 16,
					"h": 16,
					"fill": "#E0B43C",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 10,
					"y": 9,
					"w": 8,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 7,
					"w": 16,
					"h": 16,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 49,
					"y": 12,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 12,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 15,
					"y": 70,
					"w": 40,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/bme280-module-6pin.json": {
		format: "circuitoon-module/1",
		id: "bme280-module-6pin",
		version: 1,
		name: "BME280 sensor module (GY-BME280, 6-pin, 3.3 V: VCC GND SCL SDA CSB SDO)",
		category: "Sensors",
		source: "https://shillehtek.com/blogs/shillehtek-product-manuals/bme280-environmental-sensor-raspberry-pi-arduino-esp32-i2c-humidity-pressure-and-temperature-measurement https://protosupplies.com/product/gy-bme280-pressure-humidity-temperature-sensor-module/",
		pins: [
			{
				"name": "VCC",
				"side": "bottom",
				"type": "power_in",
				"supply": "3V3"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"name": "SCL",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "CSB",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "SDO",
				"side": "bottom",
				"type": "io"
			}
		],
		size: {
			"w": 9,
			"h": 8
		},
		electrical: {
			"model": "sensor",
			"params": {}
		},
		art: {
			"w": 90,
			"h": 80,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 90,
					"h": 80,
					"fill": "#7B3FA0",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 5,
					"y": 5,
					"w": 16,
					"h": 16,
					"fill": "#E0B43C",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 9,
					"y": 9,
					"w": 8,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 69,
					"y": 5,
					"w": 16,
					"h": 16,
					"fill": "#E0B43C",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 73,
					"y": 9,
					"w": 8,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38,
					"y": 8,
					"w": 14,
					"h": 14,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 26,
					"w": 5,
					"h": 8,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 26,
					"w": 5,
					"h": 8,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 26,
					"w": 5,
					"h": 8,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 64,
					"y": 26,
					"w": 5,
					"h": 8,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 15,
					"y": 70,
					"w": 60,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 72.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/breadboard-full.json": {
		format: "circuitoon-module/1",
		id: "breadboard-full",
		version: 1,
		name: "Full breadboard (830)",
		category: "Prototyping",
		pins: [],
		holes: [
			{
				"name": "top+",
				"label": "+ rail (top)",
				"at": [
					[50, 20],
					[60, 20],
					[70, 20],
					[80, 20],
					[90, 20],
					[110, 20],
					[120, 20],
					[130, 20],
					[140, 20],
					[150, 20],
					[170, 20],
					[180, 20],
					[190, 20],
					[200, 20],
					[210, 20],
					[230, 20],
					[240, 20],
					[250, 20],
					[260, 20],
					[270, 20],
					[290, 20],
					[300, 20],
					[310, 20],
					[320, 20],
					[330, 20],
					[350, 20],
					[360, 20],
					[370, 20],
					[380, 20],
					[390, 20],
					[410, 20],
					[420, 20],
					[430, 20],
					[440, 20],
					[450, 20],
					[470, 20],
					[480, 20],
					[490, 20],
					[500, 20],
					[510, 20],
					[530, 20],
					[540, 20],
					[550, 20],
					[560, 20],
					[570, 20],
					[590, 20],
					[600, 20],
					[610, 20],
					[620, 20],
					[630, 20]
				],
				"rail": "+"
			},
			{
				"name": "top-",
				"label": "- rail (top)",
				"at": [
					[50, 30],
					[60, 30],
					[70, 30],
					[80, 30],
					[90, 30],
					[110, 30],
					[120, 30],
					[130, 30],
					[140, 30],
					[150, 30],
					[170, 30],
					[180, 30],
					[190, 30],
					[200, 30],
					[210, 30],
					[230, 30],
					[240, 30],
					[250, 30],
					[260, 30],
					[270, 30],
					[290, 30],
					[300, 30],
					[310, 30],
					[320, 30],
					[330, 30],
					[350, 30],
					[360, 30],
					[370, 30],
					[380, 30],
					[390, 30],
					[410, 30],
					[420, 30],
					[430, 30],
					[440, 30],
					[450, 30],
					[470, 30],
					[480, 30],
					[490, 30],
					[500, 30],
					[510, 30],
					[530, 30],
					[540, 30],
					[550, 30],
					[560, 30],
					[570, 30],
					[590, 30],
					[600, 30],
					[610, 30],
					[620, 30],
					[630, 30]
				],
				"rail": "-"
			},
			{
				"name": "c1-top",
				"label": "1 a-e",
				"at": [
					[30, 60],
					[30, 70],
					[30, 80],
					[30, 90],
					[30, 100]
				]
			},
			{
				"name": "c1-bot",
				"label": "1 f-j",
				"at": [
					[30, 130],
					[30, 140],
					[30, 150],
					[30, 160],
					[30, 170]
				]
			},
			{
				"name": "c2-top",
				"label": "2 a-e",
				"at": [
					[40, 60],
					[40, 70],
					[40, 80],
					[40, 90],
					[40, 100]
				]
			},
			{
				"name": "c2-bot",
				"label": "2 f-j",
				"at": [
					[40, 130],
					[40, 140],
					[40, 150],
					[40, 160],
					[40, 170]
				]
			},
			{
				"name": "c3-top",
				"label": "3 a-e",
				"at": [
					[50, 60],
					[50, 70],
					[50, 80],
					[50, 90],
					[50, 100]
				]
			},
			{
				"name": "c3-bot",
				"label": "3 f-j",
				"at": [
					[50, 130],
					[50, 140],
					[50, 150],
					[50, 160],
					[50, 170]
				]
			},
			{
				"name": "c4-top",
				"label": "4 a-e",
				"at": [
					[60, 60],
					[60, 70],
					[60, 80],
					[60, 90],
					[60, 100]
				]
			},
			{
				"name": "c4-bot",
				"label": "4 f-j",
				"at": [
					[60, 130],
					[60, 140],
					[60, 150],
					[60, 160],
					[60, 170]
				]
			},
			{
				"name": "c5-top",
				"label": "5 a-e",
				"at": [
					[70, 60],
					[70, 70],
					[70, 80],
					[70, 90],
					[70, 100]
				]
			},
			{
				"name": "c5-bot",
				"label": "5 f-j",
				"at": [
					[70, 130],
					[70, 140],
					[70, 150],
					[70, 160],
					[70, 170]
				]
			},
			{
				"name": "c6-top",
				"label": "6 a-e",
				"at": [
					[80, 60],
					[80, 70],
					[80, 80],
					[80, 90],
					[80, 100]
				]
			},
			{
				"name": "c6-bot",
				"label": "6 f-j",
				"at": [
					[80, 130],
					[80, 140],
					[80, 150],
					[80, 160],
					[80, 170]
				]
			},
			{
				"name": "c7-top",
				"label": "7 a-e",
				"at": [
					[90, 60],
					[90, 70],
					[90, 80],
					[90, 90],
					[90, 100]
				]
			},
			{
				"name": "c7-bot",
				"label": "7 f-j",
				"at": [
					[90, 130],
					[90, 140],
					[90, 150],
					[90, 160],
					[90, 170]
				]
			},
			{
				"name": "c8-top",
				"label": "8 a-e",
				"at": [
					[100, 60],
					[100, 70],
					[100, 80],
					[100, 90],
					[100, 100]
				]
			},
			{
				"name": "c8-bot",
				"label": "8 f-j",
				"at": [
					[100, 130],
					[100, 140],
					[100, 150],
					[100, 160],
					[100, 170]
				]
			},
			{
				"name": "c9-top",
				"label": "9 a-e",
				"at": [
					[110, 60],
					[110, 70],
					[110, 80],
					[110, 90],
					[110, 100]
				]
			},
			{
				"name": "c9-bot",
				"label": "9 f-j",
				"at": [
					[110, 130],
					[110, 140],
					[110, 150],
					[110, 160],
					[110, 170]
				]
			},
			{
				"name": "c10-top",
				"label": "10 a-e",
				"at": [
					[120, 60],
					[120, 70],
					[120, 80],
					[120, 90],
					[120, 100]
				]
			},
			{
				"name": "c10-bot",
				"label": "10 f-j",
				"at": [
					[120, 130],
					[120, 140],
					[120, 150],
					[120, 160],
					[120, 170]
				]
			},
			{
				"name": "c11-top",
				"label": "11 a-e",
				"at": [
					[130, 60],
					[130, 70],
					[130, 80],
					[130, 90],
					[130, 100]
				]
			},
			{
				"name": "c11-bot",
				"label": "11 f-j",
				"at": [
					[130, 130],
					[130, 140],
					[130, 150],
					[130, 160],
					[130, 170]
				]
			},
			{
				"name": "c12-top",
				"label": "12 a-e",
				"at": [
					[140, 60],
					[140, 70],
					[140, 80],
					[140, 90],
					[140, 100]
				]
			},
			{
				"name": "c12-bot",
				"label": "12 f-j",
				"at": [
					[140, 130],
					[140, 140],
					[140, 150],
					[140, 160],
					[140, 170]
				]
			},
			{
				"name": "c13-top",
				"label": "13 a-e",
				"at": [
					[150, 60],
					[150, 70],
					[150, 80],
					[150, 90],
					[150, 100]
				]
			},
			{
				"name": "c13-bot",
				"label": "13 f-j",
				"at": [
					[150, 130],
					[150, 140],
					[150, 150],
					[150, 160],
					[150, 170]
				]
			},
			{
				"name": "c14-top",
				"label": "14 a-e",
				"at": [
					[160, 60],
					[160, 70],
					[160, 80],
					[160, 90],
					[160, 100]
				]
			},
			{
				"name": "c14-bot",
				"label": "14 f-j",
				"at": [
					[160, 130],
					[160, 140],
					[160, 150],
					[160, 160],
					[160, 170]
				]
			},
			{
				"name": "c15-top",
				"label": "15 a-e",
				"at": [
					[170, 60],
					[170, 70],
					[170, 80],
					[170, 90],
					[170, 100]
				]
			},
			{
				"name": "c15-bot",
				"label": "15 f-j",
				"at": [
					[170, 130],
					[170, 140],
					[170, 150],
					[170, 160],
					[170, 170]
				]
			},
			{
				"name": "c16-top",
				"label": "16 a-e",
				"at": [
					[180, 60],
					[180, 70],
					[180, 80],
					[180, 90],
					[180, 100]
				]
			},
			{
				"name": "c16-bot",
				"label": "16 f-j",
				"at": [
					[180, 130],
					[180, 140],
					[180, 150],
					[180, 160],
					[180, 170]
				]
			},
			{
				"name": "c17-top",
				"label": "17 a-e",
				"at": [
					[190, 60],
					[190, 70],
					[190, 80],
					[190, 90],
					[190, 100]
				]
			},
			{
				"name": "c17-bot",
				"label": "17 f-j",
				"at": [
					[190, 130],
					[190, 140],
					[190, 150],
					[190, 160],
					[190, 170]
				]
			},
			{
				"name": "c18-top",
				"label": "18 a-e",
				"at": [
					[200, 60],
					[200, 70],
					[200, 80],
					[200, 90],
					[200, 100]
				]
			},
			{
				"name": "c18-bot",
				"label": "18 f-j",
				"at": [
					[200, 130],
					[200, 140],
					[200, 150],
					[200, 160],
					[200, 170]
				]
			},
			{
				"name": "c19-top",
				"label": "19 a-e",
				"at": [
					[210, 60],
					[210, 70],
					[210, 80],
					[210, 90],
					[210, 100]
				]
			},
			{
				"name": "c19-bot",
				"label": "19 f-j",
				"at": [
					[210, 130],
					[210, 140],
					[210, 150],
					[210, 160],
					[210, 170]
				]
			},
			{
				"name": "c20-top",
				"label": "20 a-e",
				"at": [
					[220, 60],
					[220, 70],
					[220, 80],
					[220, 90],
					[220, 100]
				]
			},
			{
				"name": "c20-bot",
				"label": "20 f-j",
				"at": [
					[220, 130],
					[220, 140],
					[220, 150],
					[220, 160],
					[220, 170]
				]
			},
			{
				"name": "c21-top",
				"label": "21 a-e",
				"at": [
					[230, 60],
					[230, 70],
					[230, 80],
					[230, 90],
					[230, 100]
				]
			},
			{
				"name": "c21-bot",
				"label": "21 f-j",
				"at": [
					[230, 130],
					[230, 140],
					[230, 150],
					[230, 160],
					[230, 170]
				]
			},
			{
				"name": "c22-top",
				"label": "22 a-e",
				"at": [
					[240, 60],
					[240, 70],
					[240, 80],
					[240, 90],
					[240, 100]
				]
			},
			{
				"name": "c22-bot",
				"label": "22 f-j",
				"at": [
					[240, 130],
					[240, 140],
					[240, 150],
					[240, 160],
					[240, 170]
				]
			},
			{
				"name": "c23-top",
				"label": "23 a-e",
				"at": [
					[250, 60],
					[250, 70],
					[250, 80],
					[250, 90],
					[250, 100]
				]
			},
			{
				"name": "c23-bot",
				"label": "23 f-j",
				"at": [
					[250, 130],
					[250, 140],
					[250, 150],
					[250, 160],
					[250, 170]
				]
			},
			{
				"name": "c24-top",
				"label": "24 a-e",
				"at": [
					[260, 60],
					[260, 70],
					[260, 80],
					[260, 90],
					[260, 100]
				]
			},
			{
				"name": "c24-bot",
				"label": "24 f-j",
				"at": [
					[260, 130],
					[260, 140],
					[260, 150],
					[260, 160],
					[260, 170]
				]
			},
			{
				"name": "c25-top",
				"label": "25 a-e",
				"at": [
					[270, 60],
					[270, 70],
					[270, 80],
					[270, 90],
					[270, 100]
				]
			},
			{
				"name": "c25-bot",
				"label": "25 f-j",
				"at": [
					[270, 130],
					[270, 140],
					[270, 150],
					[270, 160],
					[270, 170]
				]
			},
			{
				"name": "c26-top",
				"label": "26 a-e",
				"at": [
					[280, 60],
					[280, 70],
					[280, 80],
					[280, 90],
					[280, 100]
				]
			},
			{
				"name": "c26-bot",
				"label": "26 f-j",
				"at": [
					[280, 130],
					[280, 140],
					[280, 150],
					[280, 160],
					[280, 170]
				]
			},
			{
				"name": "c27-top",
				"label": "27 a-e",
				"at": [
					[290, 60],
					[290, 70],
					[290, 80],
					[290, 90],
					[290, 100]
				]
			},
			{
				"name": "c27-bot",
				"label": "27 f-j",
				"at": [
					[290, 130],
					[290, 140],
					[290, 150],
					[290, 160],
					[290, 170]
				]
			},
			{
				"name": "c28-top",
				"label": "28 a-e",
				"at": [
					[300, 60],
					[300, 70],
					[300, 80],
					[300, 90],
					[300, 100]
				]
			},
			{
				"name": "c28-bot",
				"label": "28 f-j",
				"at": [
					[300, 130],
					[300, 140],
					[300, 150],
					[300, 160],
					[300, 170]
				]
			},
			{
				"name": "c29-top",
				"label": "29 a-e",
				"at": [
					[310, 60],
					[310, 70],
					[310, 80],
					[310, 90],
					[310, 100]
				]
			},
			{
				"name": "c29-bot",
				"label": "29 f-j",
				"at": [
					[310, 130],
					[310, 140],
					[310, 150],
					[310, 160],
					[310, 170]
				]
			},
			{
				"name": "c30-top",
				"label": "30 a-e",
				"at": [
					[320, 60],
					[320, 70],
					[320, 80],
					[320, 90],
					[320, 100]
				]
			},
			{
				"name": "c30-bot",
				"label": "30 f-j",
				"at": [
					[320, 130],
					[320, 140],
					[320, 150],
					[320, 160],
					[320, 170]
				]
			},
			{
				"name": "c31-top",
				"label": "31 a-e",
				"at": [
					[330, 60],
					[330, 70],
					[330, 80],
					[330, 90],
					[330, 100]
				]
			},
			{
				"name": "c31-bot",
				"label": "31 f-j",
				"at": [
					[330, 130],
					[330, 140],
					[330, 150],
					[330, 160],
					[330, 170]
				]
			},
			{
				"name": "c32-top",
				"label": "32 a-e",
				"at": [
					[340, 60],
					[340, 70],
					[340, 80],
					[340, 90],
					[340, 100]
				]
			},
			{
				"name": "c32-bot",
				"label": "32 f-j",
				"at": [
					[340, 130],
					[340, 140],
					[340, 150],
					[340, 160],
					[340, 170]
				]
			},
			{
				"name": "c33-top",
				"label": "33 a-e",
				"at": [
					[350, 60],
					[350, 70],
					[350, 80],
					[350, 90],
					[350, 100]
				]
			},
			{
				"name": "c33-bot",
				"label": "33 f-j",
				"at": [
					[350, 130],
					[350, 140],
					[350, 150],
					[350, 160],
					[350, 170]
				]
			},
			{
				"name": "c34-top",
				"label": "34 a-e",
				"at": [
					[360, 60],
					[360, 70],
					[360, 80],
					[360, 90],
					[360, 100]
				]
			},
			{
				"name": "c34-bot",
				"label": "34 f-j",
				"at": [
					[360, 130],
					[360, 140],
					[360, 150],
					[360, 160],
					[360, 170]
				]
			},
			{
				"name": "c35-top",
				"label": "35 a-e",
				"at": [
					[370, 60],
					[370, 70],
					[370, 80],
					[370, 90],
					[370, 100]
				]
			},
			{
				"name": "c35-bot",
				"label": "35 f-j",
				"at": [
					[370, 130],
					[370, 140],
					[370, 150],
					[370, 160],
					[370, 170]
				]
			},
			{
				"name": "c36-top",
				"label": "36 a-e",
				"at": [
					[380, 60],
					[380, 70],
					[380, 80],
					[380, 90],
					[380, 100]
				]
			},
			{
				"name": "c36-bot",
				"label": "36 f-j",
				"at": [
					[380, 130],
					[380, 140],
					[380, 150],
					[380, 160],
					[380, 170]
				]
			},
			{
				"name": "c37-top",
				"label": "37 a-e",
				"at": [
					[390, 60],
					[390, 70],
					[390, 80],
					[390, 90],
					[390, 100]
				]
			},
			{
				"name": "c37-bot",
				"label": "37 f-j",
				"at": [
					[390, 130],
					[390, 140],
					[390, 150],
					[390, 160],
					[390, 170]
				]
			},
			{
				"name": "c38-top",
				"label": "38 a-e",
				"at": [
					[400, 60],
					[400, 70],
					[400, 80],
					[400, 90],
					[400, 100]
				]
			},
			{
				"name": "c38-bot",
				"label": "38 f-j",
				"at": [
					[400, 130],
					[400, 140],
					[400, 150],
					[400, 160],
					[400, 170]
				]
			},
			{
				"name": "c39-top",
				"label": "39 a-e",
				"at": [
					[410, 60],
					[410, 70],
					[410, 80],
					[410, 90],
					[410, 100]
				]
			},
			{
				"name": "c39-bot",
				"label": "39 f-j",
				"at": [
					[410, 130],
					[410, 140],
					[410, 150],
					[410, 160],
					[410, 170]
				]
			},
			{
				"name": "c40-top",
				"label": "40 a-e",
				"at": [
					[420, 60],
					[420, 70],
					[420, 80],
					[420, 90],
					[420, 100]
				]
			},
			{
				"name": "c40-bot",
				"label": "40 f-j",
				"at": [
					[420, 130],
					[420, 140],
					[420, 150],
					[420, 160],
					[420, 170]
				]
			},
			{
				"name": "c41-top",
				"label": "41 a-e",
				"at": [
					[430, 60],
					[430, 70],
					[430, 80],
					[430, 90],
					[430, 100]
				]
			},
			{
				"name": "c41-bot",
				"label": "41 f-j",
				"at": [
					[430, 130],
					[430, 140],
					[430, 150],
					[430, 160],
					[430, 170]
				]
			},
			{
				"name": "c42-top",
				"label": "42 a-e",
				"at": [
					[440, 60],
					[440, 70],
					[440, 80],
					[440, 90],
					[440, 100]
				]
			},
			{
				"name": "c42-bot",
				"label": "42 f-j",
				"at": [
					[440, 130],
					[440, 140],
					[440, 150],
					[440, 160],
					[440, 170]
				]
			},
			{
				"name": "c43-top",
				"label": "43 a-e",
				"at": [
					[450, 60],
					[450, 70],
					[450, 80],
					[450, 90],
					[450, 100]
				]
			},
			{
				"name": "c43-bot",
				"label": "43 f-j",
				"at": [
					[450, 130],
					[450, 140],
					[450, 150],
					[450, 160],
					[450, 170]
				]
			},
			{
				"name": "c44-top",
				"label": "44 a-e",
				"at": [
					[460, 60],
					[460, 70],
					[460, 80],
					[460, 90],
					[460, 100]
				]
			},
			{
				"name": "c44-bot",
				"label": "44 f-j",
				"at": [
					[460, 130],
					[460, 140],
					[460, 150],
					[460, 160],
					[460, 170]
				]
			},
			{
				"name": "c45-top",
				"label": "45 a-e",
				"at": [
					[470, 60],
					[470, 70],
					[470, 80],
					[470, 90],
					[470, 100]
				]
			},
			{
				"name": "c45-bot",
				"label": "45 f-j",
				"at": [
					[470, 130],
					[470, 140],
					[470, 150],
					[470, 160],
					[470, 170]
				]
			},
			{
				"name": "c46-top",
				"label": "46 a-e",
				"at": [
					[480, 60],
					[480, 70],
					[480, 80],
					[480, 90],
					[480, 100]
				]
			},
			{
				"name": "c46-bot",
				"label": "46 f-j",
				"at": [
					[480, 130],
					[480, 140],
					[480, 150],
					[480, 160],
					[480, 170]
				]
			},
			{
				"name": "c47-top",
				"label": "47 a-e",
				"at": [
					[490, 60],
					[490, 70],
					[490, 80],
					[490, 90],
					[490, 100]
				]
			},
			{
				"name": "c47-bot",
				"label": "47 f-j",
				"at": [
					[490, 130],
					[490, 140],
					[490, 150],
					[490, 160],
					[490, 170]
				]
			},
			{
				"name": "c48-top",
				"label": "48 a-e",
				"at": [
					[500, 60],
					[500, 70],
					[500, 80],
					[500, 90],
					[500, 100]
				]
			},
			{
				"name": "c48-bot",
				"label": "48 f-j",
				"at": [
					[500, 130],
					[500, 140],
					[500, 150],
					[500, 160],
					[500, 170]
				]
			},
			{
				"name": "c49-top",
				"label": "49 a-e",
				"at": [
					[510, 60],
					[510, 70],
					[510, 80],
					[510, 90],
					[510, 100]
				]
			},
			{
				"name": "c49-bot",
				"label": "49 f-j",
				"at": [
					[510, 130],
					[510, 140],
					[510, 150],
					[510, 160],
					[510, 170]
				]
			},
			{
				"name": "c50-top",
				"label": "50 a-e",
				"at": [
					[520, 60],
					[520, 70],
					[520, 80],
					[520, 90],
					[520, 100]
				]
			},
			{
				"name": "c50-bot",
				"label": "50 f-j",
				"at": [
					[520, 130],
					[520, 140],
					[520, 150],
					[520, 160],
					[520, 170]
				]
			},
			{
				"name": "c51-top",
				"label": "51 a-e",
				"at": [
					[530, 60],
					[530, 70],
					[530, 80],
					[530, 90],
					[530, 100]
				]
			},
			{
				"name": "c51-bot",
				"label": "51 f-j",
				"at": [
					[530, 130],
					[530, 140],
					[530, 150],
					[530, 160],
					[530, 170]
				]
			},
			{
				"name": "c52-top",
				"label": "52 a-e",
				"at": [
					[540, 60],
					[540, 70],
					[540, 80],
					[540, 90],
					[540, 100]
				]
			},
			{
				"name": "c52-bot",
				"label": "52 f-j",
				"at": [
					[540, 130],
					[540, 140],
					[540, 150],
					[540, 160],
					[540, 170]
				]
			},
			{
				"name": "c53-top",
				"label": "53 a-e",
				"at": [
					[550, 60],
					[550, 70],
					[550, 80],
					[550, 90],
					[550, 100]
				]
			},
			{
				"name": "c53-bot",
				"label": "53 f-j",
				"at": [
					[550, 130],
					[550, 140],
					[550, 150],
					[550, 160],
					[550, 170]
				]
			},
			{
				"name": "c54-top",
				"label": "54 a-e",
				"at": [
					[560, 60],
					[560, 70],
					[560, 80],
					[560, 90],
					[560, 100]
				]
			},
			{
				"name": "c54-bot",
				"label": "54 f-j",
				"at": [
					[560, 130],
					[560, 140],
					[560, 150],
					[560, 160],
					[560, 170]
				]
			},
			{
				"name": "c55-top",
				"label": "55 a-e",
				"at": [
					[570, 60],
					[570, 70],
					[570, 80],
					[570, 90],
					[570, 100]
				]
			},
			{
				"name": "c55-bot",
				"label": "55 f-j",
				"at": [
					[570, 130],
					[570, 140],
					[570, 150],
					[570, 160],
					[570, 170]
				]
			},
			{
				"name": "c56-top",
				"label": "56 a-e",
				"at": [
					[580, 60],
					[580, 70],
					[580, 80],
					[580, 90],
					[580, 100]
				]
			},
			{
				"name": "c56-bot",
				"label": "56 f-j",
				"at": [
					[580, 130],
					[580, 140],
					[580, 150],
					[580, 160],
					[580, 170]
				]
			},
			{
				"name": "c57-top",
				"label": "57 a-e",
				"at": [
					[590, 60],
					[590, 70],
					[590, 80],
					[590, 90],
					[590, 100]
				]
			},
			{
				"name": "c57-bot",
				"label": "57 f-j",
				"at": [
					[590, 130],
					[590, 140],
					[590, 150],
					[590, 160],
					[590, 170]
				]
			},
			{
				"name": "c58-top",
				"label": "58 a-e",
				"at": [
					[600, 60],
					[600, 70],
					[600, 80],
					[600, 90],
					[600, 100]
				]
			},
			{
				"name": "c58-bot",
				"label": "58 f-j",
				"at": [
					[600, 130],
					[600, 140],
					[600, 150],
					[600, 160],
					[600, 170]
				]
			},
			{
				"name": "c59-top",
				"label": "59 a-e",
				"at": [
					[610, 60],
					[610, 70],
					[610, 80],
					[610, 90],
					[610, 100]
				]
			},
			{
				"name": "c59-bot",
				"label": "59 f-j",
				"at": [
					[610, 130],
					[610, 140],
					[610, 150],
					[610, 160],
					[610, 170]
				]
			},
			{
				"name": "c60-top",
				"label": "60 a-e",
				"at": [
					[620, 60],
					[620, 70],
					[620, 80],
					[620, 90],
					[620, 100]
				]
			},
			{
				"name": "c60-bot",
				"label": "60 f-j",
				"at": [
					[620, 130],
					[620, 140],
					[620, 150],
					[620, 160],
					[620, 170]
				]
			},
			{
				"name": "c61-top",
				"label": "61 a-e",
				"at": [
					[630, 60],
					[630, 70],
					[630, 80],
					[630, 90],
					[630, 100]
				]
			},
			{
				"name": "c61-bot",
				"label": "61 f-j",
				"at": [
					[630, 130],
					[630, 140],
					[630, 150],
					[630, 160],
					[630, 170]
				]
			},
			{
				"name": "c62-top",
				"label": "62 a-e",
				"at": [
					[640, 60],
					[640, 70],
					[640, 80],
					[640, 90],
					[640, 100]
				]
			},
			{
				"name": "c62-bot",
				"label": "62 f-j",
				"at": [
					[640, 130],
					[640, 140],
					[640, 150],
					[640, 160],
					[640, 170]
				]
			},
			{
				"name": "c63-top",
				"label": "63 a-e",
				"at": [
					[650, 60],
					[650, 70],
					[650, 80],
					[650, 90],
					[650, 100]
				]
			},
			{
				"name": "c63-bot",
				"label": "63 f-j",
				"at": [
					[650, 130],
					[650, 140],
					[650, 150],
					[650, 160],
					[650, 170]
				]
			},
			{
				"name": "bottom-",
				"label": "- rail (bottom)",
				"at": [
					[50, 200],
					[60, 200],
					[70, 200],
					[80, 200],
					[90, 200],
					[110, 200],
					[120, 200],
					[130, 200],
					[140, 200],
					[150, 200],
					[170, 200],
					[180, 200],
					[190, 200],
					[200, 200],
					[210, 200],
					[230, 200],
					[240, 200],
					[250, 200],
					[260, 200],
					[270, 200],
					[290, 200],
					[300, 200],
					[310, 200],
					[320, 200],
					[330, 200],
					[350, 200],
					[360, 200],
					[370, 200],
					[380, 200],
					[390, 200],
					[410, 200],
					[420, 200],
					[430, 200],
					[440, 200],
					[450, 200],
					[470, 200],
					[480, 200],
					[490, 200],
					[500, 200],
					[510, 200],
					[530, 200],
					[540, 200],
					[550, 200],
					[560, 200],
					[570, 200],
					[590, 200],
					[600, 200],
					[610, 200],
					[620, 200],
					[630, 200]
				],
				"rail": "-"
			},
			{
				"name": "bottom+",
				"label": "+ rail (bottom)",
				"at": [
					[50, 210],
					[60, 210],
					[70, 210],
					[80, 210],
					[90, 210],
					[110, 210],
					[120, 210],
					[130, 210],
					[140, 210],
					[150, 210],
					[170, 210],
					[180, 210],
					[190, 210],
					[200, 210],
					[210, 210],
					[230, 210],
					[240, 210],
					[250, 210],
					[260, 210],
					[270, 210],
					[290, 210],
					[300, 210],
					[310, 210],
					[320, 210],
					[330, 210],
					[350, 210],
					[360, 210],
					[370, 210],
					[380, 210],
					[390, 210],
					[410, 210],
					[420, 210],
					[430, 210],
					[440, 210],
					[450, 210],
					[470, 210],
					[480, 210],
					[490, 210],
					[500, 210],
					[510, 210],
					[530, 210],
					[540, 210],
					[550, 210],
					[560, 210],
					[570, 210],
					[590, 210],
					[600, 210],
					[610, 210],
					[620, 210],
					[630, 210]
				],
				"rail": "+"
			}
		],
		obstacle: false,
		size: {
			"w": 68,
			"h": 23
		},
		art: {
			"w": 680,
			"h": 230,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 680,
					"h": 230,
					"fill": "#FFFFFF",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 10,
					"y": 109,
					"w": 660,
					"h": 12,
					"fill": "#E4E7EC",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 11,
					"w": 592,
					"h": 2,
					"fill": "#E0483E",
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 37,
					"w": 592,
					"h": 2,
					"fill": "#3D6FD6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 191,
					"w": 592,
					"h": 2,
					"fill": "#3D6FD6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 217,
					"w": 592,
					"h": 2,
					"fill": "#E0483E",
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 16,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "+",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 30,
					"y": 26,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "-",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 30,
					"y": 196,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "-",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 30,
					"y": 206,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "+",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 24,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 64,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 114,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "10",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 164,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "15",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 214,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "20",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 264,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "25",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 314,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "30",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 364,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "35",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 414,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "40",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 464,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "45",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 514,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "50",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 564,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "55",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 614,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "60",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 24,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 64,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 114,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "10",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 164,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "15",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 214,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "20",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 264,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "25",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 314,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "30",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 364,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "35",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 414,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "40",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 464,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "45",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 514,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "50",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 564,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "55",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 614,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "60",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 56,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "a",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 56,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "a",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 66,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "b",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 66,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "b",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 76,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "c",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 76,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "c",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 86,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "d",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 86,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "d",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 96,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "e",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 96,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "e",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 126,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "f",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 126,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "f",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 136,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "g",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 136,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "g",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 146,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "h",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 146,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "h",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 156,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "i",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 156,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "i",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 166,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "j",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 659,
					"y": 166,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "j",
					"labelColor": "#8A929C",
					"labelSize": 6
				}
			]
		}
	},
	"../modules/breadboard-half.json": {
		format: "circuitoon-module/1",
		id: "breadboard-half",
		version: 1,
		name: "Half breadboard (400)",
		category: "Prototyping",
		pins: [],
		holes: [
			{
				"name": "top+",
				"label": "+ rail (top)",
				"at": [
					[30, 20],
					[40, 20],
					[50, 20],
					[60, 20],
					[70, 20],
					[90, 20],
					[100, 20],
					[110, 20],
					[120, 20],
					[130, 20],
					[150, 20],
					[160, 20],
					[170, 20],
					[180, 20],
					[190, 20],
					[210, 20],
					[220, 20],
					[230, 20],
					[240, 20],
					[250, 20],
					[270, 20],
					[280, 20],
					[290, 20],
					[300, 20],
					[310, 20]
				],
				"rail": "+"
			},
			{
				"name": "top-",
				"label": "- rail (top)",
				"at": [
					[30, 30],
					[40, 30],
					[50, 30],
					[60, 30],
					[70, 30],
					[90, 30],
					[100, 30],
					[110, 30],
					[120, 30],
					[130, 30],
					[150, 30],
					[160, 30],
					[170, 30],
					[180, 30],
					[190, 30],
					[210, 30],
					[220, 30],
					[230, 30],
					[240, 30],
					[250, 30],
					[270, 30],
					[280, 30],
					[290, 30],
					[300, 30],
					[310, 30]
				],
				"rail": "-"
			},
			{
				"name": "c1-top",
				"label": "1 a-e",
				"at": [
					[30, 60],
					[30, 70],
					[30, 80],
					[30, 90],
					[30, 100]
				]
			},
			{
				"name": "c1-bot",
				"label": "1 f-j",
				"at": [
					[30, 130],
					[30, 140],
					[30, 150],
					[30, 160],
					[30, 170]
				]
			},
			{
				"name": "c2-top",
				"label": "2 a-e",
				"at": [
					[40, 60],
					[40, 70],
					[40, 80],
					[40, 90],
					[40, 100]
				]
			},
			{
				"name": "c2-bot",
				"label": "2 f-j",
				"at": [
					[40, 130],
					[40, 140],
					[40, 150],
					[40, 160],
					[40, 170]
				]
			},
			{
				"name": "c3-top",
				"label": "3 a-e",
				"at": [
					[50, 60],
					[50, 70],
					[50, 80],
					[50, 90],
					[50, 100]
				]
			},
			{
				"name": "c3-bot",
				"label": "3 f-j",
				"at": [
					[50, 130],
					[50, 140],
					[50, 150],
					[50, 160],
					[50, 170]
				]
			},
			{
				"name": "c4-top",
				"label": "4 a-e",
				"at": [
					[60, 60],
					[60, 70],
					[60, 80],
					[60, 90],
					[60, 100]
				]
			},
			{
				"name": "c4-bot",
				"label": "4 f-j",
				"at": [
					[60, 130],
					[60, 140],
					[60, 150],
					[60, 160],
					[60, 170]
				]
			},
			{
				"name": "c5-top",
				"label": "5 a-e",
				"at": [
					[70, 60],
					[70, 70],
					[70, 80],
					[70, 90],
					[70, 100]
				]
			},
			{
				"name": "c5-bot",
				"label": "5 f-j",
				"at": [
					[70, 130],
					[70, 140],
					[70, 150],
					[70, 160],
					[70, 170]
				]
			},
			{
				"name": "c6-top",
				"label": "6 a-e",
				"at": [
					[80, 60],
					[80, 70],
					[80, 80],
					[80, 90],
					[80, 100]
				]
			},
			{
				"name": "c6-bot",
				"label": "6 f-j",
				"at": [
					[80, 130],
					[80, 140],
					[80, 150],
					[80, 160],
					[80, 170]
				]
			},
			{
				"name": "c7-top",
				"label": "7 a-e",
				"at": [
					[90, 60],
					[90, 70],
					[90, 80],
					[90, 90],
					[90, 100]
				]
			},
			{
				"name": "c7-bot",
				"label": "7 f-j",
				"at": [
					[90, 130],
					[90, 140],
					[90, 150],
					[90, 160],
					[90, 170]
				]
			},
			{
				"name": "c8-top",
				"label": "8 a-e",
				"at": [
					[100, 60],
					[100, 70],
					[100, 80],
					[100, 90],
					[100, 100]
				]
			},
			{
				"name": "c8-bot",
				"label": "8 f-j",
				"at": [
					[100, 130],
					[100, 140],
					[100, 150],
					[100, 160],
					[100, 170]
				]
			},
			{
				"name": "c9-top",
				"label": "9 a-e",
				"at": [
					[110, 60],
					[110, 70],
					[110, 80],
					[110, 90],
					[110, 100]
				]
			},
			{
				"name": "c9-bot",
				"label": "9 f-j",
				"at": [
					[110, 130],
					[110, 140],
					[110, 150],
					[110, 160],
					[110, 170]
				]
			},
			{
				"name": "c10-top",
				"label": "10 a-e",
				"at": [
					[120, 60],
					[120, 70],
					[120, 80],
					[120, 90],
					[120, 100]
				]
			},
			{
				"name": "c10-bot",
				"label": "10 f-j",
				"at": [
					[120, 130],
					[120, 140],
					[120, 150],
					[120, 160],
					[120, 170]
				]
			},
			{
				"name": "c11-top",
				"label": "11 a-e",
				"at": [
					[130, 60],
					[130, 70],
					[130, 80],
					[130, 90],
					[130, 100]
				]
			},
			{
				"name": "c11-bot",
				"label": "11 f-j",
				"at": [
					[130, 130],
					[130, 140],
					[130, 150],
					[130, 160],
					[130, 170]
				]
			},
			{
				"name": "c12-top",
				"label": "12 a-e",
				"at": [
					[140, 60],
					[140, 70],
					[140, 80],
					[140, 90],
					[140, 100]
				]
			},
			{
				"name": "c12-bot",
				"label": "12 f-j",
				"at": [
					[140, 130],
					[140, 140],
					[140, 150],
					[140, 160],
					[140, 170]
				]
			},
			{
				"name": "c13-top",
				"label": "13 a-e",
				"at": [
					[150, 60],
					[150, 70],
					[150, 80],
					[150, 90],
					[150, 100]
				]
			},
			{
				"name": "c13-bot",
				"label": "13 f-j",
				"at": [
					[150, 130],
					[150, 140],
					[150, 150],
					[150, 160],
					[150, 170]
				]
			},
			{
				"name": "c14-top",
				"label": "14 a-e",
				"at": [
					[160, 60],
					[160, 70],
					[160, 80],
					[160, 90],
					[160, 100]
				]
			},
			{
				"name": "c14-bot",
				"label": "14 f-j",
				"at": [
					[160, 130],
					[160, 140],
					[160, 150],
					[160, 160],
					[160, 170]
				]
			},
			{
				"name": "c15-top",
				"label": "15 a-e",
				"at": [
					[170, 60],
					[170, 70],
					[170, 80],
					[170, 90],
					[170, 100]
				]
			},
			{
				"name": "c15-bot",
				"label": "15 f-j",
				"at": [
					[170, 130],
					[170, 140],
					[170, 150],
					[170, 160],
					[170, 170]
				]
			},
			{
				"name": "c16-top",
				"label": "16 a-e",
				"at": [
					[180, 60],
					[180, 70],
					[180, 80],
					[180, 90],
					[180, 100]
				]
			},
			{
				"name": "c16-bot",
				"label": "16 f-j",
				"at": [
					[180, 130],
					[180, 140],
					[180, 150],
					[180, 160],
					[180, 170]
				]
			},
			{
				"name": "c17-top",
				"label": "17 a-e",
				"at": [
					[190, 60],
					[190, 70],
					[190, 80],
					[190, 90],
					[190, 100]
				]
			},
			{
				"name": "c17-bot",
				"label": "17 f-j",
				"at": [
					[190, 130],
					[190, 140],
					[190, 150],
					[190, 160],
					[190, 170]
				]
			},
			{
				"name": "c18-top",
				"label": "18 a-e",
				"at": [
					[200, 60],
					[200, 70],
					[200, 80],
					[200, 90],
					[200, 100]
				]
			},
			{
				"name": "c18-bot",
				"label": "18 f-j",
				"at": [
					[200, 130],
					[200, 140],
					[200, 150],
					[200, 160],
					[200, 170]
				]
			},
			{
				"name": "c19-top",
				"label": "19 a-e",
				"at": [
					[210, 60],
					[210, 70],
					[210, 80],
					[210, 90],
					[210, 100]
				]
			},
			{
				"name": "c19-bot",
				"label": "19 f-j",
				"at": [
					[210, 130],
					[210, 140],
					[210, 150],
					[210, 160],
					[210, 170]
				]
			},
			{
				"name": "c20-top",
				"label": "20 a-e",
				"at": [
					[220, 60],
					[220, 70],
					[220, 80],
					[220, 90],
					[220, 100]
				]
			},
			{
				"name": "c20-bot",
				"label": "20 f-j",
				"at": [
					[220, 130],
					[220, 140],
					[220, 150],
					[220, 160],
					[220, 170]
				]
			},
			{
				"name": "c21-top",
				"label": "21 a-e",
				"at": [
					[230, 60],
					[230, 70],
					[230, 80],
					[230, 90],
					[230, 100]
				]
			},
			{
				"name": "c21-bot",
				"label": "21 f-j",
				"at": [
					[230, 130],
					[230, 140],
					[230, 150],
					[230, 160],
					[230, 170]
				]
			},
			{
				"name": "c22-top",
				"label": "22 a-e",
				"at": [
					[240, 60],
					[240, 70],
					[240, 80],
					[240, 90],
					[240, 100]
				]
			},
			{
				"name": "c22-bot",
				"label": "22 f-j",
				"at": [
					[240, 130],
					[240, 140],
					[240, 150],
					[240, 160],
					[240, 170]
				]
			},
			{
				"name": "c23-top",
				"label": "23 a-e",
				"at": [
					[250, 60],
					[250, 70],
					[250, 80],
					[250, 90],
					[250, 100]
				]
			},
			{
				"name": "c23-bot",
				"label": "23 f-j",
				"at": [
					[250, 130],
					[250, 140],
					[250, 150],
					[250, 160],
					[250, 170]
				]
			},
			{
				"name": "c24-top",
				"label": "24 a-e",
				"at": [
					[260, 60],
					[260, 70],
					[260, 80],
					[260, 90],
					[260, 100]
				]
			},
			{
				"name": "c24-bot",
				"label": "24 f-j",
				"at": [
					[260, 130],
					[260, 140],
					[260, 150],
					[260, 160],
					[260, 170]
				]
			},
			{
				"name": "c25-top",
				"label": "25 a-e",
				"at": [
					[270, 60],
					[270, 70],
					[270, 80],
					[270, 90],
					[270, 100]
				]
			},
			{
				"name": "c25-bot",
				"label": "25 f-j",
				"at": [
					[270, 130],
					[270, 140],
					[270, 150],
					[270, 160],
					[270, 170]
				]
			},
			{
				"name": "c26-top",
				"label": "26 a-e",
				"at": [
					[280, 60],
					[280, 70],
					[280, 80],
					[280, 90],
					[280, 100]
				]
			},
			{
				"name": "c26-bot",
				"label": "26 f-j",
				"at": [
					[280, 130],
					[280, 140],
					[280, 150],
					[280, 160],
					[280, 170]
				]
			},
			{
				"name": "c27-top",
				"label": "27 a-e",
				"at": [
					[290, 60],
					[290, 70],
					[290, 80],
					[290, 90],
					[290, 100]
				]
			},
			{
				"name": "c27-bot",
				"label": "27 f-j",
				"at": [
					[290, 130],
					[290, 140],
					[290, 150],
					[290, 160],
					[290, 170]
				]
			},
			{
				"name": "c28-top",
				"label": "28 a-e",
				"at": [
					[300, 60],
					[300, 70],
					[300, 80],
					[300, 90],
					[300, 100]
				]
			},
			{
				"name": "c28-bot",
				"label": "28 f-j",
				"at": [
					[300, 130],
					[300, 140],
					[300, 150],
					[300, 160],
					[300, 170]
				]
			},
			{
				"name": "c29-top",
				"label": "29 a-e",
				"at": [
					[310, 60],
					[310, 70],
					[310, 80],
					[310, 90],
					[310, 100]
				]
			},
			{
				"name": "c29-bot",
				"label": "29 f-j",
				"at": [
					[310, 130],
					[310, 140],
					[310, 150],
					[310, 160],
					[310, 170]
				]
			},
			{
				"name": "c30-top",
				"label": "30 a-e",
				"at": [
					[320, 60],
					[320, 70],
					[320, 80],
					[320, 90],
					[320, 100]
				]
			},
			{
				"name": "c30-bot",
				"label": "30 f-j",
				"at": [
					[320, 130],
					[320, 140],
					[320, 150],
					[320, 160],
					[320, 170]
				]
			},
			{
				"name": "bottom-",
				"label": "- rail (bottom)",
				"at": [
					[30, 200],
					[40, 200],
					[50, 200],
					[60, 200],
					[70, 200],
					[90, 200],
					[100, 200],
					[110, 200],
					[120, 200],
					[130, 200],
					[150, 200],
					[160, 200],
					[170, 200],
					[180, 200],
					[190, 200],
					[210, 200],
					[220, 200],
					[230, 200],
					[240, 200],
					[250, 200],
					[270, 200],
					[280, 200],
					[290, 200],
					[300, 200],
					[310, 200]
				],
				"rail": "-"
			},
			{
				"name": "bottom+",
				"label": "+ rail (bottom)",
				"at": [
					[30, 210],
					[40, 210],
					[50, 210],
					[60, 210],
					[70, 210],
					[90, 210],
					[100, 210],
					[110, 210],
					[120, 210],
					[130, 210],
					[150, 210],
					[160, 210],
					[170, 210],
					[180, 210],
					[190, 210],
					[210, 210],
					[220, 210],
					[230, 210],
					[240, 210],
					[250, 210],
					[270, 210],
					[280, 210],
					[290, 210],
					[300, 210],
					[310, 210]
				],
				"rail": "+"
			}
		],
		obstacle: false,
		size: {
			"w": 35,
			"h": 23
		},
		art: {
			"w": 350,
			"h": 230,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 350,
					"h": 230,
					"fill": "#FFFFFF",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 10,
					"y": 109,
					"w": 330,
					"h": 12,
					"fill": "#E4E7EC",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 11,
					"w": 292,
					"h": 2,
					"fill": "#E0483E",
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 37,
					"w": 292,
					"h": 2,
					"fill": "#3D6FD6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 191,
					"w": 292,
					"h": 2,
					"fill": "#3D6FD6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 217,
					"w": 292,
					"h": 2,
					"fill": "#E0483E",
					"outline": false
				},
				{
					"type": "rect",
					"x": 10,
					"y": 16,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "+",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 10,
					"y": 26,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "-",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 10,
					"y": 196,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "-",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 10,
					"y": 206,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "+",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 24,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 64,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 114,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "10",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 164,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "15",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 214,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "20",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 264,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "25",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 314,
					"y": 43,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "30",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 24,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 64,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 114,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "10",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 164,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "15",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 214,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "20",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 264,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "25",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 314,
					"y": 179,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "30",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 56,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "a",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 56,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "a",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 66,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "b",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 66,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "b",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 76,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "c",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 76,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "c",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 86,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "d",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 86,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "d",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 96,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "e",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 96,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "e",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 126,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "f",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 126,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "f",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 136,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "g",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 136,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "g",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 146,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "h",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 146,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "h",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 156,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "i",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 156,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "i",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 166,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "j",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 329,
					"y": 166,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "j",
					"labelColor": "#8A929C",
					"labelSize": 6
				}
			]
		}
	},
	"../modules/breadboard-mini.json": {
		format: "circuitoon-module/1",
		id: "breadboard-mini",
		version: 1,
		name: "Mini breadboard (170)",
		category: "Prototyping",
		pins: [],
		holes: [
			{
				"name": "c1-top",
				"label": "1 a-e",
				"at": [
					[30, 30],
					[30, 40],
					[30, 50],
					[30, 60],
					[30, 70]
				]
			},
			{
				"name": "c1-bot",
				"label": "1 f-j",
				"at": [
					[30, 100],
					[30, 110],
					[30, 120],
					[30, 130],
					[30, 140]
				]
			},
			{
				"name": "c2-top",
				"label": "2 a-e",
				"at": [
					[40, 30],
					[40, 40],
					[40, 50],
					[40, 60],
					[40, 70]
				]
			},
			{
				"name": "c2-bot",
				"label": "2 f-j",
				"at": [
					[40, 100],
					[40, 110],
					[40, 120],
					[40, 130],
					[40, 140]
				]
			},
			{
				"name": "c3-top",
				"label": "3 a-e",
				"at": [
					[50, 30],
					[50, 40],
					[50, 50],
					[50, 60],
					[50, 70]
				]
			},
			{
				"name": "c3-bot",
				"label": "3 f-j",
				"at": [
					[50, 100],
					[50, 110],
					[50, 120],
					[50, 130],
					[50, 140]
				]
			},
			{
				"name": "c4-top",
				"label": "4 a-e",
				"at": [
					[60, 30],
					[60, 40],
					[60, 50],
					[60, 60],
					[60, 70]
				]
			},
			{
				"name": "c4-bot",
				"label": "4 f-j",
				"at": [
					[60, 100],
					[60, 110],
					[60, 120],
					[60, 130],
					[60, 140]
				]
			},
			{
				"name": "c5-top",
				"label": "5 a-e",
				"at": [
					[70, 30],
					[70, 40],
					[70, 50],
					[70, 60],
					[70, 70]
				]
			},
			{
				"name": "c5-bot",
				"label": "5 f-j",
				"at": [
					[70, 100],
					[70, 110],
					[70, 120],
					[70, 130],
					[70, 140]
				]
			},
			{
				"name": "c6-top",
				"label": "6 a-e",
				"at": [
					[80, 30],
					[80, 40],
					[80, 50],
					[80, 60],
					[80, 70]
				]
			},
			{
				"name": "c6-bot",
				"label": "6 f-j",
				"at": [
					[80, 100],
					[80, 110],
					[80, 120],
					[80, 130],
					[80, 140]
				]
			},
			{
				"name": "c7-top",
				"label": "7 a-e",
				"at": [
					[90, 30],
					[90, 40],
					[90, 50],
					[90, 60],
					[90, 70]
				]
			},
			{
				"name": "c7-bot",
				"label": "7 f-j",
				"at": [
					[90, 100],
					[90, 110],
					[90, 120],
					[90, 130],
					[90, 140]
				]
			},
			{
				"name": "c8-top",
				"label": "8 a-e",
				"at": [
					[100, 30],
					[100, 40],
					[100, 50],
					[100, 60],
					[100, 70]
				]
			},
			{
				"name": "c8-bot",
				"label": "8 f-j",
				"at": [
					[100, 100],
					[100, 110],
					[100, 120],
					[100, 130],
					[100, 140]
				]
			},
			{
				"name": "c9-top",
				"label": "9 a-e",
				"at": [
					[110, 30],
					[110, 40],
					[110, 50],
					[110, 60],
					[110, 70]
				]
			},
			{
				"name": "c9-bot",
				"label": "9 f-j",
				"at": [
					[110, 100],
					[110, 110],
					[110, 120],
					[110, 130],
					[110, 140]
				]
			},
			{
				"name": "c10-top",
				"label": "10 a-e",
				"at": [
					[120, 30],
					[120, 40],
					[120, 50],
					[120, 60],
					[120, 70]
				]
			},
			{
				"name": "c10-bot",
				"label": "10 f-j",
				"at": [
					[120, 100],
					[120, 110],
					[120, 120],
					[120, 130],
					[120, 140]
				]
			},
			{
				"name": "c11-top",
				"label": "11 a-e",
				"at": [
					[130, 30],
					[130, 40],
					[130, 50],
					[130, 60],
					[130, 70]
				]
			},
			{
				"name": "c11-bot",
				"label": "11 f-j",
				"at": [
					[130, 100],
					[130, 110],
					[130, 120],
					[130, 130],
					[130, 140]
				]
			},
			{
				"name": "c12-top",
				"label": "12 a-e",
				"at": [
					[140, 30],
					[140, 40],
					[140, 50],
					[140, 60],
					[140, 70]
				]
			},
			{
				"name": "c12-bot",
				"label": "12 f-j",
				"at": [
					[140, 100],
					[140, 110],
					[140, 120],
					[140, 130],
					[140, 140]
				]
			},
			{
				"name": "c13-top",
				"label": "13 a-e",
				"at": [
					[150, 30],
					[150, 40],
					[150, 50],
					[150, 60],
					[150, 70]
				]
			},
			{
				"name": "c13-bot",
				"label": "13 f-j",
				"at": [
					[150, 100],
					[150, 110],
					[150, 120],
					[150, 130],
					[150, 140]
				]
			},
			{
				"name": "c14-top",
				"label": "14 a-e",
				"at": [
					[160, 30],
					[160, 40],
					[160, 50],
					[160, 60],
					[160, 70]
				]
			},
			{
				"name": "c14-bot",
				"label": "14 f-j",
				"at": [
					[160, 100],
					[160, 110],
					[160, 120],
					[160, 130],
					[160, 140]
				]
			},
			{
				"name": "c15-top",
				"label": "15 a-e",
				"at": [
					[170, 30],
					[170, 40],
					[170, 50],
					[170, 60],
					[170, 70]
				]
			},
			{
				"name": "c15-bot",
				"label": "15 f-j",
				"at": [
					[170, 100],
					[170, 110],
					[170, 120],
					[170, 130],
					[170, 140]
				]
			},
			{
				"name": "c16-top",
				"label": "16 a-e",
				"at": [
					[180, 30],
					[180, 40],
					[180, 50],
					[180, 60],
					[180, 70]
				]
			},
			{
				"name": "c16-bot",
				"label": "16 f-j",
				"at": [
					[180, 100],
					[180, 110],
					[180, 120],
					[180, 130],
					[180, 140]
				]
			},
			{
				"name": "c17-top",
				"label": "17 a-e",
				"at": [
					[190, 30],
					[190, 40],
					[190, 50],
					[190, 60],
					[190, 70]
				]
			},
			{
				"name": "c17-bot",
				"label": "17 f-j",
				"at": [
					[190, 100],
					[190, 110],
					[190, 120],
					[190, 130],
					[190, 140]
				]
			}
		],
		obstacle: false,
		size: {
			"w": 22,
			"h": 17
		},
		art: {
			"w": 220,
			"h": 170,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 220,
					"h": 170,
					"fill": "#FFFFFF",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 10,
					"y": 79,
					"w": 200,
					"h": 12,
					"fill": "#E4E7EC",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 13,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 64,
					"y": 13,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 114,
					"y": 13,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "10",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 164,
					"y": 13,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "15",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 24,
					"y": 149,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 64,
					"y": 149,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 114,
					"y": 149,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "10",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 164,
					"y": 149,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "15",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 26,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "a",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 26,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "a",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 36,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "b",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 36,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "b",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 46,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "c",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 46,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "c",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 56,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "d",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 56,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "d",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 66,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "e",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 66,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "e",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 96,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "f",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 96,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "f",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 106,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "g",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 106,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "g",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 116,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "h",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 116,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "h",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 126,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "i",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 126,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "i",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 136,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "j",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 199,
					"y": 136,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "j",
					"labelColor": "#8A929C",
					"labelSize": 6
				}
			]
		}
	},
	"../modules/breadboard-tiny.json": {
		format: "circuitoon-module/1",
		id: "breadboard-tiny",
		version: 1,
		name: "Tiny breadboard (25)",
		category: "Prototyping",
		pins: [],
		holes: [
			{
				"name": "c1",
				"label": "1",
				"at": [
					[20, 20],
					[20, 30],
					[20, 40],
					[20, 50],
					[20, 60]
				]
			},
			{
				"name": "c2",
				"label": "2",
				"at": [
					[30, 20],
					[30, 30],
					[30, 40],
					[30, 50],
					[30, 60]
				]
			},
			{
				"name": "c3",
				"label": "3",
				"at": [
					[40, 20],
					[40, 30],
					[40, 40],
					[40, 50],
					[40, 60]
				]
			},
			{
				"name": "c4",
				"label": "4",
				"at": [
					[50, 20],
					[50, 30],
					[50, 40],
					[50, 50],
					[50, 60]
				]
			},
			{
				"name": "c5",
				"label": "5",
				"at": [
					[60, 20],
					[60, 30],
					[60, 40],
					[60, 50],
					[60, 60]
				]
			}
		],
		obstacle: false,
		size: {
			"w": 8,
			"h": 8
		},
		art: {
			"w": 80,
			"h": 80,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 80,
					"h": 80,
					"fill": "#FFFFFF",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 14,
					"y": 6,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "1",
					"labelColor": "#8A929C",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 54,
					"y": 6,
					"w": 12,
					"h": 8,
					"fill": "#FFFFFF",
					"outline": false,
					"label": "5",
					"labelColor": "#8A929C",
					"labelSize": 6
				}
			]
		}
	},
	"../modules/buzzer-12mm-passive.json": {
		format: "circuitoon-module/1",
		id: "buzzer-12mm-passive",
		version: 1,
		name: "Passive buzzer 12 mm",
		category: "Indicators",
		source: "https://cdn.sparkfun.com/datasheets/Components/General/cem-1203-42-.pdf https://www.sameskydevices.com/product/audio/buzzers/audio-transducers/cem-1203(42)",
		pins: [{
			"name": "+",
			"label": "+",
			"side": "left",
			"type": "passive"
		}, {
			"name": "-",
			"label": "-",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "buzzer",
			"polarized": true,
			"terminals": {
				"pos": "+",
				"neg": "-"
			},
			"params": {}
		},
		art: {
			"w": 70,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 18,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 52,
					"y": 18.5,
					"w": 18,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 1,
					"w": 38,
					"h": 38,
					"fill": "#1B1F24",
					"radius": 19
				},
				{
					"type": "rect",
					"x": 31,
					"y": 16,
					"w": 8,
					"h": 8,
					"fill": "#3A3F47",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 20,
					"y": 14,
					"w": 9,
					"h": 12,
					"fill": "#1B1F24",
					"outline": false,
					"label": "+",
					"labelColor": "#C9CED6",
					"labelSize": 10
				}
			]
		}
	},
	"../modules/capacitor-ceramic.json": {
		format: "circuitoon-module/1",
		id: "capacitor-ceramic",
		version: 1,
		name: "Ceramic capacitor",
		category: "Passives",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "capacitor",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": { "capacitance": {
				"unit": "F",
				"default": 1e-7
			} }
		},
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 26,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 9,
					"y": 7,
					"w": 22,
					"h": 24,
					"fill": "#E8A33D",
					"radius": 10,
					"label": "104",
					"labelColor": "#23282F",
					"labelSize": 7
				}
			]
		}
	},
	"../modules/capacitor-electrolytic.json": {
		format: "circuitoon-module/1",
		id: "capacitor-electrolytic",
		version: 1,
		name: "Electrolytic capacitor",
		category: "Passives",
		pins: [{
			"name": "+",
			"label": "+",
			"side": "left",
			"type": "passive"
		}, {
			"name": "-",
			"label": "-",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "capacitor",
			"polarized": true,
			"terminals": {
				"a": "+",
				"b": "-"
			},
			"params": { "capacitance": {
				"unit": "F",
				"default": 1e-4
			} }
		},
		art: {
			"w": 50,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 36,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 12,
					"y": 4,
					"w": 26,
					"h": 32,
					"fill": "#2F4F8F",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 12,
					"y": 4,
					"w": 26,
					"h": 6,
					"fill": "#C9D3E3",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 31,
					"y": 11,
					"w": 5,
					"h": 22,
					"fill": "#8FA6D6",
					"outline": false,
					"label": "-",
					"labelColor": "#1B2A4A",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/capacitor-film.json": {
		format: "circuitoon-module/1",
		id: "capacitor-film",
		version: 1,
		name: "Film capacitor",
		category: "Passives",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "capacitor",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": { "capacitance": {
				"unit": "F",
				"default": 1e-7
			} }
		},
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 26,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 9,
					"y": 8,
					"w": 22,
					"h": 22,
					"fill": "#C8372D",
					"radius": 4,
					"label": "104",
					"labelColor": "#FFF3E0",
					"labelSize": 7
				}
			]
		}
	},
	"../modules/capacitor-tantalum.json": {
		format: "circuitoon-module/1",
		id: "capacitor-tantalum",
		version: 1,
		name: "Tantalum capacitor",
		category: "Passives",
		pins: [{
			"name": "+",
			"label": "+",
			"side": "left",
			"type": "passive"
		}, {
			"name": "-",
			"label": "-",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "capacitor",
			"polarized": true,
			"terminals": {
				"a": "+",
				"b": "-"
			},
			"params": { "capacitance": {
				"unit": "F",
				"default": 1e-5
			} }
		},
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 26,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 9,
					"y": 9,
					"w": 22,
					"h": 20,
					"fill": "#E8A33D",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 10,
					"y": 10,
					"w": 4,
					"h": 18,
					"fill": "#4A3216",
					"outline": false,
					"radius": 2
				}
			]
		}
	},
	"../modules/dht22-bare.json": {
		format: "circuitoon-module/1",
		id: "dht22-bare",
		version: 1,
		name: "DHT22 / AM2302 temperature/humidity sensor (bare, 4-pin: VCC DATA NC GND)",
		category: "Sensors",
		source: "https://www.sparkfun.com/datasheets/Sensors/Temperature/DHT22.pdf https://lastminuteengineers.com/dht11-dht22-arduino-tutorial/",
		pins: [
			{
				"name": "VCC",
				"side": "bottom",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "DATA",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "NC",
				"side": "bottom",
				"type": "nc"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			}
		],
		size: {
			"w": 7,
			"h": 13
		},
		electrical: {
			"model": "sensor",
			"params": {}
		},
		art: {
			"w": 70,
			"h": 130,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 90,
					"w": 3,
					"h": 40,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 90,
					"w": 3,
					"h": 40,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 90,
					"w": 3,
					"h": 40,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 90,
					"w": 3,
					"h": 40,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 21,
					"y": 2,
					"w": 28,
					"h": 18,
					"fill": "#EEF0EC",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 29,
					"y": 6,
					"w": 10,
					"h": 10,
					"fill": "#FFFFFF",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 5,
					"y": 14,
					"w": 60,
					"h": 78,
					"fill": "#EEF0EC",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 14,
					"y": 26,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 26,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 26,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 26,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 36,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 36,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 36,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 36,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 46,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 46,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 46,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 46,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 56,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 56,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 56,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 56,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 66,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 66,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 66,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 66,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 76,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 76,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 76,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 76,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				}
			]
		}
	},
	"../modules/dht22-module.json": {
		format: "circuitoon-module/1",
		id: "dht22-module",
		version: 1,
		name: "DHT22 temperature/humidity module (3-pin: + out -)",
		category: "Sensors",
		source: "https://components101.com/sensors/dht22-pinout-specs-datasheet https://components101.com/sites/default/files/components/DHT22-Sensor.jpg https://shillehtek.com/blogs/shillehtek-product-manuals/dht22-digital-temperature-and-humidity-sensor-module-with-cable",
		pins: [
			{
				"name": "+",
				"side": "bottom",
				"label": "VCC",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "out",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "-",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			}
		],
		size: {
			"w": 8,
			"h": 14
		},
		electrical: {
			"model": "sensor",
			"params": {}
		},
		art: {
			"w": 80,
			"h": 140,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 40,
					"w": 80,
					"h": 100,
					"fill": "#2B2F36",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 26,
					"y": 4,
					"w": 28,
					"h": 18,
					"fill": "#EEF0EC",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 34,
					"y": 8,
					"w": 10,
					"h": 10,
					"fill": "#FFFFFF",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 16,
					"w": 60,
					"h": 78,
					"fill": "#EEF0EC",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 19,
					"y": 28,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 28,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 41,
					"y": 28,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 28,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 38,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 38,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 41,
					"y": 38,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 38,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 48,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 48,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 41,
					"y": 48,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 48,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 58,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 58,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 41,
					"y": 58,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 58,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 68,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 68,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 41,
					"y": 68,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 68,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 78,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 78,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 41,
					"y": 78,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 78,
					"w": 7,
					"h": 5,
					"fill": "#9AA0A6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 64,
					"y": 102,
					"w": 8,
					"h": 8,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 8,
					"y": 102,
					"w": 8,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 130,
					"w": 30,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 132.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 132.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 132.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/dupont-1x2.json": {
		format: "circuitoon-module/1",
		id: "dupont-1x2",
		version: 1,
		name: "Dupont housing 1x2 (0.1 in)",
		category: "Connectors",
		source: "https://www.pololu.com/product/1901 https://www.pololu.com/category/71/0.1-inch-2.54mm-crimp-connector-housings",
		pins: [{
			"name": "1",
			"side": "bottom",
			"label": "1",
			"type": "passive"
		}, {
			"name": "2",
			"side": "bottom",
			"label": "2",
			"type": "passive"
		}],
		size: {
			"w": 5,
			"h": 5
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 50,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 13,
					"y": 6,
					"w": 24,
					"h": 32,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 17,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 8,
					"w": 4,
					"h": 3,
					"fill": "#9AA0A6",
					"outline": false
				}
			]
		}
	},
	"../modules/dupont-1x3.json": {
		format: "circuitoon-module/1",
		id: "dupont-1x3",
		version: 1,
		name: "Dupont housing 1x3 (0.1 in)",
		category: "Connectors",
		source: "https://www.pololu.com/product/1902 https://www.pololu.com/category/71/0.1-inch-2.54mm-crimp-connector-housings",
		pins: [
			{
				"name": "1",
				"side": "bottom",
				"label": "1",
				"type": "passive"
			},
			{
				"name": "2",
				"side": "bottom",
				"label": "2",
				"type": "passive"
			},
			{
				"name": "3",
				"side": "bottom",
				"label": "3",
				"type": "passive"
			}
		],
		size: {
			"w": 6,
			"h": 5
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 60,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 13,
					"y": 6,
					"w": 34,
					"h": 32,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 17,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 37,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 39,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 8,
					"w": 4,
					"h": 3,
					"fill": "#9AA0A6",
					"outline": false
				}
			]
		}
	},
	"../modules/dupont-1x4.json": {
		format: "circuitoon-module/1",
		id: "dupont-1x4",
		version: 1,
		name: "Dupont housing 1x4 (0.1 in)",
		category: "Connectors",
		source: "https://www.pololu.com/product/1903 https://www.pololu.com/category/71/0.1-inch-2.54mm-crimp-connector-housings",
		pins: [
			{
				"name": "1",
				"side": "bottom",
				"label": "1",
				"type": "passive"
			},
			{
				"name": "2",
				"side": "bottom",
				"label": "2",
				"type": "passive"
			},
			{
				"name": "3",
				"side": "bottom",
				"label": "3",
				"type": "passive"
			},
			{
				"name": "4",
				"side": "bottom",
				"label": "4",
				"type": "passive"
			}
		],
		size: {
			"w": 7,
			"h": 5
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 70,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 13,
					"y": 6,
					"w": 44,
					"h": 32,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 17,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 37,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 13,
					"w": 6,
					"h": 6,
					"fill": "#3A3F47",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 19,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 39,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 49,
					"y": 15,
					"w": 2,
					"h": 2,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 8,
					"w": 4,
					"h": 3,
					"fill": "#9AA0A6",
					"outline": false
				}
			]
		}
	},
	"../modules/esp32-c3-supermini.json": {
		format: "circuitoon-module/1",
		id: "esp32-c3-supermini",
		version: 1,
		name: "ESP32-C3 SuperMini",
		category: "Microcontrollers",
		source: "https://www.nologo.tech/en/product/esp32/esp32c3SuperMini/esp32C3SuperMini.html https://lastminuteengineers.com/esp32-c3-super-mini-pinout-reference/",
		pins: [
			{
				"name": "5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "20",
				"side": "left",
				"type": "io"
			},
			{
				"name": "21",
				"side": "left",
				"type": "io"
			},
			{
				"name": "5V",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "G",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "3.3",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "4",
				"side": "right",
				"type": "io"
			},
			{
				"name": "3",
				"side": "right",
				"type": "io"
			},
			{
				"name": "2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "0",
				"side": "right",
				"type": "io"
			}
		],
		size: {
			"w": 8,
			"h": 10
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB"
			}]
		},
		art: {
			"w": 80,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 80,
					"h": 100,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 15,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 70,
					"y": 15,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27,
					"y": -6,
					"w": 26,
					"h": 22,
					"fill": "#C9CED6",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 25,
					"y": 20,
					"w": 11,
					"h": 11,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 27.5,
					"y": 22.5,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 20,
					"w": 11,
					"h": 11,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 46.5,
					"y": 22.5,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 40,
					"w": 32,
					"h": 30,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "ESP32-C3",
					"labelColor": "#D5DAE1",
					"labelSize": 5.5
				},
				{
					"type": "rect",
					"x": 48,
					"y": 33,
					"w": 5,
					"h": 4,
					"fill": "#3D6FD6",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 25,
					"y": 82,
					"w": 30,
					"h": 12,
					"fill": "#D8413A",
					"radius": 2,
					"label": "C3",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				}
			]
		}
	},
	"../modules/esp32-cam.json": {
		format: "circuitoon-module/1",
		id: "esp32-cam",
		version: 1,
		name: "ESP32-CAM (AI Thinker)",
		category: "Microcontrollers",
		source: "https://randomnerdtutorials.com/esp32-cam-ai-thinker-pinout/ https://mischianti.org/esp32-cam-high-resolution-pinout-and-specs/ https://github.com/prusa3d/Prusa-Firmware-ESP32-Cam/blob/master/doc/AI_Thinker-ESP32-cam/README.md",
		pins: [
			{
				"name": "5V",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "IO12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO4",
				"side": "left",
				"type": "io"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "3V3",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "IO16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "VCC",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "U0R",
				"side": "right",
				"type": "io"
			},
			{
				"name": "U0T",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND/R",
				"side": "right",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			}
		],
		internal: [["GND", "GND 2"]],
		size: {
			"w": 11,
			"h": 16
		},
		electrical: {
			"model": "mcu",
			"params": {}
		},
		art: {
			"w": 110,
			"h": 160,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 110,
					"h": 160,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 15,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 15,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 102.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 4,
					"w": 42,
					"h": 44,
					"fill": "#C9CED6",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 39,
					"y": 10,
					"w": 32,
					"h": 32,
					"fill": "#1B1F24",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 47,
					"y": 18,
					"w": 16,
					"h": 16,
					"fill": "#3A3F47",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 51,
					"y": 22,
					"w": 8,
					"h": 8,
					"fill": "#141414",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 49,
					"y": 48,
					"w": 12,
					"h": 38,
					"fill": "#C8742B",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 32,
					"y": 104,
					"w": 46,
					"h": 12,
					"fill": "#E8E4D8",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 80,
					"y": 122,
					"w": 12,
					"h": 12,
					"fill": "#FFE08A",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 12,
					"y": 134,
					"w": 86,
					"h": 16,
					"fill": "#2B2F36",
					"outline": false,
					"label": "ESP32-CAM",
					"labelColor": "#F4F1EA",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/esp32-devkit-v1-30.json": {
		format: "circuitoon-module/1",
		id: "esp32-devkit-v1-30",
		version: 1,
		name: "ESP32 DevKit V1 (30 pin, DOIT)",
		category: "Microcontrollers",
		source: "https://mischianti.org/doit-esp32-dev-kit-v1-high-resolution-pinout-and-specs/ https://lastminuteengineers.com/esp32-pinout-reference/ https://mischianti.org/wp-content/uploads/2024/11/DOIT-ESP32-DevKit-V1-schematics.pdf",
		pins: [
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "EN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "VP",
				"side": "left",
				"type": "input"
			},
			{
				"name": "VN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "D34",
				"side": "left",
				"type": "input"
			},
			{
				"name": "D35",
				"side": "left",
				"type": "input"
			},
			{
				"name": "D32",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D33",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D25",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D26",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D27",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "VIN",
				"side": "left",
				"type": "power_in",
				"supply": "5V/7V/9V/12V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "D23",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "TX0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RX0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D5",
				"side": "right",
				"type": "io"
			},
			{
				"name": "TX2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RX2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D4",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D15",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "3V3",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			}
		],
		internal: [["GND", "GND 2"]],
		size: {
			"w": 12,
			"h": 19
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "VIN",
				"volts": 5,
				"via": "USB",
				"diode": true
			}]
		},
		art: {
			"w": 120,
			"h": 190,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 190,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 35,
					"w": 8,
					"h": 150,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 35,
					"w": 8,
					"h": 150,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 4,
					"w": 52,
					"h": 30,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 36,
					"h": 2.5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 53.166666666666664,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64.33333333333333,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 75.5,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 34,
					"w": 52,
					"h": 60,
					"fill": "#D5DAE1",
					"radius": 3,
					"label": "ESP32",
					"labelSize": 10
				},
				{
					"type": "rect",
					"x": 51,
					"y": 124,
					"w": 18,
					"h": 18,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 40,
					"y": 106,
					"w": 5,
					"h": 4,
					"fill": "#E5484D",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 75,
					"y": 106,
					"w": 5,
					"h": 4,
					"fill": "#3D6FD6",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 36,
					"y": 162,
					"w": 12,
					"h": 12,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 39,
					"y": 165,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72,
					"y": 162,
					"w": 12,
					"h": 12,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 75,
					"y": 165,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 49,
					"y": 178,
					"w": 22,
					"h": 17,
					"fill": "#C9CED6",
					"radius": 2
				}
			]
		}
	},
	"../modules/esp32-devkitc-v4.json": {
		format: "circuitoon-module/1",
		id: "esp32-devkitc-v4",
		version: 1,
		name: "ESP32 DevKitC V4 (38 pin)",
		category: "Microcontrollers",
		source: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/_images/esp32_devkitC_v4_pinlayout.png https://dl.espressif.com/dl/schematics/esp32_devkitc_v4-sch.pdf",
		pins: [
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "3V3",
				"side": "left",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "EN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "VP",
				"side": "left",
				"type": "input"
			},
			{
				"name": "VN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "IO34",
				"side": "left",
				"type": "input"
			},
			{
				"name": "IO35",
				"side": "left",
				"type": "input"
			},
			{
				"name": "IO32",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO33",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO25",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO26",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO27",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "IO12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "IO13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D2",
				"side": "left"
			},
			{
				"name": "D3",
				"side": "left"
			},
			{
				"name": "CMD",
				"side": "left"
			},
			{
				"name": "5V",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "GND 2",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "IO23",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "TX",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RX",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "IO19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO5",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO17",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO4",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "IO15",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D1",
				"side": "right"
			},
			{
				"name": "D0",
				"side": "right"
			},
			{
				"name": "CLK",
				"side": "right"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3"
		]],
		size: {
			"w": 12,
			"h": 23
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB",
				"diode": true
			}]
		},
		art: {
			"w": 120,
			"h": 230,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 230,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 35,
					"w": 8,
					"h": 190,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 218.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 35,
					"w": 8,
					"h": 190,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 218.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 4,
					"w": 52,
					"h": 32,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 36,
					"h": 2.5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 53.166666666666664,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64.33333333333333,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 75.5,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 36,
					"w": 52,
					"h": 64,
					"fill": "#D5DAE1",
					"radius": 3,
					"label": "ESP32",
					"labelSize": 10
				},
				{
					"type": "rect",
					"x": 50,
					"y": 150,
					"w": 20,
					"h": 20,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 42,
					"y": 126,
					"w": 5,
					"h": 4,
					"fill": "#E5484D",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 36,
					"y": 200,
					"w": 12,
					"h": 12,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 39,
					"y": 203,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72,
					"y": 200,
					"w": 12,
					"h": 12,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 75,
					"y": 203,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 49,
					"y": 218,
					"w": 22,
					"h": 17,
					"fill": "#C9CED6",
					"radius": 2
				}
			]
		}
	},
	"../modules/esp32-s3-devkitc-1.json": {
		format: "circuitoon-module/1",
		id: "esp32-s3-devkitc-1",
		version: 1,
		name: "ESP32-S3-DevKitC-1",
		category: "Microcontrollers",
		source: "https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/_images/ESP32-S3_DevKitC-1_pinlayout_v1.1.jpg https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf",
		pins: [
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "3V3",
				"side": "left",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "3V3 2",
				"side": "left",
				"label": "3V3",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "RST",
				"side": "left",
				"type": "input"
			},
			{
				"name": "4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "16",
				"side": "left",
				"type": "io"
			},
			{
				"name": "17",
				"side": "left",
				"type": "io"
			},
			{
				"name": "18",
				"side": "left",
				"type": "io"
			},
			{
				"name": "8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "46",
				"side": "left",
				"type": "io"
			},
			{
				"name": "9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "11",
				"side": "left",
				"type": "io"
			},
			{
				"name": "12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "5V",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "G",
				"side": "left",
				"type": "ground"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "G 2",
				"side": "right",
				"label": "G",
				"type": "ground"
			},
			{
				"name": "TX",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RX",
				"side": "right",
				"type": "io"
			},
			{
				"name": "1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "42",
				"side": "right",
				"type": "io"
			},
			{
				"name": "41",
				"side": "right",
				"type": "io"
			},
			{
				"name": "40",
				"side": "right",
				"type": "io"
			},
			{
				"name": "39",
				"side": "right",
				"type": "io"
			},
			{
				"name": "38",
				"side": "right",
				"type": "io"
			},
			{
				"name": "37",
				"side": "right"
			},
			{
				"name": "36",
				"side": "right"
			},
			{
				"name": "35",
				"side": "right"
			},
			{
				"name": "0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "45",
				"side": "right",
				"type": "io"
			},
			{
				"name": "48",
				"side": "right",
				"type": "io"
			},
			{
				"name": "47",
				"side": "right",
				"type": "io"
			},
			{
				"name": "21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "20",
				"side": "right",
				"type": "io"
			},
			{
				"name": "19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "G 3",
				"side": "right",
				"label": "G",
				"type": "ground"
			},
			{
				"name": "G 4",
				"side": "right",
				"label": "G",
				"type": "ground"
			}
		],
		internal: [[
			"G",
			"G 2",
			"G 3",
			"G 4"
		], ["3V3", "3V3 2"]],
		size: {
			"w": 12,
			"h": 26
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB",
				"diode": true
			}]
		},
		art: {
			"w": 120,
			"h": 260,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 260,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 35,
					"w": 8,
					"h": 220,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 218.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 228.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 238.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 248.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 35,
					"w": 8,
					"h": 220,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 218.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 228.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 238.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112.5,
					"y": 248.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 4,
					"w": 52,
					"h": 30,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 36,
					"h": 2.5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 53.166666666666664,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64.33333333333333,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 75.5,
					"y": 12,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 34,
					"w": 52,
					"h": 70,
					"fill": "#D5DAE1",
					"radius": 3,
					"label": "ESP32-S3",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 51,
					"y": 182,
					"w": 18,
					"h": 18,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 44,
					"y": 140,
					"w": 9,
					"h": 9,
					"fill": "#F4F1EA",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 36,
					"y": 216,
					"w": 12,
					"h": 12,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 39,
					"y": 219,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72,
					"y": 216,
					"w": 12,
					"h": 12,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 75,
					"y": 219,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 246,
					"w": 20,
					"h": 19,
					"fill": "#C9CED6",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 64,
					"y": 246,
					"w": 20,
					"h": 19,
					"fill": "#C9CED6",
					"radius": 3
				}
			]
		}
	},
	"../modules/esp32-terminal-board-38.json": {
		format: "circuitoon-module/1",
		id: "esp32-terminal-board-38",
		version: 1,
		name: "ESP32 DevKitC V4 on 38-pin screw terminal board",
		category: "Microcontrollers",
		source: "https://protosupplies.com/product/esp32-s-screw-terminal-adapter/ https://www.otronic.nl/en/breakout-board-for-esp32-s-38-pins.html",
		pins: [
			{
				"name": "5V",
				"side": "top",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "CMD",
				"side": "top"
			},
			{
				"name": "SD3",
				"side": "top"
			},
			{
				"name": "SD2",
				"side": "top"
			},
			{
				"name": "P13",
				"side": "top",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "P12",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P14",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P27",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P26",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P25",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P33",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P32",
				"side": "top",
				"type": "io"
			},
			{
				"name": "P35",
				"side": "top",
				"type": "input"
			},
			{
				"name": "P34",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SVN",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SVP",
				"side": "top",
				"type": "input"
			},
			{
				"name": "EN",
				"side": "top",
				"type": "input"
			},
			{
				"name": "3V3",
				"side": "top",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "CLK",
				"side": "bottom"
			},
			{
				"name": "SD0",
				"side": "bottom"
			},
			{
				"name": "SD1",
				"side": "bottom"
			},
			{
				"name": "P15",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P2",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P0",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P4",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P16",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P17",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P5",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P18",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P19",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "P21",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "RX",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "TX",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P22",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "P23",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3"
		]],
		size: {
			"w": 26,
			"h": 21
		},
		electrical: {
			"model": "breakout",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "the DevKit's USB",
				"diode": true
			}]
		},
		art: /* @__PURE__ */ JSON.parse("{\"w\":260,\"h\":210,\"pinLabels\":\"inside\",\"shapes\":[{\"type\":\"rect\",\"x\":0,\"y\":0,\"w\":260,\"h\":210,\"fill\":\"#2B2F36\",\"radius\":4},{\"type\":\"rect\",\"x\":4,\"y\":4,\"w\":10,\"h\":10,\"fill\":\"#15181C\",\"radius\":5},{\"type\":\"rect\",\"x\":246,\"y\":4,\"w\":10,\"h\":10,\"fill\":\"#15181C\",\"radius\":5},{\"type\":\"rect\",\"x\":4,\"y\":196,\"w\":10,\"h\":10,\"fill\":\"#15181C\",\"radius\":5},{\"type\":\"rect\",\"x\":246,\"y\":196,\"w\":10,\"h\":10,\"fill\":\"#15181C\",\"radius\":5},{\"type\":\"rect\",\"x\":34,\"y\":1,\"w\":192,\"h\":10,\"fill\":\"#3FA34D\",\"radius\":1},{\"type\":\"rect\",\"x\":37,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":47,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":57,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":67,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":77,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":87,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":97,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":107,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":117,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":127,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":137,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":147,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":157,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":167,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":177,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":187,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":197,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":207,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":217,\"y\":3,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":37.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":47.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":57.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":67.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":77.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":87.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":97.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":107.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":117.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":127.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":137.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":147.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":157.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":167.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":177.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":187.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":197.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":207.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":217.5,\"y\":5.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":34,\"y\":199,\"w\":192,\"h\":10,\"fill\":\"#3FA34D\",\"radius\":1},{\"type\":\"rect\",\"x\":37,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":47,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":57,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":67,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":77,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":87,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":97,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":107,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":117,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":127,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":137,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":147,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":157,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":167,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":177,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":187,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":197,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":207,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":217,\"y\":201,\"w\":6,\"h\":6,\"fill\":\"#C9CED6\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":37.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":47.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":57.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":67.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":77.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":87.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":97.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":107.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":117.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":127.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":137.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":147.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":157.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":167.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":177.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":187.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":197.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":207.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":217.5,\"y\":203.5,\"w\":5,\"h\":1,\"fill\":\"#6B727C\",\"outline\":false},{\"type\":\"rect\",\"x\":54,\"y\":48,\"w\":152,\"h\":8,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":58.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":78.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":88.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":98.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":108.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":128.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":138.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":148.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":158.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":168.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":178.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":188.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":198.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":54,\"y\":62,\"w\":152,\"h\":8,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":58.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":78.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":88.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":98.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":108.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":128.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":138.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":148.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":158.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":168.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":178.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":188.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":198.5,\"y\":64.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":54,\"y\":140,\"w\":152,\"h\":8,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":58.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":78.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":88.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":98.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":108.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":128.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":138.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":148.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":158.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":168.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":178.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":188.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":198.5,\"y\":142.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":54,\"y\":154,\"w\":152,\"h\":8,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":58.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":78.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":88.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":98.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":108.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":128.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":138.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":148.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":158.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":168.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":178.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":188.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":198.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#3A3F47\",\"outline\":false},{\"type\":\"rect\",\"x\":24,\"y\":40,\"w\":216,\"h\":130,\"fill\":\"#2B2F36\",\"radius\":5},{\"type\":\"rect\",\"x\":35,\"y\":48,\"w\":190,\"h\":8,\"fill\":\"#E0B43C\",\"radius\":2,\"outline\":false},{\"type\":\"rect\",\"x\":38.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":48.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":58.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":78.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":88.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":98.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":108.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":128.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":138.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":148.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":158.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":168.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":178.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":188.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":198.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":208.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":218.5,\"y\":50.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":35,\"y\":154,\"w\":190,\"h\":8,\"fill\":\"#E0B43C\",\"radius\":2,\"outline\":false},{\"type\":\"rect\",\"x\":38.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":48.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":58.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":78.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":88.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":98.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":108.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":128.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":138.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":148.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":158.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":168.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":178.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":188.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":198.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":208.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":218.5,\"y\":156.5,\"w\":3,\"h\":3,\"fill\":\"#6B727C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":12,\"y\":91,\"w\":22,\"h\":28,\"fill\":\"#C9CED6\",\"radius\":2},{\"type\":\"rect\",\"x\":42,\"y\":64,\"w\":14,\"h\":14,\"fill\":\"#3A3F47\",\"radius\":2},{\"type\":\"rect\",\"x\":46,\"y\":68,\"w\":6,\"h\":6,\"fill\":\"#1B1F24\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":42,\"y\":130,\"w\":14,\"h\":14,\"fill\":\"#3A3F47\",\"radius\":2},{\"type\":\"rect\",\"x\":46,\"y\":134,\"w\":6,\"h\":6,\"fill\":\"#1B1F24\",\"radius\":3,\"outline\":false},{\"type\":\"rect\",\"x\":66,\"y\":102,\"w\":6,\"h\":5,\"fill\":\"#E0483E\",\"radius\":1,\"outline\":false},{\"type\":\"rect\",\"x\":84,\"y\":94,\"w\":22,\"h\":22,\"fill\":\"#1B1F24\",\"radius\":2},{\"type\":\"rect\",\"x\":142,\"y\":62,\"w\":72,\"h\":86,\"fill\":\"#B8BEC7\",\"radius\":3,\"label\":\"ESP32\",\"labelSize\":12},{\"type\":\"rect\",\"x\":214,\"y\":62,\"w\":22,\"h\":86,\"fill\":\"#1B1F24\",\"radius\":2},{\"type\":\"rect\",\"x\":218,\"y\":68,\"w\":2.5,\"h\":74,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":218,\"y\":68,\"w\":14,\"h\":2.5,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":218,\"y\":91.8,\"w\":14,\"h\":2.5,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":218,\"y\":115.6,\"w\":14,\"h\":2.5,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":218,\"y\":139.4,\"w\":14,\"h\":2.5,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":100,\"y\":124,\"w\":36,\"h\":10,\"fill\":\"#2B2F36\",\"outline\":false,\"label\":\"DevKitC V4\",\"labelColor\":\"#FFFFFF\",\"labelSize\":6}]}")
	},
	"../modules/ip5306-usbc-module.json": {
		format: "circuitoon-module/1",
		id: "ip5306-usbc-module",
		version: 1,
		name: "IP5306 USB-C charge/boost module (18650, 5 V out)",
		category: "Power",
		source: "https://done.land/components/power/powersupplies/battery/chargers/charge-discharge/ip5306/x-150/ https://www.amazon.com/dp/B0DDLF99HN",
		pins: [
			{
				"name": "B-",
				"side": "left",
				"type": "ground"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "B+",
				"side": "left",
				"type": "power_in",
				"supply": "3.7V"
			},
			{
				"name": "K",
				"side": "bottom",
				"type": "input"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "5V+",
				"side": "bottom",
				"type": "power_out",
				"supply": "5V"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "5V-",
				"side": "bottom",
				"type": "ground"
			}
		],
		internal: [["B-", "5V-"]],
		size: {
			"w": 12,
			"h": 10
		},
		electrical: {
			"model": "power_bank",
			"params": {}
		},
		art: {
			"w": 120,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 100,
					"fill": "#2B2F36",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 16,
					"y": 7,
					"w": 6,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 7,
					"w": 6,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 7,
					"w": 6,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 46,
					"y": 7,
					"w": 6,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 57.75,
					"y": 15,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 57.75,
					"y": 34,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64.25,
					"y": 15,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64.25,
					"y": 34,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 70.75,
					"y": 15,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 70.75,
					"y": 34,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 77.25,
					"y": 15,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 77.25,
					"y": 34,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 18,
					"w": 26,
					"h": 16,
					"fill": "#1E2126",
					"radius": 1,
					"label": "IP5306",
					"labelColor": "#C9CED6",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 28,
					"y": 44,
					"w": 30,
					"h": 30,
					"fill": "#8E949C",
					"radius": 4,
					"label": "2R2",
					"labelSize": 8
				},
				{
					"type": "rect",
					"x": 66,
					"y": 44,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 66,
					"y": 54,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 90,
					"y": 34,
					"w": 30,
					"h": 30,
					"fill": "#C9CED6",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 113,
					"y": 40,
					"w": 4,
					"h": 18,
					"fill": "#8A9099",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 36,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 56,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 89,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 91.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 76,
					"y": 89,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 91.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 96,
					"y": 89,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 98.5,
					"y": 91.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/jst-xh-2.json": {
		format: "circuitoon-module/1",
		id: "jst-xh-2",
		version: 1,
		name: "JST-XH connector, 2-pin (2.5 mm)",
		category: "Connectors",
		source: "https://www.jst-mfg.com/product/pdf/eng/eXH.pdf https://www.jst-mfg.com/product/detail_e.php?series=277",
		pins: [{
			"name": "1",
			"side": "bottom",
			"label": "1",
			"type": "passive"
		}, {
			"name": "2",
			"side": "bottom",
			"label": "2",
			"type": "passive"
		}],
		size: {
			"w": 5,
			"h": 5
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 50,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 6,
					"y": 8,
					"w": 38,
					"h": 30,
					"fill": "#EEF0EC",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 14,
					"w": 30,
					"h": 20,
					"fill": "#D6DAD2",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 17.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 20,
					"y": 8,
					"w": 10,
					"h": 5,
					"fill": "#D6DAD2",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 9.5,
					"w": 4,
					"h": 4,
					"fill": "#1B1F24",
					"radius": 2,
					"outline": false
				}
			]
		}
	},
	"../modules/jst-xh-3.json": {
		format: "circuitoon-module/1",
		id: "jst-xh-3",
		version: 1,
		name: "JST-XH connector, 3-pin (2.5 mm)",
		category: "Connectors",
		source: "https://www.jst-mfg.com/product/pdf/eng/eXH.pdf https://www.jst-mfg.com/product/detail_e.php?series=277",
		pins: [
			{
				"name": "1",
				"side": "bottom",
				"label": "1",
				"type": "passive"
			},
			{
				"name": "2",
				"side": "bottom",
				"label": "2",
				"type": "passive"
			},
			{
				"name": "3",
				"side": "bottom",
				"label": "3",
				"type": "passive"
			}
		],
		size: {
			"w": 6,
			"h": 5
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 60,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 6,
					"y": 8,
					"w": 48,
					"h": 30,
					"fill": "#EEF0EC",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 14,
					"w": 40,
					"h": 20,
					"fill": "#D6DAD2",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 17.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 37.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 25,
					"y": 8,
					"w": 10,
					"h": 5,
					"fill": "#D6DAD2",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 9.5,
					"w": 4,
					"h": 4,
					"fill": "#1B1F24",
					"radius": 2,
					"outline": false
				}
			]
		}
	},
	"../modules/jst-xh-4.json": {
		format: "circuitoon-module/1",
		id: "jst-xh-4",
		version: 1,
		name: "JST-XH connector, 4-pin (2.5 mm)",
		category: "Connectors",
		source: "https://www.jst-mfg.com/product/pdf/eng/eXH.pdf https://www.jst-mfg.com/product/detail_e.php?series=277",
		pins: [
			{
				"name": "1",
				"side": "bottom",
				"label": "1",
				"type": "passive"
			},
			{
				"name": "2",
				"side": "bottom",
				"label": "2",
				"type": "passive"
			},
			{
				"name": "3",
				"side": "bottom",
				"label": "3",
				"type": "passive"
			},
			{
				"name": "4",
				"side": "bottom",
				"label": "4",
				"type": "passive"
			}
		],
		size: {
			"w": 7,
			"h": 5
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 70,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 36,
					"w": 3,
					"h": 14,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 6,
					"y": 8,
					"w": 58,
					"h": 30,
					"fill": "#EEF0EC",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 10,
					"y": 14,
					"w": 50,
					"h": 20,
					"fill": "#D6DAD2",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 17.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 27.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 37.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47.5,
					"y": 17,
					"w": 5,
					"h": 13,
					"fill": "#B9BEB5",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 8,
					"w": 10,
					"h": 5,
					"fill": "#D6DAD2",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 9.5,
					"w": 4,
					"h": 4,
					"fill": "#1B1F24",
					"radius": 2,
					"outline": false
				}
			]
		}
	},
	"../modules/l298n-module.json": {
		format: "circuitoon-module/1",
		id: "l298n-module",
		version: 1,
		name: "L298N dual H-bridge motor driver module (5V jumper fitted)",
		category: "Motors and actuators",
		source: "https://lastminuteengineers.com/l298n-dc-stepper-driver-arduino-tutorial/ https://randomnerdtutorials.com/esp32-dc-motor-l298n-motor-driver-control-speed-direction/",
		pins: [
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "OUT1",
				"side": "left",
				"type": "output"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "OUT2",
				"side": "left",
				"type": "output"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "OUT4",
				"side": "right",
				"type": "output"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "OUT3",
				"side": "right",
				"type": "output"
			},
			{
				"name": "+12V",
				"side": "bottom",
				"type": "power_in",
				"supply": "7V/7.4V/9V/12V"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "+5V",
				"side": "bottom",
				"type": "power_out",
				"supply": "5V"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "ENA",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "IN1",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "IN2",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "IN3",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "IN4",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "ENB",
				"side": "bottom",
				"type": "input"
			}
		],
		size: {
			"w": 17,
			"h": 17
		},
		electrical: {
			"model": "motor_driver",
			"params": {}
		},
		art: {
			"w": 170,
			"h": 170,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 170,
					"h": 170,
					"fill": "#C8322B",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 12,
					"h": 12,
					"fill": "#E9EDF0",
					"radius": 6,
					"outline": false
				},
				{
					"type": "rect",
					"x": 7,
					"y": 7,
					"w": 6,
					"h": 6,
					"fill": "#8A2A24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 154,
					"y": 4,
					"w": 12,
					"h": 12,
					"fill": "#E9EDF0",
					"radius": 6,
					"outline": false
				},
				{
					"type": "rect",
					"x": 157,
					"y": 7,
					"w": 6,
					"h": 6,
					"fill": "#8A2A24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 154,
					"w": 12,
					"h": 12,
					"fill": "#E9EDF0",
					"radius": 6,
					"outline": false
				},
				{
					"type": "rect",
					"x": 7,
					"y": 157,
					"w": 6,
					"h": 6,
					"fill": "#8A2A24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 154,
					"y": 154,
					"w": 12,
					"h": 12,
					"fill": "#E9EDF0",
					"radius": 6,
					"outline": false
				},
				{
					"type": "rect",
					"x": 157,
					"y": 157,
					"w": 6,
					"h": 6,
					"fill": "#8A2A24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 0,
					"w": 5,
					"h": 16,
					"fill": "#2B2F36",
					"outline": false
				},
				{
					"type": "rect",
					"x": 67,
					"y": 0,
					"w": 5,
					"h": 16,
					"fill": "#2B2F36",
					"outline": false
				},
				{
					"type": "rect",
					"x": 82,
					"y": 0,
					"w": 5,
					"h": 16,
					"fill": "#2B2F36",
					"outline": false
				},
				{
					"type": "rect",
					"x": 97,
					"y": 0,
					"w": 5,
					"h": 16,
					"fill": "#2B2F36",
					"outline": false
				},
				{
					"type": "rect",
					"x": 112,
					"y": 0,
					"w": 5,
					"h": 16,
					"fill": "#2B2F36",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48,
					"y": 10,
					"w": 74,
					"h": 26,
					"fill": "#2B2F36",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 52,
					"y": 36,
					"w": 66,
					"h": 18,
					"fill": "#3A3F47",
					"radius": 1,
					"label": "L298N",
					"labelColor": "#C9CED6",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 55,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 63.5,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 72,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 80.5,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 89,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 97.5,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 106,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 114.5,
					"y": 54,
					"w": 2.5,
					"h": 12,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 24,
					"y": 22,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 24,
					"y": 35,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 24,
					"y": 48,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 24,
					"y": 61,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 130,
					"y": 22,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 130,
					"y": 35,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 130,
					"y": 48,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 130,
					"y": 61,
					"w": 16,
					"h": 9,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "M7",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 46,
					"y": 70,
					"w": 28,
					"h": 28,
					"fill": "#B8BEC7",
					"radius": 14
				},
				{
					"type": "rect",
					"x": 52,
					"y": 76,
					"w": 16,
					"h": 16,
					"fill": "#8E96A1",
					"radius": 8,
					"outline": false
				},
				{
					"type": "rect",
					"x": 98,
					"y": 80,
					"w": 28,
					"h": 28,
					"fill": "#B8BEC7",
					"radius": 14
				},
				{
					"type": "rect",
					"x": 104,
					"y": 86,
					"w": 16,
					"h": 16,
					"fill": "#8E96A1",
					"radius": 8,
					"outline": false
				},
				{
					"type": "rect",
					"x": 84,
					"y": 62,
					"w": 22,
					"h": 16,
					"fill": "#2B2F36",
					"radius": 1,
					"label": "78M05",
					"labelColor": "#C9CED6",
					"labelSize": 4.5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 81,
					"w": 22,
					"h": 38,
					"fill": "#2F7FD0",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 7,
					"y": 84,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 89.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 7,
					"y": 104,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 109.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 146,
					"y": 81,
					"w": 22,
					"h": 38,
					"fill": "#2F7FD0",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 151,
					"y": 84,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 153,
					"y": 89.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 151,
					"y": 104,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 153,
					"y": 109.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 21,
					"y": 146,
					"w": 58,
					"h": 22,
					"fill": "#2F7FD0",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 24,
					"y": 151,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 29.25,
					"y": 153,
					"w": 1.5,
					"h": 8,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 151,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 49.25,
					"y": 153,
					"w": 1.5,
					"h": 8,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64,
					"y": 151,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 69.25,
					"y": 153,
					"w": 1.5,
					"h": 8,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 126,
					"w": 14,
					"h": 10,
					"fill": "#2B2F36",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 85,
					"y": 160,
					"w": 60,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 98.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 108.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 128.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 138.5,
					"y": 162.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 114,
					"w": 8,
					"h": 14,
					"fill": "#2B2F36",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 136,
					"y": 114,
					"w": 8,
					"h": 14,
					"fill": "#2B2F36",
					"radius": 1
				}
			]
		}
	},
	"../modules/lcd-st7796s-4in-spi-touch.json": {
		format: "circuitoon-module/1",
		id: "lcd-st7796s-4in-spi-touch",
		version: 1,
		name: "4.0\" SPI TFT 480x320 ST7796S (touch)",
		category: "Displays",
		source: "https://www.lcdwiki.com/4.0inch_SPI_Module_ST7796 https://www.lcdwiki.com/res/MSP4021/4.0inch_SPI_Schematic.pdf",
		pins: [
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "RESET",
				"side": "left",
				"type": "input"
			},
			{
				"name": "DC/RS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDI(MOSI)",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SCK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "LED",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDO(MISO)",
				"side": "left",
				"type": "output"
			},
			{
				"name": "T_CLK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_DIN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_DO",
				"side": "left",
				"type": "output"
			},
			{
				"name": "T_IRQ",
				"side": "left",
				"type": "output"
			},
			{
				"name": "SD_CS",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MOSI",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MISO",
				"side": "right",
				"type": "output"
			},
			{
				"name": "SD_SCK",
				"side": "right",
				"type": "input"
			}
		],
		size: {
			"w": 36,
			"h": 22
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 360,
			"h": 220,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 360,
					"h": 220,
					"fill": "#1E4F8A",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 5,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 347,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 207,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 347,
					"y": 207,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 2,
					"y": 45,
					"w": 8,
					"h": 140,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 350,
					"y": 95,
					"w": 8,
					"h": 40,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 352.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 352.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 352.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 352.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 8,
					"w": 254,
					"h": 204,
					"fill": "#B8C2CC",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 62,
					"y": 12,
					"w": 246,
					"h": 196,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 70,
					"y": 20,
					"w": 230,
					"h": 180,
					"fill": "#262C34",
					"outline": false,
					"label": "480x320 ST7796S",
					"labelColor": "#8FA3B8",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/led.json": {
		format: "circuitoon-module/1",
		id: "led",
		version: 1,
		name: "LED",
		category: "Indicators",
		pins: [{
			"name": "A",
			"label": "+",
			"side": "left",
			"type": "passive"
		}, {
			"name": "K",
			"label": "-",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "led",
			"terminals": {
				"anode": "A",
				"cathode": "K"
			},
			"params": {
				"color": { "default": "red" },
				"forwardVoltage": {
					"unit": "V",
					"default": 2
				},
				"maxCurrent": {
					"unit": "A",
					"default": .02
				}
			}
		},
		states: [
			"off",
			"lit",
			"burnt"
		],
		art: {
			"w": 40,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 26,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 11,
					"y": 4,
					"w": 18,
					"h": 24,
					"fill": "#FF6B6B",
					"radius": 9
				},
				{
					"type": "rect",
					"x": 9,
					"y": 25,
					"w": 22,
					"h": 6,
					"fill": "#C93C3C",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 14,
					"y": 8,
					"w": 4,
					"h": 9,
					"fill": "#FFC9C9",
					"radius": 2,
					"outline": false
				}
			]
		}
	},
	"../modules/level-shifter-bss138-4ch.json": {
		format: "circuitoon-module/1",
		id: "level-shifter-bss138-4ch",
		version: 1,
		name: "Logic level shifter 4 channel (BSS138, SparkFun layout)",
		category: "Communication",
		source: "https://learn.sparkfun.com/tutorials/bi-directional-logic-level-converter-hookup-guide/all https://cdn.sparkfun.com/assets/f/d/5/8/4/526842ae757b7f5c108b456b.png https://www.fredscave.com/interface/int-04logic-level-shifter.html",
		pins: [
			{
				"name": "HV1",
				"side": "top",
				"type": "io"
			},
			{
				"name": "HV2",
				"side": "top",
				"type": "io"
			},
			{
				"name": "HV",
				"side": "top",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "HV3",
				"side": "top",
				"type": "io"
			},
			{
				"name": "HV4",
				"side": "top",
				"type": "io"
			},
			{
				"name": "LV1",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "LV2",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "LV",
				"side": "bottom",
				"type": "power_in",
				"supply": "1V8/3V3"
			},
			{
				"name": "GND 2",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "LV3",
				"side": "bottom",
				"type": "io"
			},
			{
				"name": "LV4",
				"side": "bottom",
				"type": "io"
			}
		],
		internal: [["GND", "GND 2"]],
		size: {
			"w": 8,
			"h": 8
		},
		electrical: {
			"model": "level_shifter",
			"params": {}
		},
		art: {
			"w": 80,
			"h": 80,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 80,
					"h": 80,
					"fill": "#1E4F8A",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 16,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 46,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 66,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 16,
					"y": 69,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 71.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 69,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 71.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 69,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 71.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 46,
					"y": 69,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 71.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 69,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 71.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 66,
					"y": 69,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 71.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 11,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 14.75,
					"y": 45,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 10,
					"y": 35,
					"w": 12,
					"h": 10,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 27,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 34.5,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 30.75,
					"y": 45,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 35,
					"w": 12,
					"h": 10,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 43,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 50.5,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 46.75,
					"y": 45,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 35,
					"w": 12,
					"h": 10,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 59,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 66.5,
					"y": 32,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 62.75,
					"y": 45,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 35,
					"w": 12,
					"h": 10,
					"fill": "#1E2126",
					"radius": 1
				}
			]
		}
	},
	"../modules/lm2596-buck-module.json": {
		format: "circuitoon-module/1",
		id: "lm2596-buck-module",
		version: 1,
		name: "LM2596 buck converter module (adjustable)",
		category: "Power",
		source: "https://www.amazon.com/dp/B08NV3JCBC https://www.instructables.com/How-to-Use-DC-to-DC-Buck-Converter-LM2596/",
		pins: [
			{
				"name": "IN+",
				"side": "left",
				"type": "power_in",
				"supply": "5V/7.4V/9V/12V/24V"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "IN-",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "OUT+",
				"side": "right",
				"type": "power_out",
				"supply": "ADJ"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "OUT-",
				"side": "right",
				"type": "ground"
			}
		],
		internal: [["IN-", "OUT-"]],
		size: {
			"w": 17,
			"h": 9
		},
		electrical: {
			"model": "buck_converter",
			"params": { "voltage": {
				"unit": "V",
				"default": 5
			} }
		},
		art: {
			"w": 170,
			"h": 90,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 170,
					"h": 90,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 10,
					"y": 36,
					"w": 10,
					"h": 10,
					"fill": "#123356",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 150,
					"y": 36,
					"w": 10,
					"h": 10,
					"fill": "#123356",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 40,
					"y": 8,
					"w": 30,
					"h": 8,
					"fill": "#C9CED6",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 41.5,
					"y": 44,
					"w": 3,
					"h": 8,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 47.5,
					"y": 44,
					"w": 3,
					"h": 8,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 53.5,
					"y": 44,
					"w": 3,
					"h": 8,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 59.5,
					"y": 44,
					"w": 3,
					"h": 8,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 65.5,
					"y": 44,
					"w": 3,
					"h": 8,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 14,
					"w": 38,
					"h": 30,
					"fill": "#1E2126",
					"radius": 1,
					"label": "LM2596S",
					"labelColor": "#C9CED6",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 26,
					"y": 48,
					"w": 26,
					"h": 26,
					"fill": "#B8BEC7",
					"radius": 13
				},
				{
					"type": "rect",
					"x": 32,
					"y": 54,
					"w": 14,
					"h": 14,
					"fill": "#8E96A1",
					"radius": 7,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 60,
					"w": 20,
					"h": 10,
					"fill": "#1E2126",
					"radius": 1,
					"label": "SS34",
					"labelColor": "#C9CED6",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 82,
					"y": 6,
					"w": 34,
					"h": 16,
					"fill": "#3D6FD6",
					"radius": 2,
					"label": "103",
					"labelColor": "#FFFFFF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 108,
					"y": 9,
					"w": 6,
					"h": 6,
					"fill": "#D9A93B",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82,
					"y": 30,
					"w": 40,
					"h": 40,
					"fill": "#2B2F36",
					"radius": 8,
					"label": "470",
					"labelColor": "#C9CED6",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 128,
					"y": 46,
					"w": 26,
					"h": 26,
					"fill": "#B8BEC7",
					"radius": 13
				},
				{
					"type": "rect",
					"x": 134,
					"y": 52,
					"w": 14,
					"h": 14,
					"fill": "#8E96A1",
					"radius": 7,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 16,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 76,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 159,
					"y": 16,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 161.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 159,
					"y": 76,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 161.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/mcp23017-cjmcu-2317.json": {
		format: "circuitoon-module/1",
		id: "mcp23017-cjmcu-2317",
		version: 1,
		name: "MCP23017 breakout CJMCU-2317 (chip side; labels are on the back)",
		category: "Chips",
		source: "https://www.digitaltown.co.uk/MCP23017.php https://github.com/Warlib1975/Fritzing-parts/blob/master/CJMCU2317-MCP23017.fzpz https://easyeda.com/component/1ae26967fb344abea8ad222656426ee7 https://easyeda.com/component/25f3bfff95674c649e0437107b895aa7 https://shillehtek.com/blogs/shillehtek-product-manuals/mcp23017-i2c-16bit-io-port-expander-presoldered-manual https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23017-Data-Sheet-DS20001952.pdf",
		pins: [],
		holes: [
			{
				"name": "GND",
				"at": [[40, 10]],
				"holeStyle": "pad",
				"type": "ground"
			},
			{
				"name": "INTA",
				"label": "ITA",
				"at": [[40, 20]],
				"holeStyle": "pad",
				"type": "output"
			},
			{
				"name": "GPA0",
				"at": [[40, 30]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA1",
				"at": [[40, 40]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA2",
				"at": [[40, 50]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA3",
				"at": [[40, 60]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA4",
				"at": [[40, 70]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA5",
				"at": [[40, 80]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA6",
				"at": [[40, 90]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPA7",
				"at": [[40, 100]],
				"holeStyle": "pad",
				"type": "output"
			},
			{
				"name": "VCC",
				"at": [[50, 10]],
				"holeStyle": "pad",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "INTB",
				"label": "ITB",
				"at": [[50, 20]],
				"holeStyle": "pad",
				"type": "output"
			},
			{
				"name": "GPB0",
				"at": [[50, 30]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB1",
				"at": [[50, 40]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB2",
				"at": [[50, 50]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB3",
				"at": [[50, 60]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB4",
				"at": [[50, 70]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB5",
				"at": [[50, 80]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB6",
				"at": [[50, 90]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "GPB7",
				"at": [[50, 100]],
				"holeStyle": "pad",
				"type": "output"
			},
			{
				"name": "A2",
				"at": [[170, 10]],
				"holeStyle": "pad",
				"type": "input"
			},
			{
				"name": "A1",
				"at": [[170, 20]],
				"holeStyle": "pad",
				"type": "input"
			},
			{
				"name": "A0",
				"at": [[170, 30]],
				"holeStyle": "pad",
				"type": "input"
			},
			{
				"name": "RESET",
				"at": [[170, 40]],
				"holeStyle": "pad",
				"type": "input"
			},
			{
				"name": "NC",
				"label": "NC/SO",
				"at": [[170, 50]],
				"holeStyle": "pad",
				"type": "nc"
			},
			{
				"name": "NC 2",
				"label": "NC/CS",
				"at": [[170, 60]],
				"holeStyle": "pad",
				"type": "nc"
			},
			{
				"name": "SDA",
				"label": "SDA/SI",
				"at": [[170, 70]],
				"holeStyle": "pad",
				"type": "io"
			},
			{
				"name": "SCL",
				"label": "SCL/SCK",
				"at": [[170, 80]],
				"holeStyle": "pad",
				"type": "input"
			},
			{
				"name": "GND 2",
				"label": "GND",
				"at": [[170, 90]],
				"holeStyle": "pad",
				"type": "ground"
			},
			{
				"name": "VCC 2",
				"label": "VCC",
				"at": [[170, 100]],
				"holeStyle": "pad",
				"type": "power_in",
				"supply": "3V3/5V"
			}
		],
		internal: [["GND", "GND 2"], ["VCC", "VCC 2"]],
		size: {
			"w": 18,
			"h": 11
		},
		electrical: {
			"model": "io-expander",
			"params": {}
		},
		art: {
			"w": 180,
			"h": 110,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 180,
					"h": 110,
					"fill": "#2B2F36",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 34,
					"y": 3,
					"w": 22,
					"h": 104,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 164,
					"y": 3,
					"w": 12,
					"h": 104,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 88,
					"y": 34,
					"w": 36,
					"h": 4,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 88,
					"y": 64,
					"w": 36,
					"h": 4,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 84,
					"y": 38,
					"w": 44,
					"h": 26,
					"fill": "#1E2126",
					"radius": 1,
					"label": "MCP23017",
					"labelColor": "#C9CED6",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 98,
					"y": 16,
					"w": 16,
					"h": 9,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 92,
					"y": 74,
					"w": 6,
					"h": 9,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 102,
					"y": 74,
					"w": 6,
					"h": 9,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 112,
					"y": 74,
					"w": 6,
					"h": 9,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 84,
					"y": 92,
					"w": 44,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "CJMCU-2317",
					"labelColor": "#E8ECF1",
					"labelSize": 5.5
				},
				{
					"type": "rect",
					"x": 20,
					"y": 6,
					"w": 13,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GND",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 20,
					"y": 16,
					"w": 13,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "ITA",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 26,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA0",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 36,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA1",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 46,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA2",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 56,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA3",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 66,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA4",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 76,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA5",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 86,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA6",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 96,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPA7",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 6,
					"w": 13,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "VCC",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 16,
					"w": 13,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "ITB",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 26,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB0",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 36,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB1",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 46,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB2",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 56,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB3",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 66,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB4",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 76,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB5",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 86,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB6",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 57,
					"y": 96,
					"w": 17,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GPB7",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 154,
					"y": 6,
					"w": 9,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "A2",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 154,
					"y": 16,
					"w": 9,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "A1",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 154,
					"y": 26,
					"w": 9,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "A0",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 142,
					"y": 36,
					"w": 21,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "RESET",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 142,
					"y": 46,
					"w": 21,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "NC/SO",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 142,
					"y": 56,
					"w": 21,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "NC/CS",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 137,
					"y": 66,
					"w": 26,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "SDA/SI",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 133,
					"y": 76,
					"w": 30,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "SCL/SCK",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 150,
					"y": 86,
					"w": 13,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "GND",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 150,
					"y": 96,
					"w": 13,
					"h": 8,
					"fill": "#2B2F36",
					"outline": false,
					"label": "VCC",
					"labelColor": "#E8ECF1",
					"labelSize": 6.5
				}
			]
		}
	},
	"../modules/mcp23017-dip28.json": {
		format: "circuitoon-module/1",
		id: "mcp23017-dip28",
		version: 1,
		name: "MCP23017 I/O expander (DIP-28)",
		category: "Chips",
		source: "https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23017-Data-Sheet-DS20001952.pdf",
		pins: [
			{
				"name": "GPB0",
				"side": "left"
			},
			{
				"name": "GPB1",
				"side": "left"
			},
			{
				"name": "GPB2",
				"side": "left"
			},
			{
				"name": "GPB3",
				"side": "left"
			},
			{
				"name": "GPB4",
				"side": "left"
			},
			{
				"name": "GPB5",
				"side": "left"
			},
			{
				"name": "GPB6",
				"side": "left"
			},
			{
				"name": "GPB7",
				"side": "left",
				"type": "output"
			},
			{
				"name": "VDD",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "VSS",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "NC",
				"side": "left",
				"type": "nc"
			},
			{
				"name": "SCL",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "left",
				"type": "io"
			},
			{
				"name": "NC 2",
				"side": "left",
				"label": "NC",
				"type": "nc"
			},
			{
				"name": "GPA7",
				"side": "right",
				"type": "output"
			},
			{
				"name": "GPA6",
				"side": "right"
			},
			{
				"name": "GPA5",
				"side": "right"
			},
			{
				"name": "GPA4",
				"side": "right"
			},
			{
				"name": "GPA3",
				"side": "right"
			},
			{
				"name": "GPA2",
				"side": "right"
			},
			{
				"name": "GPA1",
				"side": "right"
			},
			{
				"name": "GPA0",
				"side": "right"
			},
			{
				"name": "INTA",
				"side": "right",
				"type": "output"
			},
			{
				"name": "INTB",
				"side": "right",
				"type": "output"
			},
			{
				"name": "RESET",
				"side": "right",
				"type": "input"
			},
			{
				"name": "A2",
				"side": "right",
				"type": "input"
			},
			{
				"name": "A1",
				"side": "right",
				"type": "input"
			},
			{
				"name": "A0",
				"side": "right",
				"type": "input"
			}
		],
		size: {
			"w": 10,
			"h": 19
		},
		electrical: {
			"model": "io-expander",
			"params": {}
		},
		art: {
			"w": 100,
			"h": 190,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 100,
					"h": 190,
					"fill": "#1E2126",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 1,
					"y": 28,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 28,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 38,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 38,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 48,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 48,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 58,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 58,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 68,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 68,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 78,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 78,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 88,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 88,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 98,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 98,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 108,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 108,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 118,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 118,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 128,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 128,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 138,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 138,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 148,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 148,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 158,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 158,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 2,
					"w": 16,
					"h": 8,
					"fill": "#3A3F47",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 13,
					"y": 11,
					"w": 5,
					"h": 5,
					"fill": "#3A3F47",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 15,
					"y": 170,
					"w": 70,
					"h": 12,
					"fill": "#1E2126",
					"outline": false,
					"label": "MCP23017",
					"labelColor": "#C9CED6",
					"labelSize": 7
				}
			]
		}
	},
	"../modules/mcp23018-dip28.json": {
		format: "circuitoon-module/1",
		id: "mcp23018-dip28",
		version: 1,
		name: "MCP23018 I/O expander (DIP-28)",
		category: "Chips",
		source: "https://ww1.microchip.com/downloads/aemDocuments/documents/APID/ProductDocuments/DataSheets/MCP23018-Data-Sheet-DS20002103.pdf",
		pins: [
			{
				"name": "VSS",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "NC",
				"side": "left",
				"type": "nc"
			},
			{
				"name": "GPB0",
				"side": "left"
			},
			{
				"name": "GPB1",
				"side": "left"
			},
			{
				"name": "GPB2",
				"side": "left"
			},
			{
				"name": "GPB3",
				"side": "left"
			},
			{
				"name": "GPB4",
				"side": "left"
			},
			{
				"name": "GPB5",
				"side": "left"
			},
			{
				"name": "GPB6",
				"side": "left"
			},
			{
				"name": "GPB7",
				"side": "left"
			},
			{
				"name": "VDD",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "SCL",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "left",
				"type": "io"
			},
			{
				"name": "NC 2",
				"side": "left",
				"label": "NC",
				"type": "nc"
			},
			{
				"name": "NC 4",
				"side": "right",
				"label": "NC",
				"type": "nc"
			},
			{
				"name": "GPA7",
				"side": "right"
			},
			{
				"name": "GPA6",
				"side": "right"
			},
			{
				"name": "GPA5",
				"side": "right"
			},
			{
				"name": "GPA4",
				"side": "right"
			},
			{
				"name": "GPA3",
				"side": "right"
			},
			{
				"name": "GPA2",
				"side": "right"
			},
			{
				"name": "GPA1",
				"side": "right"
			},
			{
				"name": "GPA0",
				"side": "right"
			},
			{
				"name": "INTA",
				"side": "right",
				"type": "output"
			},
			{
				"name": "INTB",
				"side": "right",
				"type": "output"
			},
			{
				"name": "NC 3",
				"side": "right",
				"label": "NC",
				"type": "nc"
			},
			{
				"name": "RESET",
				"side": "right",
				"type": "input"
			},
			{
				"name": "ADDR",
				"side": "right",
				"type": "input"
			}
		],
		size: {
			"w": 10,
			"h": 19
		},
		electrical: {
			"model": "io-expander",
			"params": {}
		},
		art: {
			"w": 100,
			"h": 190,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 100,
					"h": 190,
					"fill": "#1E2126",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 1,
					"y": 28,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 28,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 38,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 38,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 48,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 48,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 58,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 58,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 68,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 68,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 78,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 78,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 88,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 88,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 98,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 98,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 108,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 108,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 118,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 118,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 128,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 128,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 138,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 138,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 148,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 148,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 158,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 91,
					"y": 158,
					"w": 8,
					"h": 4,
					"fill": "#C9CED6",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 2,
					"w": 16,
					"h": 8,
					"fill": "#3A3F47",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 13,
					"y": 11,
					"w": 5,
					"h": 5,
					"fill": "#3A3F47",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 15,
					"y": 170,
					"w": 70,
					"h": 12,
					"fill": "#1E2126",
					"outline": false,
					"label": "MCP23018",
					"labelColor": "#C9CED6",
					"labelSize": 7
				}
			]
		}
	},
	"../modules/microsd-spi-3v3.json": {
		format: "circuitoon-module/1",
		id: "microsd-spi-3v3",
		version: 1,
		name: "microSD card module (SPI, 3.3 V only: 3V3 CS MOSI CLK MISO GND)",
		category: "Communication",
		source: "https://protosupplies.com/product/microsd-card-module/ https://www.amazon.com/dp/B0H67347LH",
		pins: [
			{
				"name": "3V3",
				"side": "left",
				"type": "power_in",
				"supply": "3V3"
			},
			{
				"name": "CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "MOSI",
				"side": "left",
				"type": "input"
			},
			{
				"name": "CLK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "MISO",
				"side": "left",
				"type": "output"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			}
		],
		size: {
			"w": 13,
			"h": 10
		},
		electrical: {
			"model": "storage",
			"params": {}
		},
		art: {
			"w": 130,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 130,
					"h": 100,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 2,
					"y": 25,
					"w": 8,
					"h": 60,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 38,
					"w": 8,
					"h": 4,
					"fill": "#2B2F36",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 48,
					"w": 8,
					"h": 4,
					"fill": "#2B2F36",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 58,
					"w": 8,
					"h": 4,
					"fill": "#2B2F36",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 42,
					"y": 68,
					"w": 8,
					"h": 4,
					"fill": "#2B2F36",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 19,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 27.57142857142857,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 36.14285714285714,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 44.714285714285715,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 53.285714285714285,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 61.857142857142854,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 70.42857142857143,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 79,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 62,
					"y": 12,
					"w": 60,
					"h": 76,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 68,
					"y": 18,
					"w": 48,
					"h": 64,
					"fill": "#AEB5BF",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 112,
					"y": 40,
					"w": 8,
					"h": 20,
					"fill": "#1B1F24",
					"radius": 1
				}
			]
		}
	},
	"../modules/microsd-spi-5v.json": {
		format: "circuitoon-module/1",
		id: "microsd-spi-5v",
		version: 1,
		name: "microSD card module (SPI, 5 V with level shifter: GND VCC MISO MOSI SCK CS)",
		category: "Communication",
		source: "https://www.amazon.com/dp/B0B779R5TZ https://envistiamall.com/blogs/learn/micro-sd-card-spi-module-user-guide",
		pins: [
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "MISO",
				"side": "left",
				"type": "output"
			},
			{
				"name": "MOSI",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SCK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "CS",
				"side": "left",
				"type": "input"
			}
		],
		size: {
			"w": 18,
			"h": 10
		},
		electrical: {
			"model": "storage",
			"params": {}
		},
		art: {
			"w": 180,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 180,
					"h": 100,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 167,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 87,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 167,
					"y": 87,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 2,
					"y": 25,
					"w": 8,
					"h": 60,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 8,
					"w": 30,
					"h": 8,
					"fill": "#C9CED6",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 48,
					"y": 14,
					"w": 38,
					"h": 26,
					"fill": "#1E2126",
					"radius": 1,
					"label": "AMS1117",
					"labelColor": "#C9CED6",
					"labelSize": 5.5
				},
				{
					"type": "rect",
					"x": 50,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 55,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 60,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 65,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 70,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 75,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 80,
					"y": 55,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 50,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 55,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 60,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 65,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 70,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 75,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 80,
					"y": 78,
					"w": 2.5,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48,
					"y": 58,
					"w": 38,
					"h": 20,
					"fill": "#1E2126",
					"radius": 1,
					"label": "LVC125A",
					"labelColor": "#C9CED6",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 100,
					"y": 19,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 27.57142857142857,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 36.14285714285714,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 44.714285714285715,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 53.285714285714285,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 61.857142857142854,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 70.42857142857143,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 79,
					"w": 8,
					"h": 2,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 106,
					"y": 12,
					"w": 62,
					"h": 76,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 112,
					"y": 18,
					"w": 50,
					"h": 64,
					"fill": "#AEB5BF",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 158,
					"y": 40,
					"w": 8,
					"h": 20,
					"fill": "#1B1F24",
					"radius": 1
				}
			]
		}
	},
	"../modules/oled-sh1106-13-i2c-vcc-gnd.json": {
		format: "circuitoon-module/1",
		id: "oled-sh1106-13-i2c-vcc-gnd",
		version: 1,
		name: "1.3\" OLED 128x64 SH1106 (I2C, VCC GND SCL SDA)",
		category: "Displays",
		source: "https://www.lcdwiki.com/1.3inch_IIC_OLED_Module_SKU:MC130VX https://electropeak.com/learn/interfacing-sh1106-1-3-inch-i2c-oled-128x64-display-with-arduino/",
		pins: [
			{
				"name": "VCC",
				"side": "top",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "SCL",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "top",
				"type": "io"
			}
		],
		size: {
			"w": 15,
			"h": 15
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 150,
			"h": 150,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 150,
					"h": 150,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 137,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 137,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 137,
					"y": 137,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 55,
					"y": 2,
					"w": 40,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 32,
					"w": 140,
					"h": 98,
					"fill": "#101418",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 12,
					"y": 39,
					"w": 69.30000000000001,
					"h": 6,
					"fill": "#F2C94C",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 50,
					"w": 126,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 59,
					"w": 88.19999999999999,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 57,
					"y": 130,
					"w": 36,
					"h": 10,
					"fill": "#C8742B",
					"radius": 1
				}
			]
		}
	},
	"../modules/oled-sh1106-13-i2c.json": {
		format: "circuitoon-module/1",
		id: "oled-sh1106-13-i2c",
		version: 1,
		name: "1.3\" OLED 128x64 SH1106 (I2C, GND VCC SCL SDA)",
		category: "Displays",
		source: "https://www.lcdwiki.com/1.3inch_IIC_OLED_Module_SKU:MC130GX https://shillehtek.com/blogs/shillehtek-product-manuals/1-3-i2c-white-oled-display-module-4-pin-sh1106-manual",
		pins: [
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "VCC",
				"side": "top",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "SCL",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "top",
				"type": "io"
			}
		],
		size: {
			"w": 15,
			"h": 15
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 150,
			"h": 150,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 150,
					"h": 150,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 137,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 137,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 137,
					"y": 137,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 55,
					"y": 2,
					"w": 40,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 32,
					"w": 140,
					"h": 98,
					"fill": "#101418",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 12,
					"y": 39,
					"w": 69.30000000000001,
					"h": 6,
					"fill": "#F2C94C",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 50,
					"w": 126,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 59,
					"w": 88.19999999999999,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 57,
					"y": 130,
					"w": 36,
					"h": 10,
					"fill": "#C8742B",
					"radius": 1
				}
			]
		}
	},
	"../modules/oled-ssd1306-091-i2c.json": {
		format: "circuitoon-module/1",
		id: "oled-ssd1306-091-i2c",
		version: 1,
		name: "0.91\" OLED 128x32 SSD1306 (I2C)",
		category: "Displays",
		source: "https://www.lcdwiki.com/0.91inch_IIC_OLED_Module_SSD1306_SKU:MC091GX https://www.lcdwiki.com/res/MC091GX/0.91inch_IIC_OLED_Module_MC091GX_User_Manual_EN.pdf",
		pins: [
			{
				"name": "SDA",
				"side": "left",
				"type": "io"
			},
			{
				"name": "SCL",
				"side": "left",
				"type": "input"
			},
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			}
		],
		size: {
			"w": 22,
			"h": 7
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 220,
			"h": 70,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 220,
					"h": 70,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 2,
					"y": 15,
					"w": 8,
					"h": 40,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 6,
					"w": 160,
					"h": 58,
					"fill": "#101418",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 44,
					"y": 16,
					"w": 86.39999999999999,
					"h": 6,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 28,
					"w": 115.2,
					"h": 6,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 44,
					"y": 40,
					"w": 64.8,
					"h": 6,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 196,
					"y": 12,
					"w": 14,
					"h": 46,
					"fill": "#C8742B",
					"radius": 1
				}
			]
		}
	},
	"../modules/oled-ssd1306-096-i2c-vcc-gnd.json": {
		format: "circuitoon-module/1",
		id: "oled-ssd1306-096-i2c-vcc-gnd",
		version: 1,
		name: "0.96\" OLED 128x64 SSD1306 (I2C, VCC GND SCL SDA)",
		category: "Displays",
		source: "https://lcdwiki.com/0.96inch_OLED_Module_(IIC-4P_SKU:MC096VX) https://www.addicore.com/products/oled-display-128x64-0-96in-monochrome",
		pins: [
			{
				"name": "VCC",
				"side": "top",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "SCL",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "top",
				"type": "io"
			}
		],
		size: {
			"w": 13,
			"h": 13
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 130,
			"h": 130,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 130,
					"h": 130,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 117,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 117,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 117,
					"y": 117,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 45,
					"y": 2,
					"w": 40,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 32,
					"w": 120,
					"h": 78,
					"fill": "#101418",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 12,
					"y": 39,
					"w": 58.300000000000004,
					"h": 6,
					"fill": "#F2C94C",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 50,
					"w": 106,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 59,
					"w": 74.19999999999999,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 110,
					"w": 36,
					"h": 10,
					"fill": "#C8742B",
					"radius": 1
				}
			]
		}
	},
	"../modules/oled-ssd1306-096-i2c.json": {
		format: "circuitoon-module/1",
		id: "oled-ssd1306-096-i2c",
		version: 1,
		name: "0.96\" OLED 128x64 SSD1306 (I2C, GND VCC SCL SDA)",
		category: "Displays",
		source: "https://www.lcdwiki.com/0.96inch_OLED_Module_MC096GX https://www.addicore.com/products/oled-display-128x64-0-96in-monochrome",
		pins: [
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "VCC",
				"side": "top",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "SCL",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "top",
				"type": "io"
			}
		],
		size: {
			"w": 13,
			"h": 13
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 130,
			"h": 130,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 130,
					"h": 130,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 117,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 117,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 117,
					"y": 117,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 45,
					"y": 2,
					"w": 40,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 32,
					"w": 120,
					"h": 78,
					"fill": "#101418",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 12,
					"y": 39,
					"w": 58.300000000000004,
					"h": 6,
					"fill": "#F2C94C",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 50,
					"w": 106,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 59,
					"w": 74.19999999999999,
					"h": 5,
					"fill": "#7FC8F8",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 110,
					"w": 36,
					"h": 10,
					"fill": "#C8742B",
					"radius": 1
				}
			]
		}
	},
	"../modules/pir-hc-sr501.json": {
		format: "circuitoon-module/1",
		id: "pir-hc-sr501",
		version: 1,
		name: "HC-SR501 PIR motion sensor (dome side: GND OUT VCC)",
		category: "Sensors",
		source: "https://protosupplies.com/product/hc-sr501-pir-motion-sensing-module/ https://lastminuteengineers.com/pir-sensor-arduino-tutorial/ http://www.handsontec.com/dataspecs/SR501%20Motion%20Sensor.pdf",
		pins: [
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"name": "OUT",
				"side": "bottom",
				"type": "output"
			},
			{
				"name": "VCC",
				"side": "bottom",
				"type": "power_in",
				"supply": "5V/9V/12V"
			}
		],
		size: {
			"w": 12,
			"h": 12
		},
		electrical: {
			"model": "sensor",
			"params": {}
		},
		art: {
			"w": 120,
			"h": 120,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 8,
					"w": 120,
					"h": 112,
					"fill": "#2F9E6E",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 8,
					"y": 0,
					"w": 8,
					"h": 12,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 9,
					"y": 1,
					"w": 6,
					"h": 4,
					"fill": "#F4B400",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 1,
					"w": 16,
					"h": 10,
					"fill": "#F08A24",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 70,
					"y": 1,
					"w": 16,
					"h": 10,
					"fill": "#F08A24",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 6,
					"y": 52,
					"w": 8,
					"h": 8,
					"fill": "#E9EDF0",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 106,
					"y": 52,
					"w": 8,
					"h": 8,
					"fill": "#E9EDF0",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 22,
					"y": 14,
					"w": 76,
					"h": 76,
					"fill": "#DDE2E7",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 26,
					"y": 18,
					"w": 68,
					"h": 68,
					"fill": "#F4F6F8",
					"radius": 34
				},
				{
					"type": "rect",
					"x": 38,
					"y": 28,
					"w": 14,
					"h": 10,
					"fill": "#FFFFFF",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 45,
					"y": 110,
					"w": 30,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 112.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 112.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 112.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/potentiometer-panel-10k.json": {
		format: "circuitoon-module/1",
		id: "potentiometer-panel-10k",
		version: 1,
		name: "Panel potentiometer 10 k (WH148, with knob)",
		category: "Passives",
		source: "https://rhtecp.com/upload/202205/23/WH148.pdf https://www.handsontec.com/dataspecs/passive/WH148%20Pot-meter.pdf",
		pins: [
			{
				"name": "1",
				"side": "bottom",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "W",
				"side": "bottom",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "3",
				"side": "bottom",
				"type": "passive"
			}
		],
		size: {
			"w": 8,
			"h": 9
		},
		electrical: {
			"model": "potentiometer",
			"terminals": {
				"a": "1",
				"wiper": "W",
				"b": "3"
			},
			"params": { "resistance": {
				"unit": "ohm",
				"default": 1e4
			} }
		},
		art: {
			"w": 80,
			"h": 90,
			"shapes": [
				{
					"type": "rect",
					"x": 18,
					"y": 68,
					"w": 4,
					"h": 22,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38,
					"y": 68,
					"w": 4,
					"h": 22,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 68,
					"w": 4,
					"h": 22,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 10,
					"y": 2,
					"w": 60,
					"h": 60,
					"fill": "#B8BEC7",
					"radius": 30
				},
				{
					"type": "rect",
					"x": 18,
					"y": 10,
					"w": 44,
					"h": 44,
					"fill": "#2B2F36",
					"radius": 22
				},
				{
					"type": "rect",
					"x": 24,
					"y": 16,
					"w": 32,
					"h": 32,
					"fill": "#3A3F47",
					"radius": 16,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 14,
					"w": 3,
					"h": 16,
					"fill": "#FFFFFF",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 58,
					"w": 56,
					"h": 12,
					"fill": "#C8742B",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 17,
					"y": 61,
					"w": 6,
					"h": 6,
					"fill": "#D5DAE1",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 37,
					"y": 61,
					"w": 6,
					"h": 6,
					"fill": "#D5DAE1",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 57,
					"y": 61,
					"w": 6,
					"h": 6,
					"fill": "#D5DAE1",
					"radius": 3,
					"outline": false
				}
			]
		}
	},
	"../modules/potentiometer.json": {
		format: "circuitoon-module/1",
		id: "potentiometer",
		version: 1,
		name: "Potentiometer",
		category: "Passives",
		pins: [
			{
				"name": "1",
				"side": "bottom",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "W",
				"label": "W",
				"side": "bottom",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "bottom"
			},
			{
				"name": "3",
				"side": "bottom",
				"type": "passive"
			}
		],
		electrical: {
			"model": "potentiometer",
			"terminals": {
				"a": "1",
				"wiper": "W",
				"b": "3"
			},
			"params": { "resistance": {
				"unit": "ohm",
				"default": 1e4
			} }
		},
		art: {
			"w": 70,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 30,
					"w": 60,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 8,
					"y": 4,
					"w": 54,
					"h": 28,
					"fill": "#3D6FD6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 32,
					"y": 8,
					"w": 6,
					"h": 8,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 18,
					"y": 30,
					"w": 4,
					"h": 20,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 38,
					"y": 30,
					"w": 4,
					"h": 20,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 58,
					"y": 30,
					"w": 4,
					"h": 20,
					"fill": "#B8BEC7",
					"radius": 1.5
				}
			]
		}
	},
	"../modules/power-rail-strip.json": {
		format: "circuitoon-module/1",
		id: "power-rail-strip",
		version: 1,
		name: "Power rail strip",
		category: "Prototyping",
		pins: [],
		holes: [{
			"name": "+",
			"label": "+ rail",
			"at": [
				[20, 20],
				[30, 20],
				[40, 20],
				[50, 20],
				[60, 20],
				[80, 20],
				[90, 20],
				[100, 20],
				[110, 20],
				[120, 20],
				[140, 20],
				[150, 20],
				[160, 20],
				[170, 20],
				[180, 20],
				[200, 20],
				[210, 20],
				[220, 20],
				[230, 20],
				[240, 20],
				[260, 20],
				[270, 20],
				[280, 20],
				[290, 20],
				[300, 20]
			],
			"rail": "+"
		}, {
			"name": "-",
			"label": "- rail",
			"at": [
				[20, 30],
				[30, 30],
				[40, 30],
				[50, 30],
				[60, 30],
				[80, 30],
				[90, 30],
				[100, 30],
				[110, 30],
				[120, 30],
				[140, 30],
				[150, 30],
				[160, 30],
				[170, 30],
				[180, 30],
				[200, 30],
				[210, 30],
				[220, 30],
				[230, 30],
				[240, 30],
				[260, 30],
				[270, 30],
				[280, 30],
				[290, 30],
				[300, 30]
			],
			"rail": "-"
		}],
		obstacle: false,
		size: {
			"w": 32,
			"h": 5
		},
		art: {
			"w": 320,
			"h": 50,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 320,
					"h": 50,
					"fill": "#FFFFFF",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 14,
					"y": 8,
					"w": 292,
					"h": 2,
					"fill": "#E0483E",
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 40,
					"w": 292,
					"h": 2,
					"fill": "#3D6FD6",
					"outline": false
				}
			]
		}
	},
	"../modules/push-button.json": {
		format: "circuitoon-module/1",
		id: "push-button",
		version: 1,
		name: "Push button",
		category: "Switches",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "switch",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": { "normallyOpen": { "default": true } }
		},
		states: ["released", "pressed"],
		art: {
			"w": 50,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 38,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 9,
					"y": 6,
					"w": 32,
					"h": 28,
					"fill": "#3A3F47",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 16,
					"y": 12,
					"w": 18,
					"h": 16,
					"fill": "#E0483E",
					"radius": 8
				}
			]
		}
	},
	"../modules/relay-module-1ch-5v.json": {
		format: "circuitoon-module/1",
		id: "relay-module-1ch-5v",
		version: 1,
		name: "Relay module 1 channel 5 V (SRD-05VDC, high/low trigger jumper)",
		category: "Motors and actuators",
		source: "https://www.amazon.com/dp/B00LW15A4W https://konnected.io/products/1-channel-5v-relay-module-with-high-low-level-trigger",
		pins: [
			{
				"name": "NO",
				"side": "left",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "COM",
				"side": "left",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "NC",
				"side": "left",
				"type": "passive"
			},
			{
				"name": "IN",
				"side": "right",
				"type": "input"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "DC-",
				"side": "right",
				"type": "ground"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "DC+",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			}
		],
		size: {
			"w": 20,
			"h": 10
		},
		electrical: {
			"model": "relay",
			"params": {}
		},
		art: {
			"w": 200,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 200,
					"h": 100,
					"fill": "#C8322B",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 10,
					"h": 10,
					"fill": "#E9EDF0",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 6.5,
					"y": 6.5,
					"w": 5,
					"h": 5,
					"fill": "#8A2A24",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 86,
					"w": 10,
					"h": 10,
					"fill": "#E9EDF0",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 6.5,
					"y": 88.5,
					"w": 5,
					"h": 5,
					"fill": "#8A2A24",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 186,
					"y": 4,
					"w": 10,
					"h": 10,
					"fill": "#E9EDF0",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 188.5,
					"y": 6.5,
					"w": 5,
					"h": 5,
					"fill": "#8A2A24",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 186,
					"y": 86,
					"w": 10,
					"h": 10,
					"fill": "#E9EDF0",
					"radius": 5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 188.5,
					"y": 88.5,
					"w": 5,
					"h": 5,
					"fill": "#8A2A24",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 2,
					"y": 21,
					"w": 22,
					"h": 58,
					"fill": "#2F7FD0",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 7,
					"y": 24,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 29.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 7,
					"y": 44,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 49.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 7,
					"y": 64,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 9,
					"y": 69.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 176,
					"y": 21,
					"w": 22,
					"h": 58,
					"fill": "#2F7FD0",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 181,
					"y": 24,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 183,
					"y": 29.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 181,
					"y": 44,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 183,
					"y": 49.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 181,
					"y": 64,
					"w": 12,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 183,
					"y": 69.25,
					"w": 8,
					"h": 1.5,
					"fill": "#6B727C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 10,
					"w": 84,
					"h": 72,
					"fill": "#2B5FB8",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 40,
					"y": 20,
					"w": 72,
					"h": 12,
					"fill": "#2B5FB8",
					"outline": false,
					"label": "SONGLE",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 40,
					"y": 50,
					"w": 72,
					"h": 12,
					"fill": "#2B5FB8",
					"outline": false,
					"label": "SRD-05VDC-SL-C",
					"labelColor": "#FFFFFF",
					"labelSize": 6
				},
				{
					"type": "rect",
					"x": 128,
					"y": 12,
					"w": 16,
					"h": 22,
					"fill": "#2B2F36",
					"radius": 2,
					"label": "L H",
					"labelColor": "#FFFFFF",
					"labelSize": 4.5
				},
				{
					"type": "rect",
					"x": 130,
					"y": 40,
					"w": 12,
					"h": 10,
					"fill": "#F4F6F8",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 150,
					"y": 20,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 150,
					"y": 44,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 130,
					"y": 58,
					"w": 12,
					"h": 8,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 150,
					"y": 70,
					"w": 6,
					"h": 5,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 128,
					"y": 74,
					"w": 6,
					"h": 5,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 86,
					"w": 120,
					"h": 10,
					"fill": "#C8322B",
					"outline": false,
					"label": "high/low level trigger",
					"labelColor": "#FFFFFF",
					"labelSize": 5
				}
			]
		}
	},
	"../modules/resistor-half-watt.json": {
		format: "circuitoon-module/1",
		id: "resistor-half-watt",
		version: 1,
		name: "Resistor (1/2 W)",
		category: "Passives",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "resistor",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": { "resistance": {
				"unit": "ohm",
				"default": 1e3
			} }
		},
		art: {
			"w": 80,
			"h": 60,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 28.5,
					"w": 16,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 64,
					"y": 28.5,
					"w": 16,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 14,
					"y": 19,
					"w": 52,
					"h": 22,
					"fill": "#F1D9A7",
					"radius": 10
				},
				{
					"type": "rect",
					"x": 24,
					"y": 20,
					"w": 5,
					"h": 20,
					"fill": "#8B5A2B",
					"outline": false,
					"band": 1
				},
				{
					"type": "rect",
					"x": 33,
					"y": 20,
					"w": 5,
					"h": 20,
					"fill": "#1B1B1B",
					"outline": false,
					"band": 2
				},
				{
					"type": "rect",
					"x": 42,
					"y": 20,
					"w": 5,
					"h": 20,
					"fill": "#D8413A",
					"outline": false,
					"band": 3
				},
				{
					"type": "rect",
					"x": 56,
					"y": 20,
					"w": 5,
					"h": 20,
					"fill": "#E0B43C",
					"outline": false,
					"band": 4
				}
			]
		}
	},
	"../modules/resistor.json": {
		format: "circuitoon-module/1",
		id: "resistor",
		version: 1,
		name: "Resistor (1/4 W)",
		category: "Passives",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "resistor",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": { "resistance": {
				"unit": "ohm",
				"default": 1e3
			} }
		},
		art: {
			"w": 60,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 48,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 8,
					"y": 12,
					"w": 44,
					"h": 16,
					"fill": "#F1D9A7",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 16,
					"y": 13,
					"w": 4,
					"h": 14,
					"fill": "#8B5A2B",
					"outline": false,
					"band": 1
				},
				{
					"type": "rect",
					"x": 23,
					"y": 13,
					"w": 4,
					"h": 14,
					"fill": "#1B1B1B",
					"outline": false,
					"band": 2
				},
				{
					"type": "rect",
					"x": 30,
					"y": 13,
					"w": 4,
					"h": 14,
					"fill": "#D8413A",
					"outline": false,
					"band": 3
				},
				{
					"type": "rect",
					"x": 41,
					"y": 13,
					"w": 4,
					"h": 14,
					"fill": "#E0B43C",
					"outline": false,
					"band": 4
				}
			]
		}
	},
	"../modules/rfm95-lora-breakout.json": {
		format: "circuitoon-module/1",
		id: "rfm95-lora-breakout",
		version: 1,
		name: "LoRa RFM95W breakout (Adafruit 3072, 868/915 MHz)",
		category: "Communication",
		source: "https://learn.adafruit.com/adafruit-rfm69hcw-and-rfm96-rfm95-rfm98-lora-packet-padio-breakouts/pinouts https://www.adafruit.com/product/3072 https://cdn-shop.adafruit.com/970x728/3072-14.jpg",
		pins: [
			{
				"name": "G1",
				"side": "top",
				"type": "io"
			},
			{
				"name": "G2",
				"side": "top",
				"type": "io"
			},
			{
				"name": "G3",
				"side": "top",
				"type": "io"
			},
			{
				"name": "G4",
				"side": "top",
				"type": "io"
			},
			{
				"name": "G5",
				"side": "top",
				"type": "io"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"name": "ANT",
				"side": "top",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "top"
			},
			{
				"name": "VIN",
				"side": "bottom",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"name": "EN",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "G0",
				"side": "bottom",
				"type": "output"
			},
			{
				"name": "SCK",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "MISO",
				"side": "bottom",
				"type": "output"
			},
			{
				"name": "MOSI",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "CS",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "RST",
				"side": "bottom",
				"type": "input"
			}
		],
		size: {
			"w": 11,
			"h": 12
		},
		electrical: {
			"model": "radio",
			"params": {}
		},
		art: {
			"w": 110,
			"h": 120,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 110,
					"h": 120,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 46,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 3,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 5.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 16,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 46,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 66,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 76,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 96,
					"y": 109,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 98.5,
					"y": 111.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 77,
					"y": 3,
					"w": 9,
					"h": 14,
					"fill": "#E0B43C",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 94,
					"y": 3,
					"w": 9,
					"h": 14,
					"fill": "#E0B43C",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 16,
					"w": 8,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 43,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 50.5,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 65.5,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 73,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 80.5,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 88,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 95.5,
					"y": 26,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 43,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 50.5,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 65.5,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 73,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 80.5,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 88,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 95.5,
					"y": 86,
					"w": 4,
					"h": 5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 40,
					"y": 30,
					"w": 64,
					"h": 56,
					"fill": "#C9CED6",
					"radius": 2,
					"label": "RFM95W",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 12,
					"y": 34,
					"w": 20,
					"h": 24,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 12,
					"y": 66,
					"w": 14,
					"h": 10,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 12,
					"y": 82,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				}
			]
		}
	},
	"../modules/rocker-switch-kcd1.json": {
		format: "circuitoon-module/1",
		id: "rocker-switch-kcd1",
		version: 1,
		name: "Rocker switch KCD1-101 (SPST, 2 pin)",
		category: "Switches",
		source: "https://www.chinadaier.com/kcd1-2-101-spst-rocker-switch/ https://envistiamall.com/products/rocker-switch-2-pin-on-off-spst-21x15mm-black-kcd1-101",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		electrical: {
			"model": "switch",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": {}
		},
		states: ["off", "on"],
		art: {
			"w": 70,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 56,
					"y": 18.5,
					"w": 14,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 2,
					"w": 50,
					"h": 36,
					"fill": "#2B2F36",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 16,
					"y": 7,
					"w": 19,
					"h": 26,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "I",
					"labelColor": "#C9CED6",
					"labelSize": 10
				},
				{
					"type": "rect",
					"x": 35,
					"y": 7,
					"w": 19,
					"h": 26,
					"fill": "#3A3F47",
					"radius": 2,
					"label": "O",
					"labelColor": "#C9CED6",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/rpi-pico-2-w.json": {
		format: "circuitoon-module/1",
		id: "rpi-pico-2-w",
		version: 1,
		name: "Raspberry Pi Pico 2 W",
		category: "Microcontrollers",
		source: "https://datasheets.raspberrypi.com/picow/pico-2-w-datasheet.pdf https://datasheets.raspberrypi.com/picow/pico-2-w-pinout.pdf",
		pins: [
			{
				"name": "GP0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "GP2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP11",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 4",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "VBUS",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "VSYS",
				"side": "right",
				"type": "power_in",
				"supply": "5V/3.7V/3V3"
			},
			{
				"name": "GND 5",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "3V3_EN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "3V3(OUT)",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "ADC_VREF",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP28/ADC2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "AGND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "GP27/ADC1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP26/ADC0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RUN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 6",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP20",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 7",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP17",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "SWCLK",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "GND DBG",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "SWDIO",
				"side": "bottom"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3",
			"GND 4",
			"GND 5",
			"AGND",
			"GND 6",
			"GND 7",
			"GND DBG"
		]],
		size: {
			"w": 12,
			"h": 23
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "VBUS",
				"volts": 5,
				"via": "USB"
			}, {
				"pin": "VSYS",
				"volts": 5,
				"via": "USB",
				"diode": true,
				"max": 5.5
			}]
		},
		art: /* @__PURE__ */ JSON.parse("{\"w\":120,\"h\":230,\"pinLabels\":\"inside\",\"shapes\":[{\"type\":\"rect\",\"x\":0,\"y\":0,\"w\":120,\"h\":230,\"fill\":\"#2F9E6E\",\"radius\":4},{\"type\":\"rect\",\"x\":0,\"y\":16.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":18.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":26.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":28.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":36.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":38.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":46.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":48.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":56.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":58.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":66.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":68.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":76.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":78.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":86.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":88.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":96.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":98.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":106.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":108.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":116.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":118.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":126.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":128.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":136.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":138.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":146.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":148.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":156.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":158.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":166.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":168.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":176.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":178.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":186.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":188.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":196.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":198.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":206.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":208.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":16.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":18.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":26.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":28.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":36.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":38.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":46.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":48.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":56.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":58.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":66.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":68.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":76.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":78.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":86.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":88.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":96.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":98.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":106.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":108.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":116.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":118.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":126.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":128.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":136.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":138.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":146.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":148.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":156.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":158.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":166.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":168.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":176.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":178.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":186.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":188.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":196.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":198.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":206.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":208.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":26,\"y\":12,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":29,\"y\":15,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":83,\"y\":12,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":86,\"y\":15,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":26,\"y\":207,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":29,\"y\":210,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":83,\"y\":207,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":86,\"y\":210,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":47,\"y\":-7,\"w\":26,\"h\":19,\"fill\":\"#C9CED6\",\"radius\":2},{\"type\":\"rect\",\"x\":52,\"y\":-3,\"w\":16,\"h\":5,\"fill\":\"#1B1F24\",\"radius\":1,\"outline\":false},{\"type\":\"rect\",\"x\":28,\"y\":30,\"w\":7,\"h\":5,\"fill\":\"#6BE08A\",\"radius\":1},{\"type\":\"rect\",\"x\":30,\"y\":46,\"w\":14,\"h\":20,\"fill\":\"#F4F1EA\",\"radius\":3},{\"type\":\"rect\",\"x\":33,\"y\":51,\"w\":8,\"h\":10,\"fill\":\"#D5DAE1\",\"radius\":4,\"outline\":false},{\"type\":\"rect\",\"x\":62,\"y\":36,\"w\":14,\"h\":16,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":44,\"y\":40,\"w\":12,\"h\":10,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":46,\"y\":115,\"w\":28,\"h\":28,\"fill\":\"#1B1F24\",\"radius\":2,\"label\":\"RP2350\",\"labelColor\":\"#D5DAE1\",\"labelSize\":6.5},{\"type\":\"rect\",\"x\":49.25,\"y\":151,\"w\":1.5,\"h\":79,\"fill\":\"#237A55\",\"outline\":false},{\"type\":\"rect\",\"x\":59.25,\"y\":151,\"w\":1.5,\"h\":79,\"fill\":\"#237A55\",\"outline\":false},{\"type\":\"rect\",\"x\":69.25,\"y\":151,\"w\":1.5,\"h\":79,\"fill\":\"#237A55\",\"outline\":false},{\"type\":\"rect\",\"x\":43,\"y\":144,\"w\":34,\"h\":14,\"fill\":\"#2F9E6E\",\"radius\":1,\"outline\":false},{\"type\":\"rect\",\"x\":46.5,\"y\":147.5,\"w\":7,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":3.5,\"outline\":false},{\"type\":\"rect\",\"x\":48.5,\"y\":149.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":56.5,\"y\":147.5,\"w\":7,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":3.5,\"outline\":false},{\"type\":\"rect\",\"x\":58.5,\"y\":149.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":66.5,\"y\":147.5,\"w\":7,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":3.5,\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":149.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":38,\"y\":160,\"w\":44,\"h\":32,\"fill\":\"#D5DAE1\",\"radius\":2,\"label\":\"Pico 2 W\",\"labelSize\":9},{\"type\":\"rect\",\"x\":46,\"y\":210,\"w\":28,\"h\":2,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":46,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":54.67,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":63.34,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":72.00999999999999,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false}]}")
	},
	"../modules/rpi-pico-2.json": {
		format: "circuitoon-module/1",
		id: "rpi-pico-2",
		version: 1,
		name: "Raspberry Pi Pico 2",
		category: "Microcontrollers",
		source: "https://datasheets.raspberrypi.com/pico/pico-2-datasheet.pdf https://datasheets.raspberrypi.com/pico/Pico-2-Pinout.pdf",
		pins: [
			{
				"name": "GP0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "GP2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP11",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 4",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "VBUS",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "VSYS",
				"side": "right",
				"type": "power_in",
				"supply": "5V/3.7V/3V3"
			},
			{
				"name": "GND 5",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "3V3_EN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "3V3(OUT)",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "ADC_VREF",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP28/ADC2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "AGND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "GP27/ADC1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP26/ADC0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RUN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 6",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP20",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 7",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP17",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "SWCLK",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "GND DBG",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "SWDIO",
				"side": "bottom"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3",
			"GND 4",
			"GND 5",
			"AGND",
			"GND 6",
			"GND 7",
			"GND DBG"
		]],
		size: {
			"w": 12,
			"h": 23
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "VBUS",
				"volts": 5,
				"via": "USB"
			}, {
				"pin": "VSYS",
				"volts": 5,
				"via": "USB",
				"diode": true,
				"max": 5.5
			}]
		},
		art: {
			"w": 120,
			"h": 230,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 230,
					"fill": "#2F9E6E",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 0,
					"y": 16.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 26.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 36.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 46.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 56.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 66.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 76.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 86.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 96.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 106.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 116.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 126.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 136.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 146.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 156.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 166.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 176.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 186.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 196.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 206.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 16.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 26.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 36.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 46.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 56.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 66.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 76.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 86.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 96.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 106.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 116.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 126.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 136.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 146.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 156.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 166.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 176.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 186.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 196.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 206.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 12,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 15,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 83,
					"y": 12,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 15,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 207,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 210,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 83,
					"y": 207,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 210,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": -7,
					"w": 26,
					"h": 19,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 52,
					"y": -3,
					"w": 16,
					"h": 5,
					"fill": "#1B1F24",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28,
					"y": 30,
					"w": 7,
					"h": 5,
					"fill": "#6BE08A",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 30,
					"y": 46,
					"w": 14,
					"h": 20,
					"fill": "#F4F1EA",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 33,
					"y": 51,
					"w": 8,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 62,
					"y": 36,
					"w": 14,
					"h": 16,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 44,
					"y": 40,
					"w": 12,
					"h": 10,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 42,
					"y": 116,
					"w": 36,
					"h": 36,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "RP2350",
					"labelColor": "#D5DAE1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 38,
					"y": 164,
					"w": 44,
					"h": 14,
					"fill": "#2F9E6E",
					"outline": false,
					"label": "Pico 2",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 46.5,
					"y": 220,
					"w": 7,
					"h": 10,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 227,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56.5,
					"y": 220,
					"w": 7,
					"h": 10,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 227,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 66.5,
					"y": 220,
					"w": 7,
					"h": 10,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 227,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/rpi-pico-h.json": {
		format: "circuitoon-module/1",
		id: "rpi-pico-h",
		version: 1,
		name: "Raspberry Pi Pico H (with headers and debug connector)",
		category: "Microcontrollers",
		source: "https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf https://datasheets.raspberrypi.com/pico/Pico-R3-A4-Pinout.pdf https://pip.raspberrypi.com/documents/RP-008314-DS https://datasheets.raspberrypi.com/debug/debug-connector-specification.pdf",
		pins: [
			{
				"name": "GP0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "GP2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP11",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 4",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "VBUS",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "VSYS",
				"side": "right",
				"type": "power_in",
				"supply": "5V/3.7V/3V3"
			},
			{
				"name": "GND 5",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "3V3_EN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "3V3(OUT)",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "ADC_VREF",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP28/ADC2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "AGND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "GP27/ADC1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP26/ADC0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RUN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 6",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP20",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 7",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP17",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "SWCLK",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "GND DBG",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "SWDIO",
				"side": "bottom"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3",
			"GND 4",
			"GND 5",
			"AGND",
			"GND 6",
			"GND 7",
			"GND DBG"
		]],
		size: {
			"w": 12,
			"h": 23
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "VBUS",
				"volts": 5,
				"via": "USB"
			}, {
				"pin": "VSYS",
				"volts": 5,
				"via": "USB",
				"diode": true,
				"max": 5.5
			}]
		},
		art: {
			"w": 120,
			"h": 230,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 230,
					"fill": "#2F9E6E",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 1,
					"y": 15,
					"w": 8,
					"h": 200,
					"fill": "#2B2F36",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 18,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 28,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 38,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 48,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 58,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 68,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 78,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 88,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 98,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 108,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 118,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 128,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 138,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 148,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 158,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 168,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 178,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 188,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 198,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 208,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 111,
					"y": 15,
					"w": 8,
					"h": 200,
					"fill": "#2B2F36",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 18,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 28,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 38,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 48,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 58,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 68,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 78,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 88,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 98,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 108,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 118,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 128,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 138,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 148,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 158,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 168,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 178,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 188,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 198,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 208,
					"w": 4,
					"h": 4,
					"fill": "#E0B43C",
					"radius": .5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 12,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 15,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 83,
					"y": 12,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 15,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 207,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 210,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 83,
					"y": 207,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 210,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": -7,
					"w": 26,
					"h": 19,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 52,
					"y": -3,
					"w": 16,
					"h": 5,
					"fill": "#1B1F24",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28,
					"y": 30,
					"w": 7,
					"h": 5,
					"fill": "#6BE08A",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 30,
					"y": 46,
					"w": 14,
					"h": 20,
					"fill": "#F4F1EA",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 33,
					"y": 51,
					"w": 8,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 62,
					"y": 36,
					"w": 14,
					"h": 16,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 44,
					"y": 40,
					"w": 12,
					"h": 10,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 42,
					"y": 116,
					"w": 36,
					"h": 36,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "RP2040",
					"labelColor": "#D5DAE1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 38,
					"y": 164,
					"w": 44,
					"h": 14,
					"fill": "#2F9E6E",
					"outline": false,
					"label": "Pico H",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 42,
					"y": 214,
					"w": 36,
					"h": 16,
					"fill": "#F4F1EA",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 48,
					"y": 224,
					"w": 4,
					"h": 6,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 224,
					"w": 4,
					"h": 6,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 68,
					"y": 224,
					"w": 4,
					"h": 6,
					"fill": "#C9CED6",
					"outline": false
				}
			]
		}
	},
	"../modules/rpi-pico-w.json": {
		format: "circuitoon-module/1",
		id: "rpi-pico-w",
		version: 1,
		name: "Raspberry Pi Pico W",
		category: "Microcontrollers",
		source: "https://datasheets.raspberrypi.com/picow/pico-w-datasheet.pdf https://datasheets.raspberrypi.com/picow/PicoW-A4-Pinout.pdf",
		pins: [
			{
				"name": "GP0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "GP2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP11",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 4",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "VBUS",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "VSYS",
				"side": "right",
				"type": "power_in",
				"supply": "5V/3.7V/3V3"
			},
			{
				"name": "GND 5",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "3V3_EN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "3V3(OUT)",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "ADC_VREF",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP28/ADC2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "AGND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "GP27/ADC1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP26/ADC0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RUN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 6",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP20",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 7",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP17",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "SWCLK",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "GND DBG",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "SWDIO",
				"side": "bottom"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3",
			"GND 4",
			"GND 5",
			"AGND",
			"GND 6",
			"GND 7",
			"GND DBG"
		]],
		size: {
			"w": 12,
			"h": 23
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "VBUS",
				"volts": 5,
				"via": "USB"
			}, {
				"pin": "VSYS",
				"volts": 5,
				"via": "USB",
				"diode": true,
				"max": 5.5
			}]
		},
		art: /* @__PURE__ */ JSON.parse("{\"w\":120,\"h\":230,\"pinLabels\":\"inside\",\"shapes\":[{\"type\":\"rect\",\"x\":0,\"y\":0,\"w\":120,\"h\":230,\"fill\":\"#2F9E6E\",\"radius\":4},{\"type\":\"rect\",\"x\":0,\"y\":16.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":18.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":26.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":28.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":36.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":38.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":46.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":48.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":56.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":58.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":66.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":68.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":76.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":78.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":86.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":88.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":96.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":98.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":106.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":108.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":116.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":118.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":126.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":128.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":136.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":138.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":146.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":148.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":156.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":158.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":166.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":168.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":176.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":178.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":186.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":188.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":196.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":198.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":0,\"y\":206.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":-1.5,\"y\":208.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":16.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":18.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":26.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":28.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":36.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":38.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":46.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":48.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":56.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":58.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":66.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":68.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":76.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":78.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":86.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":88.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":96.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":98.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":106.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":108.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":116.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":118.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":126.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":128.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":136.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":138.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":146.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":148.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":156.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":158.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":166.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":168.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":176.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":178.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":186.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":188.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":196.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":198.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":110,\"y\":206.5,\"w\":10,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":118.5,\"y\":208.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":26,\"y\":12,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":29,\"y\":15,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":83,\"y\":12,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":86,\"y\":15,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":26,\"y\":207,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":29,\"y\":210,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":83,\"y\":207,\"w\":11,\"h\":11,\"fill\":\"#E0B43C\",\"radius\":5.5,\"outline\":false},{\"type\":\"rect\",\"x\":86,\"y\":210,\"w\":5,\"h\":5,\"fill\":\"#F4F1EA\",\"radius\":2.5,\"outline\":false},{\"type\":\"rect\",\"x\":47,\"y\":-7,\"w\":26,\"h\":19,\"fill\":\"#C9CED6\",\"radius\":2},{\"type\":\"rect\",\"x\":52,\"y\":-3,\"w\":16,\"h\":5,\"fill\":\"#1B1F24\",\"radius\":1,\"outline\":false},{\"type\":\"rect\",\"x\":28,\"y\":30,\"w\":7,\"h\":5,\"fill\":\"#6BE08A\",\"radius\":1},{\"type\":\"rect\",\"x\":30,\"y\":46,\"w\":14,\"h\":20,\"fill\":\"#F4F1EA\",\"radius\":3},{\"type\":\"rect\",\"x\":33,\"y\":51,\"w\":8,\"h\":10,\"fill\":\"#D5DAE1\",\"radius\":4,\"outline\":false},{\"type\":\"rect\",\"x\":62,\"y\":36,\"w\":14,\"h\":16,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":44,\"y\":40,\"w\":12,\"h\":10,\"fill\":\"#1B1F24\",\"radius\":1},{\"type\":\"rect\",\"x\":46,\"y\":115,\"w\":28,\"h\":28,\"fill\":\"#1B1F24\",\"radius\":2,\"label\":\"RP2040\",\"labelColor\":\"#D5DAE1\",\"labelSize\":6.5},{\"type\":\"rect\",\"x\":49.25,\"y\":151,\"w\":1.5,\"h\":79,\"fill\":\"#237A55\",\"outline\":false},{\"type\":\"rect\",\"x\":59.25,\"y\":151,\"w\":1.5,\"h\":79,\"fill\":\"#237A55\",\"outline\":false},{\"type\":\"rect\",\"x\":69.25,\"y\":151,\"w\":1.5,\"h\":79,\"fill\":\"#237A55\",\"outline\":false},{\"type\":\"rect\",\"x\":43,\"y\":144,\"w\":34,\"h\":14,\"fill\":\"#2F9E6E\",\"radius\":1,\"outline\":false},{\"type\":\"rect\",\"x\":46.5,\"y\":147.5,\"w\":7,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":3.5,\"outline\":false},{\"type\":\"rect\",\"x\":48.5,\"y\":149.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":56.5,\"y\":147.5,\"w\":7,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":3.5,\"outline\":false},{\"type\":\"rect\",\"x\":58.5,\"y\":149.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":66.5,\"y\":147.5,\"w\":7,\"h\":7,\"fill\":\"#E0B43C\",\"radius\":3.5,\"outline\":false},{\"type\":\"rect\",\"x\":68.5,\"y\":149.5,\"w\":3,\"h\":3,\"fill\":\"#8A6A1E\",\"radius\":1.5,\"outline\":false},{\"type\":\"rect\",\"x\":38,\"y\":160,\"w\":44,\"h\":32,\"fill\":\"#D5DAE1\",\"radius\":2,\"label\":\"Pico W\",\"labelSize\":9},{\"type\":\"rect\",\"x\":46,\"y\":210,\"w\":28,\"h\":2,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":46,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":54.67,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":63.34,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false},{\"type\":\"rect\",\"x\":72.00999999999999,\"y\":210,\"w\":2,\"h\":8,\"fill\":\"#E0B43C\",\"outline\":false}]}")
	},
	"../modules/rpi-pico.json": {
		format: "circuitoon-module/1",
		id: "rpi-pico",
		version: 1,
		name: "Raspberry Pi Pico",
		category: "Microcontrollers",
		source: "https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf https://datasheets.raspberrypi.com/pico/Pico-R3-A4-Pinout.pdf",
		pins: [
			{
				"name": "GP0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "GP2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 2",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP9",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 3",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP10",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP11",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP12",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP13",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GND 4",
				"side": "left",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP14",
				"side": "left",
				"type": "io"
			},
			{
				"name": "GP15",
				"side": "left",
				"type": "io"
			},
			{
				"name": "VBUS",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "VSYS",
				"side": "right",
				"type": "power_in",
				"supply": "5V/3.7V/3V3"
			},
			{
				"name": "GND 5",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "3V3_EN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "3V3(OUT)",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "ADC_VREF",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP28/ADC2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "AGND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "GP27/ADC1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP26/ADC0",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RUN",
				"side": "right",
				"type": "input"
			},
			{
				"name": "GP22",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 6",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP21",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP20",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP19",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP18",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND 7",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "GP17",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GP16",
				"side": "right",
				"type": "io"
			},
			{
				"name": "SWCLK",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "GND DBG",
				"side": "bottom",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "SWDIO",
				"side": "bottom"
			}
		],
		internal: [[
			"GND",
			"GND 2",
			"GND 3",
			"GND 4",
			"GND 5",
			"AGND",
			"GND 6",
			"GND 7",
			"GND DBG"
		]],
		size: {
			"w": 12,
			"h": 23
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "VBUS",
				"volts": 5,
				"via": "USB"
			}, {
				"pin": "VSYS",
				"volts": 5,
				"via": "USB",
				"diode": true,
				"max": 5.5
			}]
		},
		art: {
			"w": 120,
			"h": 230,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 120,
					"h": 230,
					"fill": "#2F9E6E",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 0,
					"y": 16.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 26.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 36.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 46.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 56.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 66.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 76.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 86.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 96.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 106.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 116.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 126.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 136.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 146.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 156.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 166.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 176.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 186.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 196.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 206.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": -1.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 16.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 26.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 36.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 46.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 56.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 66.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 76.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 86.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 96.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 106.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 116.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 126.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 136.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 146.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 156.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 166.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 176.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 178.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 186.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 188.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 196.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 198.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 110,
					"y": 206.5,
					"w": 10,
					"h": 7,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 118.5,
					"y": 208.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 12,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 15,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 83,
					"y": 12,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 15,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 26,
					"y": 207,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 29,
					"y": 210,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 83,
					"y": 207,
					"w": 11,
					"h": 11,
					"fill": "#E0B43C",
					"radius": 5.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 86,
					"y": 210,
					"w": 5,
					"h": 5,
					"fill": "#F4F1EA",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": -7,
					"w": 26,
					"h": 19,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 52,
					"y": -3,
					"w": 16,
					"h": 5,
					"fill": "#1B1F24",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28,
					"y": 30,
					"w": 7,
					"h": 5,
					"fill": "#6BE08A",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 30,
					"y": 46,
					"w": 14,
					"h": 20,
					"fill": "#F4F1EA",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 33,
					"y": 51,
					"w": 8,
					"h": 10,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 62,
					"y": 36,
					"w": 14,
					"h": 16,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 44,
					"y": 40,
					"w": 12,
					"h": 10,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 42,
					"y": 116,
					"w": 36,
					"h": 36,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "RP2040",
					"labelColor": "#D5DAE1",
					"labelSize": 6.5
				},
				{
					"type": "rect",
					"x": 38,
					"y": 164,
					"w": 44,
					"h": 14,
					"fill": "#2F9E6E",
					"outline": false,
					"label": "Pico",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 46.5,
					"y": 220,
					"w": 7,
					"h": 10,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 227,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 56.5,
					"y": 220,
					"w": 7,
					"h": 10,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 227,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 66.5,
					"y": 220,
					"w": 7,
					"h": 10,
					"fill": "#E0B43C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 227,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/servo-sg90.json": {
		format: "circuitoon-module/1",
		id: "servo-sg90",
		version: 1,
		name: "Micro servo SG90",
		category: "Motors and actuators",
		source: "https://handsontec.com/dataspecs/motor_fan/SG90-Servo.pdf https://www.airsupplylab.com/embedded-info/emb_hardware-information/emb-hwinfo_tower-pro-sg90-micro-servo.html https://www.towerpro.com.tw/product/sg90-7/",
		pins: [
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "4.8V/5V/6V"
			},
			{
				"name": "PWM",
				"side": "left",
				"type": "input"
			}
		],
		size: {
			"w": 15,
			"h": 7
		},
		electrical: {
			"model": "servo",
			"params": {}
		},
		art: {
			"w": 150,
			"h": 70,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 34,
					"y": 28,
					"w": 36,
					"h": 4,
					"fill": "#8B5A2B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 38,
					"w": 36,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 34,
					"y": 48,
					"w": 36,
					"h": 4,
					"fill": "#F08A24",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 0,
					"y": 23,
					"w": 38,
					"h": 34,
					"fill": "#2B2F36",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 31,
					"y": 27.5,
					"w": 5,
					"h": 5,
					"fill": "#8B5A2B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 31,
					"y": 37.5,
					"w": 5,
					"h": 5,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 31,
					"y": 47.5,
					"w": 5,
					"h": 5,
					"fill": "#F08A24",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 28,
					"w": 88,
					"h": 14,
					"fill": "#2A5FB8",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 63,
					"y": 32,
					"w": 5,
					"h": 5,
					"fill": "#123356",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 136,
					"y": 32,
					"w": 5,
					"h": 5,
					"fill": "#123356",
					"radius": 2.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68,
					"y": 8,
					"w": 68,
					"h": 54,
					"fill": "#3D7BE0",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 108,
					"y": 12,
					"w": 24,
					"h": 24,
					"fill": "#2A5FB8",
					"radius": 12,
					"outline": false
				},
				{
					"type": "rect",
					"x": 100,
					"y": 16,
					"w": 44,
					"h": 16,
					"fill": "#F4F6F8",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 114,
					"y": 16,
					"w": 16,
					"h": 16,
					"fill": "#F4F6F8",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 119,
					"y": 21,
					"w": 6,
					"h": 6,
					"fill": "#8E96A1",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72,
					"y": 44,
					"w": 36,
					"h": 12,
					"fill": "#3D7BE0",
					"outline": false,
					"label": "SG90",
					"labelColor": "#FFFFFF",
					"labelSize": 8
				}
			]
		}
	},
	"../modules/tactile-switch-12mm-4pin.json": {
		format: "circuitoon-module/1",
		id: "tactile-switch-12mm-4pin",
		version: 1,
		name: "Tactile switch 12 mm (4-pin)",
		category: "Switches",
		source: "https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf https://www.sameskydevices.com/product/resource/ts13.pdf",
		pins: [
			{
				"name": "4",
				"side": "left",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "2",
				"side": "left",
				"type": "passive"
			},
			{
				"name": "3",
				"side": "right",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "1",
				"side": "right",
				"type": "passive"
			}
		],
		internal: [["4", "3"], ["2", "1"]],
		size: {
			"w": 10,
			"h": 10
		},
		electrical: {
			"model": "switch",
			"terminals": {
				"a": "1",
				"b": "3"
			},
			"params": { "normallyOpen": { "default": true } }
		},
		states: ["released", "pressed"],
		art: {
			"w": 100,
			"h": 100,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 38.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 0,
					"y": 58.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 88,
					"y": 38.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 88,
					"y": 58.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 10,
					"w": 80,
					"h": 80,
					"fill": "#2B2F36",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 13,
					"y": 13,
					"w": 74,
					"h": 74,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 15,
					"y": 15,
					"w": 8,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 77,
					"y": 15,
					"w": 8,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 15,
					"y": 77,
					"w": 8,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 77,
					"y": 77,
					"w": 8,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28,
					"y": 28,
					"w": 44,
					"h": 44,
					"fill": "#E0483E",
					"radius": 22
				}
			]
		}
	},
	"../modules/tactile-switch-6mm-4pin.json": {
		format: "circuitoon-module/1",
		id: "tactile-switch-6mm-4pin",
		version: 1,
		name: "Tactile switch 6 mm (4-pin)",
		category: "Switches",
		source: "https://omronfs.omron.com/en_US/ecb/products/pdf/en-b3f.pdf https://www.sameskydevices.com/product/resource/ts13.pdf",
		pins: [
			{
				"name": "4",
				"side": "left",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "2",
				"side": "left",
				"type": "passive"
			},
			{
				"name": "3",
				"side": "right",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "1",
				"side": "right",
				"type": "passive"
			}
		],
		internal: [["4", "3"], ["2", "1"]],
		size: {
			"w": 6,
			"h": 6
		},
		electrical: {
			"model": "switch",
			"terminals": {
				"a": "1",
				"b": "3"
			},
			"params": { "normallyOpen": { "default": true } }
		},
		states: ["released", "pressed"],
		art: {
			"w": 60,
			"h": 60,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 0,
					"y": 38.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 48,
					"y": 18.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 48,
					"y": 38.5,
					"w": 12,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 10,
					"y": 10,
					"w": 40,
					"h": 40,
					"fill": "#2B2F36",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 13,
					"y": 13,
					"w": 34,
					"h": 34,
					"fill": "#C9CED6",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 21,
					"y": 21,
					"w": 18,
					"h": 18,
					"fill": "#1B1F24",
					"radius": 9
				}
			]
		}
	},
	"../modules/tft-ili9341-24-spi.json": {
		format: "circuitoon-module/1",
		id: "tft-ili9341-24-spi",
		version: 1,
		name: "2.4\" TFT 240x320 ILI9341 (SPI; T_ pins on touch version)",
		category: "Displays",
		source: "https://www.lcdwiki.com/2.4inch_SPI_Module_ILI9341_SKU:MSP2402 https://www.lcdwiki.com/res/MSP2402/MSP2402-2.4-SPI.pdf",
		pins: [
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "RESET",
				"side": "left",
				"type": "input"
			},
			{
				"name": "DC",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDI(MOSI)",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SCK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "LED",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDO(MISO)",
				"side": "left",
				"type": "output"
			},
			{
				"name": "T_CLK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_DIN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_DO",
				"side": "left",
				"type": "output"
			},
			{
				"name": "T_IRQ",
				"side": "left",
				"type": "output"
			},
			{
				"name": "SD_CS",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MOSI",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MISO",
				"side": "right",
				"type": "output"
			},
			{
				"name": "SD_SCK",
				"side": "right",
				"type": "input"
			}
		],
		size: {
			"w": 31,
			"h": 18
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 310,
			"h": 180,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 310,
					"h": 180,
					"fill": "#1E4F8A",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 5,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 297,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 167,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 297,
					"y": 167,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 2,
					"y": 25,
					"w": 8,
					"h": 140,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 300,
					"y": 75,
					"w": 8,
					"h": 40,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 302.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 302.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 302.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 302.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 8,
					"w": 204,
					"h": 164,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 66,
					"y": 16,
					"w": 188,
					"h": 148,
					"fill": "#262C34",
					"outline": false,
					"label": "240x320 ILI9341",
					"labelColor": "#8FA3B8",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/tft-ili9341-28-spi-touch.json": {
		format: "circuitoon-module/1",
		id: "tft-ili9341-28-spi-touch",
		version: 1,
		name: "2.8\" TFT 240x320 ILI9341 (SPI, touch)",
		category: "Displays",
		source: "https://www.lcdwiki.com/2.8inch_SPI_Module_ILI9341_SKU:MSP2807 https://www.lcdwiki.com/res/MSP2807/MSP2807-2.8-SPI.pdf",
		pins: [
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "RESET",
				"side": "left",
				"type": "input"
			},
			{
				"name": "DC",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDI(MOSI)",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SCK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "LED",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDO(MISO)",
				"side": "left",
				"type": "output"
			},
			{
				"name": "T_CLK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_DIN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "T_DO",
				"side": "left",
				"type": "output"
			},
			{
				"name": "T_IRQ",
				"side": "left",
				"type": "output"
			},
			{
				"name": "SD_CS",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MOSI",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MISO",
				"side": "right",
				"type": "output"
			},
			{
				"name": "SD_SCK",
				"side": "right",
				"type": "input"
			}
		],
		size: {
			"w": 32,
			"h": 20
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 320,
			"h": 200,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 320,
					"h": 200,
					"fill": "#1E4F8A",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 5,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 307,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 187,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 307,
					"y": 187,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 2,
					"y": 35,
					"w": 8,
					"h": 140,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 128.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 138.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 148.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 158.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 168.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 310,
					"y": 85,
					"w": 8,
					"h": 40,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 312.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 312.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 312.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 312.5,
					"y": 118.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58,
					"y": 8,
					"w": 214,
					"h": 184,
					"fill": "#B8C2CC",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 62,
					"y": 12,
					"w": 206,
					"h": 176,
					"fill": "#1B1F24",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 70,
					"y": 20,
					"w": 190,
					"h": 160,
					"fill": "#262C34",
					"outline": false,
					"label": "240x320 ILI9341",
					"labelColor": "#8FA3B8",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/tft-st7735-18-spi.json": {
		format: "circuitoon-module/1",
		id: "tft-st7735-18-spi",
		version: 1,
		name: "1.8\" TFT 128x160 ST7735 (SPI, 8-pin)",
		category: "Displays",
		source: "https://www.lcdwiki.com/1.8inch_SPI_Module_ST7735S_SKU:MSP1803 https://www.lcdwiki.com/res/MSP1803/MSP1803-1.8-SPI.pdf",
		pins: [
			{
				"name": "VCC",
				"side": "left",
				"type": "power_in",
				"supply": "3V3/5V"
			},
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "CS",
				"side": "left",
				"type": "input"
			},
			{
				"name": "RESET",
				"side": "left",
				"type": "input"
			},
			{
				"name": "A0",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SCK",
				"side": "left",
				"type": "input"
			},
			{
				"name": "LED",
				"side": "left",
				"type": "input"
			},
			{
				"name": "SD_CS",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MOSI",
				"side": "right",
				"type": "input"
			},
			{
				"name": "SD_MISO",
				"side": "right",
				"type": "output"
			},
			{
				"name": "SD_SCK",
				"side": "right",
				"type": "input"
			}
		],
		size: {
			"w": 22,
			"h": 12
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 220,
			"h": 120,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 220,
					"h": 120,
					"fill": "#1E4F8A",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 5,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 207,
					"y": 5,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5,
					"y": 107,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 207,
					"y": 107,
					"w": 8,
					"h": 8,
					"fill": "#123356",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 2,
					"y": 25,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 210,
					"y": 45,
					"w": 8,
					"h": 40,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 212.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 212.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 212.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 212.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 40,
					"y": 8,
					"w": 134,
					"h": 104,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 48,
					"y": 16,
					"w": 118,
					"h": 88,
					"fill": "#262C34",
					"outline": false,
					"label": "128x160",
					"labelColor": "#8FA3B8",
					"labelSize": 9
				}
			]
		}
	},
	"../modules/tft-st7789-154-spi.json": {
		format: "circuitoon-module/1",
		id: "tft-st7789-154-spi",
		version: 1,
		name: "1.54\" TFT 240x240 ST7789 (SPI, 8-pin with CS)",
		category: "Displays",
		source: "https://www.lcdwiki.com/1.54inch_IPS_Module https://www.makerfocus.com/products/1-54inch-tft-lcd-display-module",
		pins: [
			{
				"name": "GND",
				"side": "top",
				"type": "ground"
			},
			{
				"name": "VCC",
				"side": "top",
				"type": "power_in",
				"supply": "3V3"
			},
			{
				"name": "SCL",
				"side": "top",
				"type": "input"
			},
			{
				"name": "SDA",
				"side": "top",
				"type": "input"
			},
			{
				"name": "RES",
				"side": "top",
				"type": "input"
			},
			{
				"name": "DC",
				"side": "top",
				"type": "input"
			},
			{
				"name": "CS",
				"side": "top",
				"type": "input"
			},
			{
				"name": "BLK",
				"side": "top",
				"type": "input"
			}
		],
		size: {
			"w": 15,
			"h": 18
		},
		electrical: {
			"model": "display",
			"params": {}
		},
		art: {
			"w": 150,
			"h": 180,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 150,
					"h": 180,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 137,
					"y": 4,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 167,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 137,
					"y": 167,
					"w": 9,
					"h": 9,
					"fill": "#123356",
					"radius": 4.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 35,
					"y": 2,
					"w": 80,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 58.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 68.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 98.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 108.5,
					"y": 4.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 8,
					"y": 32,
					"w": 134,
					"h": 134,
					"fill": "#1B1F24",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 16,
					"y": 40,
					"w": 118,
					"h": 118,
					"fill": "#262C34",
					"outline": false,
					"label": "240x240 ST7789",
					"labelColor": "#8FA3B8",
					"labelSize": 8
				}
			]
		}
	},
	"../modules/tilt-switch-sw460d.json": {
		format: "circuitoon-module/1",
		id: "tilt-switch-sw460d",
		version: 1,
		name: "SW-460D ball vibration switch (axial)",
		category: "Sensors",
		source: "https://evelta.com/content/datasheets/SW-460D.pdf https://www.lcsc.com/product-detail/Vibration-Sensors_SHOU-HAN-SW-460D_C5379903.html",
		pins: [{
			"name": "1",
			"side": "left",
			"type": "passive"
		}, {
			"name": "2",
			"side": "right",
			"type": "passive"
		}],
		size: {
			"w": 8,
			"h": 4
		},
		electrical: {
			"model": "switch",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": {}
		},
		states: ["open", "closed"],
		art: {
			"w": 80,
			"h": 40,
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 18.5,
					"w": 16,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 64,
					"y": 18.5,
					"w": 16,
					"h": 3,
					"fill": "#B8BEC7",
					"radius": 1.5
				},
				{
					"type": "rect",
					"x": 12,
					"y": 11,
					"w": 56,
					"h": 18,
					"fill": "#3A3F47",
					"radius": 6
				},
				{
					"type": "rect",
					"x": 12,
					"y": 11,
					"w": 10,
					"h": 18,
					"fill": "#C9CED6",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 58,
					"y": 11,
					"w": 10,
					"h": 18,
					"fill": "#E0B43C",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 24,
					"y": 14,
					"w": 32,
					"h": 3,
					"fill": "#5A6069",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/tilt-switch-sw520d.json": {
		format: "circuitoon-module/1",
		id: "tilt-switch-sw520d",
		version: 1,
		name: "SW-520D ball tilt switch",
		category: "Sensors",
		source: "https://www.tme.com/Document/f1e6cedd8cb7feeb250b353b6213ec6c/SW-520D.pdf https://www.sunrom.com/p/sw520d-sw-520d-tilt-sensor",
		pins: [{
			"name": "1",
			"side": "bottom",
			"type": "passive"
		}, {
			"name": "2",
			"side": "bottom",
			"type": "passive"
		}],
		size: {
			"w": 5,
			"h": 6
		},
		electrical: {
			"model": "switch",
			"terminals": {
				"a": "1",
				"b": "2"
			},
			"params": {}
		},
		states: ["open", "closed"],
		art: {
			"w": 50,
			"h": 60,
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 38,
					"w": 3,
					"h": 22,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 38,
					"w": 3,
					"h": 22,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 3,
					"w": 26,
					"h": 38,
					"fill": "#2B2F36",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 16,
					"y": 8,
					"w": 4,
					"h": 22,
					"fill": "#3A3F47",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 14,
					"y": 34,
					"w": 22,
					"h": 6,
					"fill": "#3A3F47",
					"radius": 1,
					"outline": false
				}
			]
		}
	},
	"../modules/tp4056-module.json": {
		format: "circuitoon-module/1",
		id: "tp4056-module",
		version: 1,
		name: "TP4056 Li-ion charger (USB-C, with protection)",
		category: "Power",
		source: "https://www.amazon.com/dp/B07PKND8KG https://www.addicore.com/products/tp4056-tc4056a-lithium-battery-charger-and-protection-module https://www.teachmemicro.com/tp4056-charging-module-pinout-wiring-charging-current-and-arduino-use/",
		pins: [
			{
				"name": "IN+",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "IN-",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "OUT+",
				"side": "right",
				"type": "power_out",
				"supply": "3.7V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "B+",
				"side": "right",
				"type": "power_in",
				"supply": "3.7V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "B-",
				"side": "right",
				"type": "ground"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "OUT-",
				"side": "right",
				"type": "ground"
			}
		],
		internal: [["IN-", "OUT-"], ["B+", "OUT+"]],
		size: {
			"w": 13,
			"h": 9
		},
		electrical: {
			"model": "charger",
			"params": {},
			"commonReturn": [["B-", "OUT-"]]
		},
		art: {
			"w": 130,
			"h": 90,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 130,
					"h": 90,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 0,
					"y": 30,
					"w": 28,
					"h": 30,
					"fill": "#C9CED6",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 3,
					"y": 36,
					"w": 4,
					"h": 18,
					"fill": "#8A9099",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 7,
					"w": 8,
					"h": 5,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 50,
					"y": 7,
					"w": 8,
					"h": 5,
					"fill": "#4FA3F7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 40,
					"y": 29,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 40,
					"y": 54,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 29,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 47,
					"y": 54,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 54,
					"y": 29,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 54,
					"y": 54,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 61,
					"y": 29,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 61,
					"y": 54,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38,
					"y": 32,
					"w": 28,
					"h": 22,
					"fill": "#1E2126",
					"radius": 1,
					"label": "TP4056",
					"labelColor": "#C9CED6",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 80,
					"y": 18,
					"w": 12,
					"h": 12,
					"fill": "#1E2126",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 43,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 68,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 43,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 68,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 86.5,
					"y": 43,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 86.5,
					"y": 68,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 90.5,
					"y": 43,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 90.5,
					"y": 68,
					"w": 3,
					"h": 3,
					"fill": "#C9CED6",
					"outline": false
				},
				{
					"type": "rect",
					"x": 78,
					"y": 46,
					"w": 16,
					"h": 22,
					"fill": "#1E2126",
					"radius": 1,
					"label": "8205",
					"labelColor": "#C9CED6",
					"labelSize": 4
				},
				{
					"type": "rect",
					"x": 46,
					"y": 66,
					"w": 8,
					"h": 5,
					"fill": "#C8A27A",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 16,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 3,
					"y": 76,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 5.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 119,
					"y": 16,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 121.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 119,
					"y": 36,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 121.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 119,
					"y": 56,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 121.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 119,
					"y": 76,
					"w": 8,
					"h": 8,
					"fill": "#D5DAE1",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 121.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#6B727C",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/ultrasonic-hc-sr04.json": {
		format: "circuitoon-module/1",
		id: "ultrasonic-hc-sr04",
		version: 1,
		name: "HC-SR04 ultrasonic distance sensor (VCC Trig Echo GND)",
		category: "Sensors",
		source: "https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf https://lastminuteengineers.com/arduino-sr04-ultrasonic-sensor-tutorial/",
		pins: [
			{
				"name": "VCC",
				"side": "bottom",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "Trig",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "Echo",
				"side": "bottom",
				"type": "output"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			}
		],
		size: {
			"w": 19,
			"h": 9
		},
		electrical: {
			"model": "sensor",
			"params": {}
		},
		art: {
			"w": 190,
			"h": 90,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 190,
					"h": 90,
					"fill": "#1E4F8A",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 4,
					"y": 4,
					"w": 6,
					"h": 6,
					"fill": "#123356",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 180,
					"y": 4,
					"w": 6,
					"h": 6,
					"fill": "#123356",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4,
					"y": 80,
					"w": 6,
					"h": 6,
					"fill": "#123356",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 180,
					"y": 80,
					"w": 6,
					"h": 6,
					"fill": "#123356",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 8,
					"y": 10,
					"w": 66,
					"h": 66,
					"fill": "#C9CED6",
					"radius": 33
				},
				{
					"type": "rect",
					"x": 16,
					"y": 18,
					"w": 50,
					"h": 50,
					"fill": "#8E96A1",
					"radius": 25,
					"outline": false
				},
				{
					"type": "rect",
					"x": 22,
					"y": 24,
					"w": 38,
					"h": 38,
					"fill": "#5E656F",
					"radius": 19,
					"outline": false
				},
				{
					"type": "rect",
					"x": 116,
					"y": 10,
					"w": 66,
					"h": 66,
					"fill": "#C9CED6",
					"radius": 33
				},
				{
					"type": "rect",
					"x": 124,
					"y": 18,
					"w": 50,
					"h": 50,
					"fill": "#8E96A1",
					"radius": 25,
					"outline": false
				},
				{
					"type": "rect",
					"x": 130,
					"y": 24,
					"w": 38,
					"h": 38,
					"fill": "#5E656F",
					"radius": 19,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78,
					"y": 6,
					"w": 34,
					"h": 12,
					"fill": "#C9CED6",
					"radius": 6,
					"label": "12.000",
					"labelSize": 5
				},
				{
					"type": "rect",
					"x": 76,
					"y": 24,
					"w": 38,
					"h": 12,
					"fill": "#1E4F8A",
					"outline": false,
					"label": "HC-SR04",
					"labelColor": "#FFFFFF",
					"labelSize": 7
				},
				{
					"type": "rect",
					"x": 75,
					"y": 80,
					"w": 40,
					"h": 8,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 78.5,
					"y": 82.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 88.5,
					"y": 82.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 98.5,
					"y": 82.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 108.5,
					"y": 82.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				}
			]
		}
	},
	"../modules/usb-panel-mount-microusb.json": {
		format: "circuitoon-module/1",
		id: "usb-panel-mount-microusb",
		version: 1,
		name: "USB panel-mount extension (micro-USB)",
		category: "Connectors",
		source: "https://www.adafruit.com/product/3258 https://en.wikipedia.org/wiki/USB_hardware#Pinouts",
		pins: [
			{
				"name": "VBUS",
				"side": "right",
				"type": "passive"
			},
			{
				"name": "D-",
				"side": "right",
				"type": "passive"
			},
			{
				"name": "D+",
				"side": "right",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "GND",
				"side": "right",
				"type": "passive"
			}
		],
		size: {
			"w": 12,
			"h": 7
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 120,
			"h": 70,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 5,
					"w": 26,
					"h": 60,
					"fill": "#2B2F36",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 10,
					"y": 9,
					"w": 14,
					"h": 8,
					"fill": "#15181C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 10,
					"y": 53,
					"w": 14,
					"h": 8,
					"fill": "#15181C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 9,
					"y": 25,
					"w": 16,
					"h": 20,
					"fill": "#C9CED6",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 13,
					"y": 31,
					"w": 8,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 31,
					"w": 38,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 66,
					"y": 12,
					"w": 44,
					"h": 56,
					"fill": "#3A3F47",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 108,
					"y": 16,
					"w": 12,
					"h": 48,
					"fill": "#C9CED6",
					"radius": 2
				}
			]
		}
	},
	"../modules/usb-panel-mount-usbc.json": {
		format: "circuitoon-module/1",
		id: "usb-panel-mount-usbc",
		version: 1,
		name: "USB panel-mount extension (USB-C)",
		category: "Connectors",
		source: "https://en.wikipedia.org/wiki/USB-C#Receptacles https://en.wikipedia.org/wiki/USB_hardware#Pinouts",
		pins: [
			{
				"name": "VBUS",
				"side": "right",
				"type": "passive"
			},
			{
				"name": "D-",
				"side": "right",
				"type": "passive"
			},
			{
				"name": "D+",
				"side": "right",
				"type": "passive"
			},
			{
				"name": "GND",
				"side": "right",
				"type": "passive"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "CC",
				"side": "right",
				"type": "passive"
			}
		],
		size: {
			"w": 12,
			"h": 8
		},
		electrical: {
			"model": "connector",
			"params": {}
		},
		art: {
			"w": 120,
			"h": 80,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 4,
					"y": 10,
					"w": 26,
					"h": 60,
					"fill": "#2B2F36",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 10,
					"y": 14,
					"w": 14,
					"h": 8,
					"fill": "#15181C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 10,
					"y": 58,
					"w": 14,
					"h": 8,
					"fill": "#15181C",
					"radius": 4,
					"outline": false
				},
				{
					"type": "rect",
					"x": 9,
					"y": 30,
					"w": 16,
					"h": 20,
					"fill": "#C9CED6",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 13,
					"y": 36,
					"w": 8,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 30,
					"y": 36,
					"w": 38,
					"h": 8,
					"fill": "#2B2F36",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 66,
					"y": 12,
					"w": 44,
					"h": 66,
					"fill": "#3A3F47",
					"radius": 4
				},
				{
					"type": "rect",
					"x": 108,
					"y": 16,
					"w": 12,
					"h": 58,
					"fill": "#C9CED6",
					"radius": 2
				}
			]
		}
	},
	"../modules/wemos-d1-mini.json": {
		format: "circuitoon-module/1",
		id: "wemos-d1-mini",
		version: 1,
		name: "Wemos / LOLIN D1 mini (ESP8266)",
		category: "Microcontrollers",
		source: "https://www.wemos.cc/en/latest/d1/d1_mini_3.1.0.html https://www.wemos.cc/en/latest/_static/boards/d1_mini_v3.1.0_1_16x16.jpg https://www.wemos.cc/en/latest/_static/boards/d1_mini_v3.1.0_2_16x16.jpg https://randomnerdtutorials.com/esp8266-pinout-reference-gpios/ https://www.wemos.cc/en/latest/_static/files/sch_d1_mini_v3.0.0.pdf",
		pins: [
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"name": "RST",
				"side": "left",
				"type": "input"
			},
			{
				"name": "A0",
				"side": "left",
				"type": "input"
			},
			{
				"name": "D0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D7",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D8",
				"side": "left",
				"type": "io"
			},
			{
				"name": "3V3",
				"side": "left",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "left"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"name": "TX",
				"side": "right",
				"type": "io"
			},
			{
				"name": "RX",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D1",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D2",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D3",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D4",
				"side": "right",
				"type": "io"
			},
			{
				"name": "GND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "5V",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"spacer": true,
				"side": "right"
			},
			{
				"spacer": true,
				"side": "right"
			}
		],
		size: {
			"w": 10,
			"h": 14
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB",
				"diode": true
			}]
		},
		art: {
			"w": 100,
			"h": 140,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 100,
					"h": 140,
					"fill": "#1E4F8A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 35,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 90,
					"y": 35,
					"w": 8,
					"h": 80,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 88.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 98.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 92.5,
					"y": 108.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 6,
					"w": 64,
					"h": 2.5,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 18,
					"y": 6,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 33.375,
					"y": 6,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.75,
					"y": 6,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 64.125,
					"y": 6,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 79.5,
					"y": 6,
					"w": 2.5,
					"h": 12,
					"fill": "#E0B43C",
					"outline": false
				},
				{
					"type": "rect",
					"x": 36,
					"y": 36,
					"w": 28,
					"h": 28,
					"fill": "#1B1F24",
					"radius": 2,
					"label": "ESP8266",
					"labelColor": "#D5DAE1",
					"labelSize": 4.5
				},
				{
					"type": "rect",
					"x": 46,
					"y": 72,
					"w": 22,
					"h": 16,
					"fill": "#1B1F24",
					"radius": 1,
					"label": "4MB",
					"labelColor": "#D5DAE1",
					"labelSize": 4.5
				},
				{
					"type": "rect",
					"x": 8,
					"y": 120,
					"w": 12,
					"h": 14,
					"fill": "#E9EDF0",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 39,
					"y": 126,
					"w": 22,
					"h": 17,
					"fill": "#C9CED6",
					"radius": 2
				}
			]
		}
	},
	"../modules/ws2812b-strip.json": {
		format: "circuitoon-module/1",
		id: "ws2812b-strip",
		version: 1,
		name: "WS2812B LED strip (5-LED segment, pads GND DIN 5V)",
		category: "Indicators",
		source: "https://www.pololu.com/product/2547 https://a.pololu-files.com/picture/0J5802.1200.jpg https://lastminuteengineers.com/ws2812b-arduino-tutorial/",
		pins: [
			{
				"name": "GND",
				"side": "left",
				"type": "ground"
			},
			{
				"name": "DIN",
				"side": "left",
				"type": "input"
			},
			{
				"name": "5V",
				"side": "left",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "GND 2",
				"side": "right",
				"label": "GND",
				"type": "ground"
			},
			{
				"name": "DOUT",
				"side": "right",
				"type": "output"
			},
			{
				"name": "5V 2",
				"side": "right",
				"label": "5V",
				"type": "power_in",
				"supply": "5V"
			}
		],
		internal: [["GND", "GND 2"], ["5V", "5V 2"]],
		size: {
			"w": 32,
			"h": 6
		},
		electrical: {
			"model": "addressable_led",
			"params": {}
		},
		art: {
			"w": 320,
			"h": 60,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 320,
					"h": 60,
					"fill": "#2B2F36",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 12,
					"y": 3,
					"w": 296,
					"h": 2,
					"fill": "#4A4F57",
					"outline": false
				},
				{
					"type": "rect",
					"x": 12,
					"y": 55,
					"w": 296,
					"h": 2,
					"fill": "#4A4F57",
					"outline": false
				},
				{
					"type": "rect",
					"x": 43,
					"y": 16,
					"w": 26,
					"h": 26,
					"fill": "#F2F2EE",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 48,
					"y": 21,
					"w": 16,
					"h": 16,
					"fill": "#FFFFFF",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 51,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 55,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 59,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#4F8EF7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 72,
					"y": 44,
					"w": 20,
					"h": 9,
					"fill": "#2B2F36",
					"outline": false,
					"label": "→",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 97,
					"y": 16,
					"w": 26,
					"h": 26,
					"fill": "#F2F2EE",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 102,
					"y": 21,
					"w": 16,
					"h": 16,
					"fill": "#FFFFFF",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 105,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 109,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 113,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#4F8EF7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 126,
					"y": 44,
					"w": 20,
					"h": 9,
					"fill": "#2B2F36",
					"outline": false,
					"label": "→",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 151,
					"y": 16,
					"w": 26,
					"h": 26,
					"fill": "#F2F2EE",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 156,
					"y": 21,
					"w": 16,
					"h": 16,
					"fill": "#FFFFFF",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 159,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 163,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 167,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#4F8EF7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 180,
					"y": 44,
					"w": 20,
					"h": 9,
					"fill": "#2B2F36",
					"outline": false,
					"label": "→",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 205,
					"y": 16,
					"w": 26,
					"h": 26,
					"fill": "#F2F2EE",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 210,
					"y": 21,
					"w": 16,
					"h": 16,
					"fill": "#FFFFFF",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 213,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 217,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 221,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#4F8EF7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 234,
					"y": 44,
					"w": 20,
					"h": 9,
					"fill": "#2B2F36",
					"outline": false,
					"label": "→",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 259,
					"y": 16,
					"w": 26,
					"h": 26,
					"fill": "#F2F2EE",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 264,
					"y": 21,
					"w": 16,
					"h": 16,
					"fill": "#FFFFFF",
					"radius": 8
				},
				{
					"type": "rect",
					"x": 267,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 271,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 275,
					"y": 25,
					"w": 3,
					"h": 4,
					"fill": "#4F8EF7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 288,
					"y": 44,
					"w": 20,
					"h": 9,
					"fill": "#2B2F36",
					"outline": false,
					"label": "→",
					"labelColor": "#FFFFFF",
					"labelSize": 9
				},
				{
					"type": "rect",
					"x": 1,
					"y": 17,
					"w": 10,
					"h": 6,
					"fill": "#D98C2B",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 27,
					"w": 10,
					"h": 6,
					"fill": "#D98C2B",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 1,
					"y": 37,
					"w": 10,
					"h": 6,
					"fill": "#D98C2B",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 309,
					"y": 17,
					"w": 10,
					"h": 6,
					"fill": "#D98C2B",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 309,
					"y": 27,
					"w": 10,
					"h": 6,
					"fill": "#D98C2B",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 309,
					"y": 37,
					"w": 10,
					"h": 6,
					"fill": "#D98C2B",
					"radius": 3,
					"outline": false
				}
			]
		}
	},
	"../modules/ws2812d-5mm.json": {
		format: "circuitoon-module/1",
		id: "ws2812d-5mm",
		version: 1,
		name: "WS2812 5 mm through-hole RGB LED (WS2812D-F5, DIN GND VDD DOUT)",
		category: "Indicators",
		source: "https://www.tme.eu/Document/6ea29838e05beac06400c47a846319d2/WS2812D-F5.pdf https://www.hobbyelectronica.nl/en/product/rgb-led-ws2812d-f5/",
		pins: [
			{
				"name": "DIN",
				"side": "bottom",
				"type": "input"
			},
			{
				"name": "GND",
				"side": "bottom",
				"type": "ground"
			},
			{
				"name": "VDD",
				"side": "bottom",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "DOUT",
				"side": "bottom",
				"type": "output"
			}
		],
		size: {
			"w": 7,
			"h": 10
		},
		electrical: {
			"model": "addressable_led",
			"params": {}
		},
		art: {
			"w": 70,
			"h": 100,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 18.5,
					"y": 50,
					"w": 3,
					"h": 50,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 28.5,
					"y": 50,
					"w": 3,
					"h": 50,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 38.5,
					"y": 50,
					"w": 3,
					"h": 50,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 48.5,
					"y": 50,
					"w": 3,
					"h": 50,
					"fill": "#B8BEC7",
					"outline": false
				},
				{
					"type": "rect",
					"x": 13,
					"y": 42,
					"w": 42,
					"h": 10,
					"fill": "#DDE2E7",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 17,
					"y": 6,
					"w": 36,
					"h": 42,
					"fill": "#F4F6F8",
					"radius": 16
				},
				{
					"type": "rect",
					"x": 23,
					"y": 12,
					"w": 6,
					"h": 12,
					"fill": "#FFFFFF",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28,
					"y": 28,
					"w": 4,
					"h": 5,
					"fill": "#E0483E",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 33,
					"y": 28,
					"w": 4,
					"h": 5,
					"fill": "#3FB56B",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 38,
					"y": 28,
					"w": 4,
					"h": 5,
					"fill": "#4F8EF7",
					"radius": 1,
					"outline": false
				},
				{
					"type": "rect",
					"x": 52,
					"y": 42,
					"w": 3,
					"h": 10,
					"fill": "#8E96A1",
					"outline": false
				}
			]
		}
	},
	"../modules/xiao-esp32c3.json": {
		format: "circuitoon-module/1",
		id: "xiao-esp32c3",
		version: 1,
		name: "Seeed XIAO ESP32-C3",
		category: "Microcontrollers",
		source: "https://wiki.seeedstudio.com/XIAO_ESP32C3_Getting_Started/ https://files.seeedstudio.com/wiki/XIAO_WiFi/XIAO_ESP32-C3_front_pinout.png",
		pins: [
			{
				"name": "D0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "5V",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "GND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "3V3",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "D10",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D9",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D8",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D7",
				"side": "right",
				"type": "io"
			}
		],
		size: {
			"w": 9,
			"h": 9
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB"
			}]
		},
		art: {
			"w": 90,
			"h": 90,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 90,
					"h": 90,
					"fill": "#1E3A5F",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 15,
					"w": 8,
					"h": 70,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 80,
					"y": 15,
					"w": 8,
					"h": 70,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 33,
					"y": -6,
					"w": 24,
					"h": 24,
					"fill": "#C9CED6",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 28,
					"y": 22,
					"w": 34,
					"h": 44,
					"fill": "#D5DAE1",
					"radius": 3,
					"label": "ESP32-C3",
					"labelSize": 5.5
				},
				{
					"type": "rect",
					"x": 60,
					"y": 8,
					"w": 5,
					"h": 4,
					"fill": "#E5484D",
					"radius": 1
				},
				{
					"type": "rect",
					"x": 28,
					"y": 73,
					"w": 10,
					"h": 10,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 30,
					"y": 75,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 40,
					"y": 73,
					"w": 10,
					"h": 10,
					"fill": "#D9C27A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 52,
					"y": 73,
					"w": 10,
					"h": 10,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 54,
					"y": 75,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				}
			]
		}
	},
	"../modules/xiao-esp32s3.json": {
		format: "circuitoon-module/1",
		id: "xiao-esp32s3",
		version: 1,
		name: "Seeed XIAO ESP32-S3",
		category: "Microcontrollers",
		source: "https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/ https://files.seeedstudio.com/wiki/SeeedStudio-XIAO-ESP32S3/img/XIAO_ESP32-S3_front_pinout.png",
		pins: [
			{
				"name": "D0",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D1",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D2",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D3",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D4",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D5",
				"side": "left",
				"type": "io"
			},
			{
				"name": "D6",
				"side": "left",
				"type": "io"
			},
			{
				"name": "5V",
				"side": "right",
				"type": "power_in",
				"supply": "5V"
			},
			{
				"name": "GND",
				"side": "right",
				"type": "ground"
			},
			{
				"name": "3V3",
				"side": "right",
				"type": "power_out",
				"supply": "3V3"
			},
			{
				"name": "D10",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D9",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D8",
				"side": "right",
				"type": "io"
			},
			{
				"name": "D7",
				"side": "right",
				"type": "io"
			}
		],
		size: {
			"w": 9,
			"h": 9
		},
		electrical: {
			"model": "mcu",
			"params": {},
			"external": [{
				"pin": "5V",
				"volts": 5,
				"via": "USB"
			}]
		},
		art: {
			"w": 90,
			"h": 90,
			"pinLabels": "inside",
			"shapes": [
				{
					"type": "rect",
					"x": 0,
					"y": 0,
					"w": 90,
					"h": 90,
					"fill": "#1E3A5F",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 2,
					"y": 15,
					"w": 8,
					"h": 70,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 4.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 80,
					"y": 15,
					"w": 8,
					"h": 70,
					"fill": "#E0B43C",
					"radius": 2,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 18.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 28.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 38.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 48.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 58.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 68.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 82.5,
					"y": 78.5,
					"w": 3,
					"h": 3,
					"fill": "#8A6A1E",
					"radius": 1.5,
					"outline": false
				},
				{
					"type": "rect",
					"x": 33,
					"y": -6,
					"w": 24,
					"h": 24,
					"fill": "#C9CED6",
					"radius": 3
				},
				{
					"type": "rect",
					"x": 20,
					"y": 2,
					"w": 8,
					"h": 8,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 21,
					"y": 3,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 62,
					"y": 2,
					"w": 8,
					"h": 8,
					"fill": "#3A3F47",
					"radius": 2
				},
				{
					"type": "rect",
					"x": 63,
					"y": 3,
					"w": 6,
					"h": 6,
					"fill": "#1B1F24",
					"radius": 3,
					"outline": false
				},
				{
					"type": "rect",
					"x": 28,
					"y": 22,
					"w": 34,
					"h": 42,
					"fill": "#D5DAE1",
					"radius": 3,
					"label": "ESP32-S3",
					"labelSize": 5.5
				},
				{
					"type": "rect",
					"x": 28,
					"y": 71,
					"w": 10,
					"h": 10,
					"fill": "#D9C27A",
					"radius": 5
				},
				{
					"type": "rect",
					"x": 42,
					"y": 72,
					"w": 20,
					"h": 8,
					"fill": "#1B1F24",
					"radius": 1
				}
			]
		}
	}
})).map(([path, raw]) => ({
	file: path.split("/").pop(),
	raw,
	...validateModule(raw)
})).sort((a, b) => a.file.localeCompare(b.file));
var modulesById = Object.fromEntries(library.flatMap((e) => e.ok ? [[e.module.id, e.module]] : []));
//#endregion
//#region src/agent/order.ts
var collator = new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base"
});
function naturalCompare(a, b) {
	return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
//#endregion
//#region src/cli/parts.ts
function partSummary(m) {
	return {
		id: m.id,
		name: m.name,
		category: m.category ?? null,
		source: m.source ?? null,
		board: isBoard(m),
		pins: m.pins.filter((p) => !isSpacer(p)).map((p) => ({
			name: p.name,
			label: p.label ?? null,
			type: p.type ?? null,
			supply: p.supply ?? null,
			capacity: terminalCapacity(m, p.name)
		})),
		holes: (m.holes ?? []).map((g) => ({
			name: g.name,
			label: g.label ?? null,
			type: g.type ?? null,
			supply: g.supply ?? null,
			holes: g.at.length,
			rail: g.rail ?? null,
			capacity: terminalCapacity(m, g.name)
		}))
	};
}
var modules = () => library.flatMap((e) => e.ok ? [e.module] : []).sort((a, b) => naturalCompare(a.id, b.id));
var pinText = (p) => [
	p.name,
	p.label && p.label !== p.name ? `(${p.label})` : "",
	p.type ?? "untyped",
	p.supply ?? "",
	p.capacity > 1 ? `takes ${p.capacity}` : ""
].filter(Boolean).join(" ");
function partsCommand(args, io) {
	const q = (flag(args, "--search") ?? "").toLowerCase();
	const list = modules().filter((m) => !q || [
		m.id,
		m.name,
		m.category ?? ""
	].some((s) => s.toLowerCase().includes(q)));
	if (args.flags.has("--json")) {
		printJson(io, {
			format: "circuitoon-cli/parts/1",
			parts: list.map(partSummary)
		});
		return EXIT.ok;
	}
	const blocks = list.map((m) => {
		const s = partSummary(m);
		return [
			`${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ""}`,
			s.pins.length ? `  pins: ${s.pins.map(pinText).join(", ")}` : "",
			s.holes.length ? `  hole groups: ${s.holes.map((g) => `${g.name}${g.rail ? ` (rail ${g.rail})` : ""} x${g.holes}`).join(", ")}` : ""
		].filter(Boolean).join("\n");
	});
	io.stdout(`${blocks.join("\n")}\n`);
	return EXIT.ok;
}
function partCommand(args, io) {
	const [id] = args.positionals;
	if (!id) throw new CliError("part: give a module id, for example: circuitoon part resistor", EXIT.input);
	const m = modules().find((x) => x.id === id);
	if (!m) throw new CliError(`no built-in part "${id}" (search with: circuitoon parts --search <text>)`, EXIT.input);
	if (args.flags.has("--json")) {
		printJson(io, {
			format: "circuitoon-cli/part/1",
			module: m
		});
		return EXIT.ok;
	}
	const s = partSummary(m);
	const lines = [`${s.id}: ${s.name}${s.category ? ` [${s.category}]` : ""}`];
	if (s.source) lines.push(`source: ${s.source}`);
	lines.push("pins (side, name, label, type, supply):");
	for (const p of m.pins) if (!isSpacer(p)) lines.push(`  ${p.side.padEnd(6)} ${pinText(s.pins.find((x) => x.name === p.name))}`);
	for (const g of s.holes) lines.push(`  hole group ${g.name}${g.label ? ` (${g.label})` : ""}: ${g.holes} hole${g.holes === 1 ? "" : "s"}${g.type ? `, ${g.type}` : ""}${g.supply ? ` ${g.supply}` : ""}${g.rail ? `, rail ${g.rail}` : ""}`);
	for (const group of m.internal ?? []) lines.push(`joined inside the part: ${group.join(" = ")}`);
	io.stdout(`${lines.join("\n")}\n`);
	return EXIT.ok;
}
//#endregion
//#region src/agent/catalog.ts
var libraryLookup = (id) => Object.hasOwn(modulesById, id) ? modulesById[id] : void 0;
//#endregion
//#region src/format/values.ts
var OHM = "Ω";
var MICRO = "µ";
var UNIT_SYMBOLS = {
	ohm: OHM,
	F: "F",
	V: "V",
	A: "A"
};
/** SI prefixes usable on a part value, smallest exponent first. */
var PREFIXES = [
	{
		exp: -12,
		symbol: "p"
	},
	{
		exp: -9,
		symbol: "n"
	},
	{
		exp: -6,
		symbol: MICRO
	},
	{
		exp: -3,
		symbol: "m"
	},
	{
		exp: 0,
		symbol: ""
	},
	{
		exp: 3,
		symbol: "k"
	},
	{
		exp: 6,
		symbol: "M"
	},
	{
		exp: 9,
		symbol: "G"
	}
];
/** Rounds to `digits` significant digits, avoiding float noise like 4.699999999999999. */
function roundSig(x, digits) {
	if (x === 0) return 0;
	const magnitude = Math.pow(10, digits - Math.ceil(Math.log10(Math.abs(x))));
	return Math.round(x * magnitude) / magnitude;
}
/**
* A number with its proper unit symbol and an SI prefix chosen so the shown mantissa is
* 1 to 999, at most 3 significant digits, no trailing zeros. Examples: 220 ohm -> "220 Ω",
* 4700 ohm -> "4.7 kΩ", 1e-7 F -> "100 nF".
*/
function formatValue(value, unit) {
	const symbol = UNIT_SYMBOLS[unit] ?? unit;
	if (value === 0) return `0 ${symbol}`;
	const abs = Math.abs(value);
	let idx = 0;
	for (let i = 0; i < PREFIXES.length; i++) if (abs / Math.pow(10, PREFIXES[i].exp) >= 1) idx = i;
	let scaled = roundSig(value / Math.pow(10, PREFIXES[idx].exp), 3);
	if (Math.abs(scaled) >= 1e3 && idx < PREFIXES.length - 1) {
		idx += 1;
		scaled = roundSig(value / Math.pow(10, PREFIXES[idx].exp), 3);
	}
	return `${scaled} ${PREFIXES[idx].symbol}${symbol}`;
}
/**
* Builds a standard value series: `decades` steps of x1, x10, x100, ... over `mantissas`, then
* one final value. Each entry is rounded to 6 significant digits (see `finish`), because the
* mantissa-times-power-of-ten multiplication otherwise leaves float noise like
* 2.1999999999999998e-11 instead of the exact 2.2e-11.
*/
function series(mantissas, base, decades, final) {
	const values = [];
	for (let k = 0; k < decades; k++) for (const m of mantissas) values.push(roundSig(m * base * Math.pow(10, k), 6));
	values.push(roundSig(final, 6));
	return values;
}
series([
	10,
	12,
	15,
	18,
	22,
	27,
	33,
	39,
	47,
	56,
	68,
	82
], 1, 5, 1e6);
series([
	10,
	15,
	22,
	33,
	47,
	68
], 1e-12, 8, .001);
/**
* The only param names the value field, caption and (for resistance) band coloring apply to,
* in priority order. A module can carry other numeric params (an LED's forward voltage, its max
* current) that are not meant to be user-editable values here, so those are never picked, no
* matter how plausible their unit looks.
*/
var PRIMARY_PARAM_NAMES = Object.keys(PARAM_RULES);
/**
* The first of `resistance`, `capacitance` or `voltage` present in its own unit (ohm, F, V) with
* a default in range for it (see PARAM_RULES). A param in another unit is skipped, so a
* resistance given in farads is never shown as ohms.
*/
function primaryParam(m) {
	const electrical = m.electrical;
	if (!isObj(electrical) || !isObj(electrical.params)) return null;
	for (const name of PRIMARY_PARAM_NAMES) {
		const param = electrical.params[name];
		if (!isObj(param)) continue;
		const def = param.default;
		if (param.unit === PARAM_RULES[name].unit && validParamValue(name, def)) return {
			name,
			unit: PARAM_RULES[name].unit,
			default: def
		};
	}
	return null;
}
/**
* The part's chosen value for its primary param, or the module default when unset. A stored
* override is only used when its unit matches the param's unit and its value is in range for the
* param (see PARAM_RULES). Loading a file drops any other override with a warning
* (`validateDiagram`), so the fallback to the default here is never silent for an imported sheet.
*/
function partValue(part, m) {
	const p = primaryParam(m);
	if (!p) return null;
	const stored = part.values?.[p.name];
	if (isObj(stored) && stored.unit === p.unit && validParamValue(p.name, stored.value)) return {
		name: p.name,
		unit: p.unit,
		value: stored.value
	};
	return {
		name: p.name,
		unit: p.unit,
		value: p.default
	};
}
/** "R1  4.7 kΩ" when the part has an editable value, else just its designator. Shared by the live editor canvas and the read-only sheet preview. */
function partCaption(part, m) {
	const v = partValue(part, m);
	return v ? `${part.designator}  ${formatValue(v.value, v.unit)}` : part.designator;
}
//#endregion
//#region src/render/captionBox.ts
/** Average advance of one bold 8.5 px character, rounded up so a box never undershoots the text. */
var CAPTION_CHAR = 5.4;
/** The caption anchor in part-local px (text-anchor middle, on the baseline). */
function captionAnchor(m, rotation = 0) {
	const box = bodyRect({
		x: 0,
		y: 0,
		rotation
	}, layoutModule(m));
	const stubsDown = worldPins({
		x: 0,
		y: 0,
		rotation
	}, m).some((p) => p.dir.y > 0);
	return {
		x: box.x + box.w / 2,
		y: box.y + box.h + (stubsDown ? 8 : 0) + 15
	};
}
/** The caption's box in world px (8 px above the baseline, 2 below). */
function captionBox(part, m, text = partCaption(part, m)) {
	const a = captionAnchor(m, part.rotation ?? 0);
	const w = text.length * CAPTION_CHAR;
	return {
		x: part.x + a.x - w / 2,
		y: part.y + a.y - 8,
		w,
		h: 10
	};
}
//#endregion
//#region src/agent/footprint.ts
/** Room kept around a free part's body for its pin stubs and the labels beside them. */
var PIN_ROOM = 18;
var union = (a, b) => {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return {
		x,
		y,
		w: Math.max(a.x + a.w, b.x + b.w) - x,
		h: Math.max(a.y + a.h, b.y + b.h) - y
	};
};
var grow = (r, by) => ({
	x: r.x - by,
	y: r.y - by,
	w: r.w + 2 * by,
	h: r.h + 2 * by
});
var shift = (r, dx, dy) => ({
	...r,
	x: r.x + dx,
	y: r.y + dy
});
/** True when two rectangles share area; touching edges do not count. */
var intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Body plus caption. */
function tightFootprint(p, m) {
	return union(bodyRect(p, layoutModule(m)), captionBox(p, m));
}
/** Body grown by PIN_ROOM, plus caption. */
function footprint(p, m) {
	return union(grow(bodyRect(p, layoutModule(m)), PIN_ROOM), captionBox(p, m));
}
var CELL = 200;
/** Placed rectangles bucketed on a 200 px grid, so a spot test looks only at its neighbours. */
var RectIndex = class {
	cells = /* @__PURE__ */ new Map();
	keys(r) {
		const out = [];
		for (let cy = Math.floor(r.y / CELL); cy <= Math.floor((r.y + r.h) / CELL); cy++) for (let cx = Math.floor(r.x / CELL); cx <= Math.floor((r.x + r.w) / CELL); cx++) out.push(`${cx},${cy}`);
		return out;
	}
	add(r) {
		for (const k of this.keys(r)) {
			const list = this.cells.get(k);
			if (list) list.push(r);
			else this.cells.set(k, [r]);
		}
	}
	hits(r) {
		for (const k of this.keys(r)) for (const o of this.cells.get(k) ?? []) if (intersects(o, r)) return true;
		return false;
	}
};
var NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** An endpoint as text, for binding reuse checks and the channel table: "U2.GPA0", "BB1.c5-top hole 2". */
function endpointText(ep) {
	if (typeof ep === "string") return ep;
	if (!isObj(ep) || typeof ep.ref !== "string") return null;
	if (typeof ep.pin === "string") return `${ep.ref}.${ep.pin}`;
	if (typeof ep.group === "string") return `${ep.ref}.${ep.group}${ep.hole !== void 0 ? ` hole ${String(ep.hole)}` : ""}`;
	return null;
}
/** A template endpoint with its ref renamed for one copy ("SA.1" in copy 3 is "SA_3.1"). */
function renameEndpoint(ep, rename) {
	if (typeof ep === "string") {
		const dot = ep.indexOf(".");
		return dot < 1 ? ep : `${rename(ep.slice(0, dot))}${ep.slice(dot)}`;
	}
	if (isObj(ep) && typeof ep.ref === "string") return {
		...ep,
		ref: rename(ep.ref)
	};
	return ep;
}
function expandRepeat(raw, topRefs, topNets) {
	const out = {
		parts: [],
		nets: [],
		shared: /* @__PURE__ */ new Map(),
		copies: [],
		errors: []
	};
	const fail = (e) => {
		out.errors.push(e);
		return out;
	};
	if (!isObj(raw)) return fail("repeat: must be { \"name\", \"count\", \"template\", \"bindings\", \"shared\" }");
	const { name, count, template, bindings } = raw;
	if (typeof name !== "string" || !NAME.test(name)) return fail("repeat.name: required, a letter then letters, digits or _");
	if (!(Number.isInteger(count) && count >= 1 && count <= 500)) return fail(`repeat.count: must be a whole number from 1 to 500`);
	const n = count;
	if (!isObj(template) || !Array.isArray(template.parts) || !Array.isArray(template.nets) || !Array.isArray(template.ports)) return fail("repeat.template: must be { \"parts\", \"nets\", \"ports\" }");
	const shared = raw.shared ?? {};
	if (!isObj(shared)) return fail("repeat.shared: must map a port to an outside net name");
	const tParts = template.parts;
	const tNets = template.nets;
	const tRefs = tParts.flatMap((p) => isObj(p) && typeof p.ref === "string" ? [p.ref] : []);
	const netNames = tNets.flatMap((x) => isObj(x) && typeof x.name === "string" ? [x.name] : []);
	const ports = template.ports.filter((p) => typeof p === "string");
	template.ports.forEach((p, i) => {
		if (typeof p !== "string" || !netNames.includes(p)) out.errors.push(`repeat.template.ports[${i}]: must name a template net`);
	});
	for (const [port, net] of Object.entries(shared)) if (!ports.includes(port)) out.errors.push(`repeat.shared.${port}: not a template port`);
	else if (typeof net !== "string" || !topNets.includes(net)) out.errors.push(`repeat.shared.${port}: no outside net "${String(net)}"`);
	const bound = ports.filter((p) => !Object.hasOwn(shared, p));
	if (!Array.isArray(bindings) || bindings.length !== n) return fail(`repeat.bindings: must list ${n} entries, one per copy`);
	const pattern = raw.refs ?? "{ref}_{copy}";
	if (typeof pattern !== "string" || !pattern.includes("{ref}") || !pattern.includes("{copy}")) return fail("repeat.refs: must contain {ref} and {copy}, for example \"{ref}_{copy}\"");
	const seenRefs = new Set(topRefs);
	const boundBy = /* @__PURE__ */ new Map();
	for (let k = 1; k <= n; k++) {
		const rename = (ref) => pattern.replaceAll("{ref}", ref).replaceAll("{copy}", String(k));
		const refs = [];
		tParts.forEach((p, i) => {
			const at = `repeat.template.parts[${i}]`;
			if (!isObj(p) || typeof p.ref !== "string") {
				if (k === 1) out.errors.push(`${at}.ref: required`);
				return;
			}
			if (p.on !== void 0) {
				if (k === 1) out.errors.push(`${at}.on: a repeated part cannot be mounted`);
				return;
			}
			const ref = rename(p.ref);
			if (seenRefs.has(ref)) return void out.errors.push(`${at}.ref: copy ${k} ref "${ref}" collides with another part`);
			seenRefs.add(ref);
			refs.push(ref);
			out.parts.push({
				p: {
					...p,
					ref
				},
				at: `${at} (copy ${k})`
			});
		});
		const entry = bindings[k - 1];
		const at = `repeat.bindings[${k - 1}]`;
		const chosen = {};
		if (!isObj(entry)) out.errors.push(`${at}: must map every port except shared ones (${bound.join(", ")}) to an outside pin`);
		else {
			for (const port of bound) {
				if (!Object.hasOwn(entry, port)) {
					out.errors.push(`${at}: port ${port} is not bound`);
					continue;
				}
				const text = endpointText(entry[port]);
				if (text === null) {
					out.errors.push(`${at}.${port}: must be "REF.PIN" or { "ref", "pin" }`);
					continue;
				}
				const prior = boundBy.get(text);
				if (prior) {
					out.errors.push(`${at}.${port}: ${text} is already bound by ${prior}`);
					continue;
				}
				boundBy.set(text, `copy ${k} port ${port}`);
				chosen[port] = text;
			}
			for (const key of Object.keys(entry)) if (!bound.includes(key)) out.errors.push(`${at}.${key}: not a port that takes a binding (${bound.join(", ")})`);
		}
		tNets.forEach((net, i) => {
			const nat = `repeat.template.nets[${i}]`;
			if (!isObj(net) || typeof net.name !== "string" || !Array.isArray(net.pins)) {
				if (k === 1) out.errors.push(`${nat}: must be { "name", "pins": [...] }`);
				return;
			}
			const pins = net.pins.map((ep, j) => ({
				ep: renameEndpoint(ep, (r) => tRefs.includes(r) ? rename(r) : r),
				at: `${nat}.pins[${j}] (copy ${k})`
			}));
			const port = ports.includes(net.name) ? net.name : null;
			if (port !== null && Object.hasOwn(shared, port)) {
				const target = shared[port];
				out.shared.set(target, [...out.shared.get(target) ?? [], ...pins]);
				return;
			}
			if (port !== null && isObj(entry) && Object.hasOwn(entry, port)) pins.push({
				ep: entry[port],
				at: `${at}.${port}`,
				binding: `copy ${k} port ${port}`
			});
			out.nets.push({
				name: `${name}_${k}.${net.name}`,
				pins,
				at: `${nat} (copy ${k})`
			});
		});
		out.copies.push({
			id: `${name}_${k}`,
			repeat: name,
			index: k,
			refs,
			bindings: chosen
		});
	}
	return out;
}
//#endregion
//#region src/agent/netlist.ts
var NETLIST_FORMAT = "circuitoon-netlist/1";
/** A part reference: a letter, then letters, digits or underscores. */
var REF_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
/** One key per pin or hole group of a part (a hole index never makes a second key). */
var terminalKey = (ref, name) => JSON.stringify([ref, name]);
/** "U1 GND", or "BB1 c5-top hole 2". */
var terminalName = (t) => `${t.ref} ${t.name}${t.hole !== void 0 ? ` hole ${t.hole}` : ""}`;
/** A part that can plug into a board: not a board, with legs, none of them a bus. */
var mountable = (m) => !isBoard(m) && m.pins.some((p) => !isSpacer(p)) && !m.pins.some((p) => !isSpacer(p) && p.bus);
function valueErrors(values, at) {
	const out = [];
	for (const [key, entry] of Object.entries(values)) {
		if (!Object.hasOwn(PARAM_RULES, key)) continue;
		const rule = PARAM_RULES[key];
		if (!(isObj(entry) && isNum(entry.value) && entry.unit === rule.unit && validParamValue(key, entry.value))) out.push(`${at}.${key}: must be { "value": <number>, "unit": "${rule.unit}" } within ${rule.range}`);
	}
	return out;
}
/** A pin by exact name (pins and hole groups share one namespace), else by a label exactly one of them has. */
function byName(m, ref, pin, at) {
	const pins = m.pins.filter((p) => !isSpacer(p));
	const groups = m.holes ?? [];
	if (pins.some((p) => p.name === pin)) return {
		ok: true,
		t: {
			ref,
			name: pin,
			infra: false
		}
	};
	if (groups.some((g) => g.name === pin)) return {
		ok: true,
		t: {
			ref,
			name: pin,
			infra: isBoard(m)
		}
	};
	const labelled = [...pins.filter((p) => p.label === pin).map((p) => p.name), ...groups.filter((g) => g.label === pin).map((g) => g.name)];
	if (labelled.length === 1) return {
		ok: true,
		t: {
			ref,
			name: labelled[0],
			infra: isBoard(m) && groups.some((g) => g.name === labelled[0])
		}
	};
	if (labelled.length > 1) return {
		ok: false,
		error: `${at}: "${pin}" is the label of ${labelled.length} pins on ${ref} (${labelled.join(", ")}); name one of them`
	};
	return {
		ok: false,
		error: `${at}: ${ref} (${m.id}) has no pin or label "${pin}"`
	};
}
function parseNetlist(raw, library) {
	const errors = [];
	if (!isObj(raw)) return {
		ok: false,
		errors: ["netlist must be a JSON object"]
	};
	if (raw.format === void 0) errors.push(`format: missing (expected "${NETLIST_FORMAT}")`);
	else if (raw.format !== "circuitoon-netlist/1") errors.push(`format: unsupported "${String(raw.format)}" (expected "${NETLIST_FORMAT}")`);
	if (typeof raw.title !== "string" || raw.title.trim() === "") errors.push("title: required");
	const embedded = /* @__PURE__ */ new Map();
	if (raw.modules !== void 0) {
		if (!isObj(raw.modules)) errors.push("modules: must be an object of module definitions by id");
		else for (const [key, m] of Object.entries(raw.modules)) {
			const r = validateModule(m);
			if (!r.ok) errors.push(...r.errors.map((e) => `modules.${key}: ${e}`));
			else if (r.module.id !== key) errors.push(`modules.${key}: id "${r.module.id}" does not match its key`);
			else if (library(key)) errors.push(`modules.${key}: "${key}" is a built-in part; give the embedded module its own id`);
			else embedded.set(key, r.module);
		}
	}
	const lookup = (id) => embedded.get(id) ?? library(id);
	if (!Array.isArray(raw.parts)) errors.push("parts: required list");
	if (!Array.isArray(raw.nets)) errors.push("nets: required list");
	if (!Array.isArray(raw.parts) || !Array.isArray(raw.nets)) return {
		ok: false,
		errors
	};
	const topParts = raw.parts;
	const topNets = raw.nets;
	const topRefs = new Set(topParts.flatMap((p) => isObj(p) && typeof p.ref === "string" ? [p.ref] : []));
	const topNetNames = topNets.flatMap((n) => isObj(n) && typeof n.name === "string" ? [n.name] : []);
	const rep = raw.repeat === void 0 ? null : expandRepeat(raw.repeat, topRefs, topNetNames);
	const rawParts = [...topParts.map((p, i) => ({
		p,
		at: `parts[${i}]`
	})), ...rep?.parts ?? []];
	const parts = [];
	const byRef = /* @__PURE__ */ new Map();
	const used = /* @__PURE__ */ new Map();
	for (const { p, at } of rawParts) {
		if (!isObj(p)) {
			errors.push(`${at}: must be an object`);
			continue;
		}
		const ref = p.ref;
		if (typeof ref !== "string" || !REF_PATTERN.test(ref)) {
			errors.push(`${at}.ref: required, a letter then letters, digits or _ (for example "R1")`);
			continue;
		}
		if (byRef.has(ref)) {
			errors.push(`${at}.ref: duplicate "${ref}"`);
			continue;
		}
		if (typeof p.module !== "string") {
			errors.push(`${at}.module: required`);
			continue;
		}
		const m = lookup(p.module);
		if (!m) {
			errors.push(`${at}.module: no built-in or embedded module "${p.module}"`);
			continue;
		}
		const part = {
			ref,
			module: p.module
		};
		if (p.values !== void 0) {
			if (!isObj(p.values)) errors.push(`${at}.values: must be an object`);
			else {
				errors.push(...valueErrors(p.values, `${at}.values`));
				part.values = p.values;
			}
		}
		if (p.on !== void 0) {
			if (typeof p.on !== "string") errors.push(`${at}.on: must be the ref of a breadboard or rail strip`);
			else part.on = p.on;
		}
		parts.push(part);
		byRef.set(ref, {
			part,
			module: m,
			at
		});
		used.set(p.module, m);
	}
	for (const { part, module, at } of byRef.values()) {
		if (part.on === void 0) continue;
		const board = byRef.get(part.on);
		if (!board) errors.push(`${at}.on: no part "${part.on}"`);
		else if (!isBoard(board.module)) errors.push(`${at}.on: ${part.on} (${board.module.id}) is not a breadboard or rail strip`);
		else if (!mountable(module)) errors.push(`${at}.on: ${part.ref} (${module.id}) cannot plug into a board (it is a board, has a bus pin or has no legs)`);
	}
	const resolve = (ep, at) => {
		let ref;
		let pin;
		let group;
		let hole;
		if (typeof ep === "string") {
			const dot = ep.indexOf(".");
			if (dot < 1) {
				errors.push(`${at}: "${ep}" must be "REF.PIN"`);
				return null;
			}
			ref = ep.slice(0, dot);
			pin = ep.slice(dot + 1);
		} else if (isObj(ep)) ({ref, pin, group, hole} = ep);
		else {
			errors.push(`${at}: must be "REF.PIN", { "ref", "pin" } or { "ref", "group", "hole" }`);
			return null;
		}
		const hit = typeof ref === "string" ? byRef.get(ref) : void 0;
		if (!hit) {
			errors.push(`${at}: no part "${String(ref)}"`);
			return null;
		}
		const r = ref;
		const m = hit.module;
		if (group !== void 0) {
			const g = typeof group === "string" ? m.holes?.find((h) => h.name === group) : void 0;
			if (!g) {
				errors.push(`${at}: ${r} (${m.id}) has no hole group "${String(group)}"`);
				return null;
			}
			if (hole !== void 0 && !(Number.isInteger(hole) && hole >= 0 && hole < g.at.length)) {
				errors.push(`${at}.hole: ${r} ${g.name} has holes 0 to ${g.at.length - 1}`);
				return null;
			}
			return {
				ref: r,
				name: g.name,
				infra: isBoard(m),
				...hole !== void 0 ? { hole } : {}
			};
		}
		if (typeof pin !== "string" || pin === "") {
			errors.push(`${at}: pin required`);
			return null;
		}
		const res = byName(m, r, pin, at);
		if (!res.ok) {
			errors.push(res.error);
			return null;
		}
		return res.t;
	};
	const rawNets = [];
	topNets.forEach((n, i) => {
		const at = `nets[${i}]`;
		if (!isObj(n) || !Array.isArray(n.pins)) return void errors.push(`${at}: must be { "name", "pins": [...] }`);
		const extra = typeof n.name === "string" ? rep?.shared.get(n.name) ?? [] : [];
		rawNets.push({
			name: n.name,
			at,
			pins: [...n.pins.map((ep, j) => ({
				ep,
				at: `${at}.pins[${j}]`
			})), ...extra]
		});
	});
	rawNets.push(...rep?.nets ?? []);
	const nets = [];
	const inNet = /* @__PURE__ */ new Map();
	const boundAs = /* @__PURE__ */ new Map();
	for (const { name, pins, at } of rawNets) {
		if (typeof name !== "string" || name === "") {
			errors.push(`${at}.name: required`);
			continue;
		}
		if (nets.some((x) => x.name === name)) {
			errors.push(`${at}.name: duplicate net "${name}"`);
			continue;
		}
		const terminals = [];
		for (const { ep, at: pat, binding } of pins) {
			const t = resolve(ep, pat);
			if (!t) continue;
			const key = terminalKey(t.ref, t.name);
			const other = inNet.get(key);
			const prior = boundAs.get(key);
			if (other !== void 0 && binding !== void 0 && prior !== void 0) {
				const text = endpointText(ep);
				if (text !== prior.text) errors.push(`${pat}: ${text} is already bound by ${prior.binding} (${terminalName({
					...t,
					hole: void 0
				})})`);
				continue;
			}
			if (other !== void 0) {
				errors.push(`${pat}: ${terminalName({
					...t,
					hole: void 0
				})} is already in net "${other}"`);
				continue;
			}
			inNet.set(key, name);
			if (binding !== void 0) boundAs.set(key, {
				binding,
				text: endpointText(ep)
			});
			terminals.push(t);
		}
		if (terminals.length < 2) errors.push(`${at}.pins: a net joins at least 2 pins`);
		nets.push({
			name,
			terminals
		});
	}
	if (rep) errors.push(...rep.errors);
	const nc = [];
	if (raw.nc !== void 0) {
		if (!Array.isArray(raw.nc)) errors.push("nc: must be a list of pins");
		else raw.nc.forEach((ep, i) => {
			const t = resolve(ep, `nc[${i}]`);
			if (!t) return;
			if (t.infra) return void errors.push(`nc[${i}]: ${terminalName(t)} is a breadboard hole group, not a pin`);
			const net = inNet.get(terminalKey(t.ref, t.name));
			if (net !== void 0) return void errors.push(`nc[${i}]: ${terminalName(t)} is in net "${net}", so it cannot be not connected`);
			nc.push(t);
		});
	}
	const groups = [];
	const groupOf = /* @__PURE__ */ new Map();
	if (raw.groups !== void 0) {
		if (!Array.isArray(raw.groups)) errors.push("groups: must be a list of { \"name\", \"parts\" }");
		else raw.groups.forEach((g, i) => {
			const at = `groups[${i}]`;
			if (!isObj(g) || typeof g.name !== "string" || g.name === "" || !Array.isArray(g.parts)) return void errors.push(`${at}: must be { "name", "parts": [refs] }`);
			const gname = g.name;
			if (gname.length > 80) return void errors.push(`${at}.name: at most 80 characters`);
			if (groups.some((x) => x.name === gname)) return void errors.push(`${at}.name: duplicate group "${gname}"`);
			const refs = [];
			g.parts.forEach((r, j) => {
				if (typeof r !== "string" || !byRef.has(r)) return void errors.push(`${at}.parts[${j}]: no part "${String(r)}"`);
				const other = groupOf.get(r);
				if (other !== void 0) return void errors.push(`${at}.parts[${j}]: ${r} is already in group "${other}"`);
				groupOf.set(r, gname);
				refs.push(r);
			});
			groups.push({
				name: gname,
				refs
			});
		});
	}
	const notes = [];
	if (raw.notes !== void 0) {
		if (!Array.isArray(raw.notes)) errors.push("notes: must be a list of { \"text\", \"near\" }");
		else raw.notes.forEach((n, i) => {
			const at = `notes[${i}]`;
			if (!isObj(n) || typeof n.text !== "string" || n.text.trim() === "") return void errors.push(`${at}.text: required`);
			if (n.text.length > 500) return void errors.push(`${at}.text: at most 500 characters`);
			const near = n.near;
			if (typeof near !== "string" || !(byRef.has(near) || groups.some((g) => g.name === near))) return void errors.push(`${at}.near: must name a part ref or a group`);
			notes.push({
				text: n.text,
				near
			});
		});
	}
	let ends;
	if (raw.wires !== void 0) {
		if (!isObj(raw.wires)) errors.push("wires: must be { \"color\": { NET: color }, \"ends\": kind }");
		else {
			const { color, ends: kind } = raw.wires;
			if (color !== void 0) {
				if (!isObj(color)) errors.push("wires.color: must map net names to colors");
				else for (const [net, c] of Object.entries(color)) {
					const target = nets.find((x) => x.name === net);
					if (!target) errors.push(`wires.color.${net}: no net "${net}"`);
					else if (typeof c !== "string" || !isValidColor(c)) errors.push(`wires.color.${net}: must be a named color or #RRGGBB`);
					else target.color = c;
				}
			}
			if (kind !== void 0) {
				if (!isEndKind(kind)) errors.push(`wires.ends: unknown cable end ${JSON.stringify(kind)}`);
				else ends = kind;
			}
		}
	}
	if (errors.length) return {
		ok: false,
		errors
	};
	const ids = [...used.keys()].sort();
	return {
		ok: true,
		intent: {
			title: raw.title,
			parts,
			nets,
			nc,
			groups,
			notes,
			copies: rep?.copies ?? [],
			modules: Object.fromEntries(ids.map((id) => [id, used.get(id)])),
			custom: ids.filter((id) => embedded.has(id)),
			...ends ? { ends } : {}
		}
	};
}
var NOTE_CHAR = 5.9;
var TAB_CHAR = 5.6;
var noteLines = (text) => text.split("\n");
/** A frame's label tab, straddling its top edge 10 px from the left. */
function frameTab(a) {
	return {
		x: a.x + 10,
		y: a.y - 8,
		w: (a.label ?? "").length * TAB_CHAR + 12,
		h: 16
	};
}
/** Everything an annotation draws, in world px: a frame with its tab, or a note's box. */
function annotationRect(a) {
	if (a.type === "frame") {
		const w = a.w ?? 0;
		const h = a.h ?? 0;
		if (!a.label) return {
			x: a.x,
			y: a.y,
			w,
			h
		};
		const t = frameTab(a);
		return {
			x: a.x,
			y: t.y,
			w: Math.max(a.x + w, t.x + t.w) - a.x,
			h: a.y + h - t.y
		};
	}
	const lines = noteLines(a.text ?? "");
	return {
		x: a.x,
		y: a.y,
		w: Math.ceil(Math.max(1, ...lines.map((l) => l.length)) * NOTE_CHAR + 12),
		h: lines.length * 13 + 12
	};
}
/** Word-wraps each paragraph to `width` characters (a longer single word keeps its own line). */
function wrapNote(text, width = 48) {
	return text.split("\n").map((para) => {
		const lines = [];
		let line = "";
		for (const word of para.split(/\s+/).filter(Boolean)) if (line && line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
		if (line) lines.push(line);
		return lines.join("\n");
	}).join("\n");
}
//#endregion
//#region src/agent/mount.ts
/**
* Whether a leg on `net` (null: on no net) clashes with a strip that already carries `prior`
* (undefined: nothing yet). A leg on no net keeps its strip to itself.
*/
var netClash = (prior, net) => prior !== void 0 && (prior === null || net === null || prior !== net);
/**
* The first strip of `board` where part `uid` (seated in `d`) puts two different nets, or a net
* and a leg on no net, counting strips the netlist names in a net; null when there is none.
* The same rule the mount search applies to every candidate.
*/
function stripClash(d, uid, board, netOf) {
	const b = d.parts.find((p) => p.uid === board);
	const stripNet = /* @__PURE__ */ new Map();
	for (const g of moduleOf(d, b.module).holes ?? []) {
		const n = netOf(board, g.name);
		if (n !== void 0) stripNet.set(g.name, n);
	}
	const plugs = plugsOf(d).filter((pl) => pl.board === board);
	for (const pl of plugs) if (pl.part !== uid) stripNet.set(pl.group, netOf(pl.part, pl.pin) ?? null);
	const mine = /* @__PURE__ */ new Map();
	for (const pl of plugs) {
		if (pl.part !== uid) continue;
		const net = netOf(uid, pl.pin) ?? null;
		if (netClash(stripNet.get(pl.group), net) || netClash(mine.get(pl.group), net)) return pl.group;
		mine.set(pl.group, net);
	}
	return null;
}
/**
* Places part `uid` (already in `d.parts`) on `board`. `d` holds the board and the parts mounted on
* it so far. `prefer` (a position the part already has) wins every tie, so a second pass only moves
* a part when that scores better. Returns the part mounted and its score, or an error naming the
* part and why no position fits.
*/
function mountPart(d, uid, board, netOf, prefer) {
	const me = d.parts.find((p) => p.uid === uid);
	const m = moduleOf(d, me.module);
	const b = d.parts.find((p) => p.uid === board);
	const bm = moduleOf(d, b.module);
	const others = d.parts.filter((p) => p.uid !== uid);
	const plugs = plugsOf({
		...d,
		parts: others
	});
	const stripNet = /* @__PURE__ */ new Map();
	for (const g of bm.holes ?? []) {
		const n = netOf(board, g.name);
		if (n !== void 0) stripNet.set(g.name, n);
	}
	for (const pl of plugs) if (pl.board === board) stripNet.set(pl.group, netOf(pl.part, pl.pin) ?? null);
	const rails = new Set((bm.holes ?? []).filter((g) => g.rail).map((g) => g.name));
	const neighbours = [...others.filter((p) => p.mount?.board === board).map((p) => tightFootprint(p, moduleOf(d, p.module))), captionBox(b, bm)];
	const idx = holeIndex(b, bm);
	const area = bodyRect(b, layoutModule(bm));
	const lay = layoutModule(m);
	const carried = new Set([...stripNet.values()].filter((n) => n !== null));
	const bound = 2 * plugPoints(me, m).filter((pp) => carried.has(netOf(uid, pp.pin) ?? -1)).length;
	let reason = "no position puts every leg on a free hole";
	/** The candidate's score, or null when it is not accepted. */
	const judge = (cand) => {
		if (seatOn({
			...d,
			parts: [...others, cand]
		}, uid, board, plugs)?.status !== "seated") return null;
		const mine = /* @__PURE__ */ new Map();
		let score = 0;
		for (const pp of plugPoints(cand, m)) {
			const hit = holeAt(idx, pp.at);
			const group = idx.groups[hit[0]].name;
			const net = netOf(uid, pp.pin) ?? null;
			const prior = stripNet.get(group);
			for (const p of [prior, mine.get(group)]) if (netClash(p, net)) {
				reason = "every position where its legs fit would join two different nets in one strip";
				return null;
			}
			if (net !== null && prior === net) score += 2;
			else if (prior === void 0 && rails.has(group)) score -= 1;
			mine.set(group, net);
		}
		const fp = tightFootprint(cand, m);
		if (neighbours.some((r) => intersects(r, fp))) {
			reason = "every position where its legs fit overlaps another part on the board";
			return null;
		}
		return score;
	};
	let best = null;
	let bestScore = -Infinity;
	if (prefer) {
		const s = judge({
			...prefer,
			mount: { board }
		});
		if (s !== null) {
			best = {
				...prefer,
				mount: { board }
			};
			bestScore = s;
		}
	}
	const reach = Math.ceil((Math.max(lay.w, lay.h) + 8) / 10) * 10;
	const x0 = b.x + Math.floor((area.x - b.x) / 10) * 10 - reach;
	const y0 = b.y + Math.floor((area.y - b.y) / 10) * 10 - reach;
	search: for (const rotation of [0, 90]) for (let y = y0; y <= area.y + area.h; y += 10) for (let x = x0; x <= area.x + area.w; x += 10) {
		if (bestScore >= bound) break search;
		const cand = {
			...me,
			x,
			y,
			rotation,
			mount: { board }
		};
		const s = judge(cand);
		if (s !== null && s > bestScore) {
			best = cand;
			bestScore = s;
		}
	}
	return best ? {
		ok: true,
		part: best,
		score: bestScore
	} : {
		ok: false,
		error: `${b.designator} has no place for ${me.designator} (${m.id}): ${reason}.`
	};
}
//#endregion
//#region src/agent/place.ts
/** Step of the ring search, in px. */
var STEP = 20;
/** Widest a group's row of parts grows before it wraps, in px. */
var GROUP_ROW = 640;
/** Space between a frame and the parts inside it. */
var FRAME_PAD = 12;
/** Where the content's top-left lands once placed (no kept parts). */
var MARGIN = 40;
var snap = (v) => Math.round(v / 10) * 10;
var floor10 = (v) => Math.floor(v / 10) * 10;
var ceil10 = (v) => Math.ceil(v / 10) * 10;
/** Ring r around (0, 0), in a fixed order: top edge left to right, right edge down, bottom edge right to left, left edge up. */
function ring(r) {
	if (r === 0) return [{
		x: 0,
		y: 0
	}];
	const out = [];
	for (let x = -r; x <= r; x++) out.push({
		x,
		y: -r
	});
	for (let y = -r + 1; y <= r; y++) out.push({
		x: r,
		y
	});
	for (let x = r - 1; x >= -r; x--) out.push({
		x,
		y: r
	});
	for (let y = r - 1; y > -r; y--) out.push({
		x: -r,
		y
	});
	return out;
}
/** The first offset near `want` (both multiples of 10) where `box` grown by `gap` clears everything in `taken`. */
function findSpot(box, want, taken, gap) {
	for (let r = 0;; r++) for (const o of ring(r)) {
		const at = {
			x: want.x + o.x * STEP,
			y: want.y + o.y * STEP
		};
		if (!taken.hits(grow(shift(box, at.x, at.y), gap))) return at;
	}
}
function placeParts(intent, opts) {
	const keep = opts.keep ?? /* @__PURE__ */ new Map();
	const mods = intent.modules;
	const inst = /* @__PURE__ */ new Map();
	for (const p of intent.parts) inst.set(p.ref, {
		uid: p.ref,
		designator: p.ref,
		module: p.module,
		x: 0,
		y: 0,
		rotation: 0,
		...p.values ? { values: p.values } : {}
	});
	const modOf = (ref) => mods[inst.get(ref).module];
	const fp = (ref) => footprint(inst.get(ref), modOf(ref));
	const tight = (ref) => tightFootprint(inst.get(ref), modOf(ref));
	const move = (refs, dx, dy) => {
		for (const r of refs) {
			const p = inst.get(r);
			inst.set(r, {
				...p,
				x: p.x + dx,
				y: p.y + dy
			});
		}
	};
	const pinNet = /* @__PURE__ */ new Map();
	const netsOf = /* @__PURE__ */ new Map();
	intent.nets.forEach((n, i) => n.terminals.forEach((t) => {
		pinNet.set(terminalKey(t.ref, t.name), i);
		netsOf.set(t.ref, (netsOf.get(t.ref) ?? /* @__PURE__ */ new Set()).add(i));
	}));
	const netOfPin = (part, pin) => pinNet.get(terminalKey(part, pin));
	const refs = intent.parts.map((p) => p.ref).sort(naturalCompare);
	const units = [];
	const grouped = /* @__PURE__ */ new Set();
	const errors = [];
	for (const ref of refs) {
		if (!isBoard(modOf(ref))) continue;
		const k = keep.get(ref);
		if (k) inst.set(ref, {
			...inst.get(ref),
			...k
		});
		let local = {
			format: DIAGRAM_FORMAT,
			title: "",
			modules: mods,
			parts: [inst.get(ref)],
			connections: []
		};
		const mounted = intent.parts.filter((q) => q.on === ref).map((q) => q.ref).sort(naturalCompare);
		const keptFirst = [...mounted.filter((m) => keep.has(m)), ...mounted.filter((m) => !keep.has(m))];
		for (const m of keptFirst) {
			const km = keep.get(m);
			if (km) {
				if (!k) {
					errors.push(`${m} is kept but its board ${ref} is not: keep ${ref} too, or drop ${m}'s position.`);
					continue;
				}
				const trial = {
					...inst.get(m),
					...km,
					mount: { board: ref }
				};
				const tried = {
					...local,
					parts: [...local.parts, trial]
				};
				const issue = mountIssues(tried).find((i) => i.part === m);
				if (issue) {
					errors.push(`${m} is kept at (${km.x}, ${km.y}) but is not seated on ${ref} there (${issue.reason}).`);
					continue;
				}
				const clash = stripClash(tried, m, ref, netOfPin);
				if (clash) {
					errors.push(`${m} is kept at (${km.x}, ${km.y}) on ${ref} but joins two different nets in strip ${clash} there.`);
					continue;
				}
				inst.set(m, trial);
				local = tried;
				continue;
			}
			if (errors.length) break;
			const r = mountPart({
				...local,
				parts: [...local.parts, inst.get(m)]
			}, m, ref, netOfPin);
			if (!r.ok) return {
				ok: false,
				errors: [r.error]
			};
			inst.set(m, r.part);
			local = {
				...local,
				parts: [...local.parts, r.part]
			};
		}
		if (!errors.length) for (const m of mounted) {
			if (keep.has(m)) continue;
			const r = mountPart(local, m, ref, netOfPin, inst.get(m));
			const was = inst.get(m);
			if (!r.ok || r.part.x === was.x && r.part.y === was.y && r.part.rotation === was.rotation) continue;
			inst.set(m, r.part);
			local = {
				...local,
				parts: local.parts.map((p) => p.uid === m ? r.part : p)
			};
		}
		units.push({
			key: ref,
			refs: [ref, ...mounted],
			anchor: true,
			fixed: !!k
		});
		for (const r of [ref, ...mounted]) grouped.add(r);
	}
	if (errors.length) return {
		ok: false,
		errors
	};
	/** A kept part outside a board is a unit of its own that never moves; `free` drops it from `list`. */
	const free = (list) => {
		for (const r of list) if (keep.has(r) && !grouped.has(r)) {
			units.push({
				key: r,
				refs: [r],
				anchor: modOf(r).category === "Microcontrollers",
				fixed: true
			});
			grouped.add(r);
		}
		return list.filter((r) => !grouped.has(r));
	};
	/** Lays refs out left to right from (0, 0), wrapping past `width`; returns their footprint box. */
	const row = (list, width) => {
		let x = 0;
		let y = 0;
		let rowH = 0;
		let box = null;
		for (const ref of list) {
			const f0 = fp(ref);
			const p = inst.get(ref);
			if (x > 0 && x + f0.w > width) {
				x = 0;
				y += rowH + 10;
				rowH = 0;
			}
			inst.set(ref, {
				...p,
				x: snap(x + p.x - f0.x),
				y: snap(y + p.y - f0.y)
			});
			const f = fp(ref);
			box = box ? union(box, f) : f;
			x = f.x + f.w + 10;
			rowH = Math.max(rowH, f.h);
		}
		return box ?? {
			x: 0,
			y: 0,
			w: 0,
			h: 0
		};
	};
	const repeats = [...new Set(intent.copies.map((c) => c.repeat))];
	if (repeats.length > 1) return {
		ok: false,
		errors: [`Placement handles one repeat block, but the intent has ${repeats.length} (${repeats.join(", ")}).`]
	};
	const copies = intent.copies.map((c) => free(c.refs)).filter((list) => list.length);
	if (copies.length) {
		const cells = copies.map((list) => ({
			refs: list,
			box: row(list, Infinity)
		}));
		const pad = opts.spacing + 24;
		const cw = Math.max(...cells.map((c) => c.box.w)) + pad;
		const ch = Math.max(...cells.map((c) => c.box.h)) + pad + 10;
		const cols = Math.ceil(Math.sqrt(cells.length));
		cells.forEach((c, i) => move(c.refs, snap(i % cols * cw - c.box.x), snap(Math.floor(i / cols) * ch - c.box.y)));
		const all = cells.flatMap((c) => c.refs);
		units.push({
			key: intent.copies[0].repeat,
			refs: all,
			anchor: false,
			fixed: false
		});
		for (const r of all) grouped.add(r);
	}
	for (const g of intent.groups) {
		const left = free(g.refs.filter((r) => !grouped.has(r)));
		if (!left.length) continue;
		row(left, GROUP_ROW);
		units.push({
			key: `group ${g.name}`,
			refs: left,
			anchor: left.some((r) => modOf(r).category === "Microcontrollers"),
			fixed: false
		});
		for (const r of left) grouped.add(r);
	}
	for (const ref of refs) {
		if (grouped.has(ref)) continue;
		row([ref], Infinity);
		units.push({
			key: ref,
			refs: [ref],
			anchor: modOf(ref).category === "Microcontrollers",
			fixed: keep.has(ref)
		});
	}
	for (const u of units) if (u.fixed) for (const r of u.refs) {
		const k = keep.get(r);
		if (k && !inst.get(r).mount) inst.set(r, {
			...inst.get(r),
			...k
		});
	}
	const taken = new RectIndex();
	const placedNets = /* @__PURE__ */ new Map();
	const boxOf = (u) => u.refs.map(fp).reduce(union);
	const netsOfUnit = (u) => new Set(u.refs.flatMap((r) => [...netsOf.get(r) ?? []]));
	const put = (u) => {
		const b = boxOf(u);
		taken.add(b);
		const c = {
			x: b.x + b.w / 2,
			y: b.y + b.h / 2
		};
		for (const n of netsOfUnit(u)) placedNets.set(n, [...placedNets.get(n) ?? [], c]);
	};
	const settle = (u, target) => {
		const b = boxOf(u);
		const at = findSpot(b, {
			x: snap(target.x - b.x - b.w / 2),
			y: snap(target.y - b.y - b.h / 2)
		}, taken, opts.spacing);
		move(u.refs, at.x, at.y);
		put(u);
	};
	for (const u of units) if (u.fixed) put(u);
	for (const u of units.filter((x) => !x.fixed && x.anchor).sort((a, b) => naturalCompare(a.key, b.key))) settle(u, {
		x: 0,
		y: 0
	});
	let rest = units.filter((x) => !x.fixed && !x.anchor);
	while (rest.length) {
		let best = rest[0];
		let bestWeight = -1;
		for (const u of rest) {
			const w = [...netsOfUnit(u)].filter((n) => placedNets.has(n)).length;
			if (w > bestWeight || w === bestWeight && naturalCompare(u.key, best.key) < 0) {
				best = u;
				bestWeight = w;
			}
		}
		const pts = [...netsOfUnit(best)].flatMap((n) => placedNets.get(n) ?? []);
		settle(best, pts.length ? {
			x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
			y: pts.reduce((s, p) => s + p.y, 0) / pts.length
		} : {
			x: 0,
			y: 0
		});
		rest = rest.filter((u) => u !== best);
	}
	const annotations = [];
	const frames = /* @__PURE__ */ new Map();
	const frameOf = (list, label) => {
		const r = grow(list.map(tight).reduce(union), FRAME_PAD);
		const x = floor10(r.x);
		const y = floor10(r.y);
		const a = {
			uid: `a${annotations.length + 1}`,
			type: "frame",
			x,
			y,
			w: ceil10(r.x + r.w) - x,
			h: ceil10(r.y + r.h) - y,
			label
		};
		annotations.push(a);
		return a;
	};
	for (const g of intent.groups) if (g.refs.length) frames.set(g.name, frameOf(g.refs, g.name));
	for (const c of intent.copies) frameOf(c.refs, `${c.repeat} ${c.index}`);
	const clear = new RectIndex();
	for (const r of refs) clear.add(tight(r));
	for (const a of annotations) clear.add(annotationRect(a));
	for (const n of intent.notes) {
		const frame = frames.get(n.near);
		const target = frame ? annotationRect(frame) : tight(n.near);
		const probe = {
			uid: `a${annotations.length + 1}`,
			type: "text",
			x: 0,
			y: 0,
			text: wrapNote(n.text)
		};
		const at = findSpot(annotationRect(probe), {
			x: snap(target.x),
			y: snap(target.y + target.h + 10)
		}, clear, 6);
		const note = {
			...probe,
			x: at.x,
			y: at.y
		};
		annotations.push(note);
		clear.add(annotationRect(note));
	}
	let out = annotations;
	const rects = [...refs.map(fp), ...annotations.map(annotationRect)];
	if (![...keep.keys()].some((r) => inst.has(r)) && rects.length) {
		const all = rects.reduce(union);
		const dx = ceil10(MARGIN - all.x);
		const dy = ceil10(MARGIN - all.y);
		move(refs, dx, dy);
		out = annotations.map((a) => ({
			...a,
			x: a.x + dx,
			y: a.y + dy
		}));
	}
	return {
		ok: true,
		parts: intent.parts.map((p) => inst.get(p.ref)),
		annotations: out
	};
}
//#endregion
//#region src/agent/internal.ts
var cache = /* @__PURE__ */ new WeakMap();
function components(m) {
	const parent = /* @__PURE__ */ new Map();
	const find = (x) => {
		let r = x;
		while (parent.has(r) && parent.get(r) !== r) r = parent.get(r);
		return r;
	};
	for (const g of m.internal ?? []) for (let i = 1; i < g.length; i++) {
		const a = find(g[0]);
		const b = find(g[i]);
		if (a !== b) parent.set(b, a);
	}
	const out = /* @__PURE__ */ new Map();
	for (const g of m.internal ?? []) for (const n of g) out.set(n, find(n));
	return out;
}
/** The pin's electrical component inside its part, named by one member; a pin joined to nothing is its own. */
function internalComponent(m, name) {
	let map = cache.get(m);
	if (!map) cache.set(m, map = components(m));
	return map.get(name) ?? name;
}
//#endregion
//#region src/agent/realize.ts
var SIGNAL_COLORS = [
	"blue",
	"green",
	"yellow",
	"orange",
	"purple",
	"white",
	"brown",
	"pink",
	"gray"
];
var groupKey = (board, group) => JSON.stringify([board, group]);
var holeKey = (board, group, hole) => JSON.stringify([
	board,
	group,
	hole
]);
var dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
function typeOf(m, name) {
	const pin = m.pins.find((p) => !isSpacer(p) && p.name === name);
	return pin ? pin.type : m.holes?.find((g) => g.name === name)?.type;
}
function realize(intent, d) {
	const errors = [];
	const plugs = plugsOf(d);
	const partBy = new Map(d.parts.map((p) => [p.uid, p]));
	const modOf = (ref) => moduleOf(d, partBy.get(ref).module);
	const used = new Set(plugs.map((pl) => holeKey(pl.board, pl.group, pl.hole)));
	const legBy = new Map(plugs.map((pl) => [terminalKey(pl.part, pl.pin), pl]));
	const netOfTerminal = /* @__PURE__ */ new Map();
	intent.nets.forEach((n, i) => n.terminals.forEach((t) => netOfTerminal.set(terminalKey(t.ref, t.name), i)));
	const strips = /* @__PURE__ */ new Map();
	for (const p of [...d.parts].sort((a, b) => naturalCompare(a.uid, b.uid))) {
		const m = moduleOf(d, p.module);
		if (!m || !isBoard(m)) continue;
		for (const g of worldHoles(p, m)) strips.set(groupKey(p.uid, g.name), {
			key: groupKey(p.uid, g.name),
			board: p.uid,
			name: g.name,
			rail: g.rail,
			holes: g.at
		});
	}
	const owner = /* @__PURE__ */ new Map();
	const reserved = /* @__PURE__ */ new Set();
	for (const pl of plugs) {
		const ni = netOfTerminal.get(terminalKey(pl.part, pl.pin));
		if (ni === void 0) reserved.add(groupKey(pl.board, pl.group));
		else owner.set(groupKey(pl.board, pl.group), ni);
	}
	const preferred = /* @__PURE__ */ new Map();
	intent.nets.forEach((n, i) => {
		for (const t of n.terminals) {
			if (!t.infra) continue;
			const g = groupKey(t.ref, t.name);
			const was = owner.get(g);
			if (reserved.has(g)) errors.push(`net ${n.name} lists ${terminalName(t)}, but a leg on no net sits in that strip`);
			else if (was !== void 0 && was !== i) errors.push(`net ${n.name} lists ${terminalName(t)}, but a leg of net ${intent.nets[was].name} sits in that strip`);
			else owner.set(g, i);
			if (t.hole !== void 0) preferred.set(g, t.hole);
		}
	});
	if (errors.length) return {
		ok: false,
		errors
	};
	const free = (s) => s.holes.flatMap((_, i) => used.has(holeKey(s.board, s.name, i)) ? [] : [i]);
	const nearestHole = (s, at) => {
		const pref = preferred.get(s.key);
		if (pref !== void 0 && !used.has(holeKey(s.board, s.name, pref))) return pref;
		let best = null;
		for (const i of free(s)) if (best === null || dist(s.holes[i], at) < dist(s.holes[best], at)) best = i;
		return best;
	};
	const stripName = (s) => `${s.board} ${s.name}`;
	const pinEnd = (t) => modOf(t.ref).holes?.some((g) => g.name === t.name) ? {
		part: t.ref,
		pin: t.name,
		hole: t.hole ?? 0
	} : {
		part: t.ref,
		pin: t.name
	};
	const pointOf = (ep) => resolveEndpoint(d, ep).end;
	const kindOf = (n) => {
		const types = n.terminals.filter((t) => !t.infra).map((t) => typeOf(modOf(t.ref), t.name));
		return types.includes("ground") ? "ground" : types.some((t) => t === "power_in" || t === "power_out") ? "power" : "signal";
	};
	const connections = [];
	const netOfWire = /* @__PURE__ */ new Map();
	const ends = intent.ends ? normalizeEnds({
		from: intent.ends,
		to: intent.ends
	}) : void 0;
	let signal = 0;
	const colors = intent.nets.map((n) => {
		const kind = kindOf(n);
		return n.color ?? (kind === "ground" ? "black" : kind === "power" ? "red" : SIGNAL_COLORS[signal++ % SIGNAL_COLORS.length]);
	});
	const wire = (ni, from, to, routing) => {
		const uid = `w${connections.length + 1}`;
		connections.push({
			uid,
			from,
			to,
			color: colors[ni],
			gauge: 22,
			...ends ? { ends } : {},
			...routing ? { routing: true } : {}
		});
		netOfWire.set(uid, intent.nets[ni].name);
	};
	const holeEnd = (s, i) => {
		used.add(holeKey(s.board, s.name, i));
		return {
			part: s.board,
			pin: s.name,
			hole: i
		};
	};
	/** The member of `node` with an end left, nearest `toward`; takes that end. */
	const take = (node, toward) => {
		let best = null;
		for (const t of node.members) {
			if (!node.left.get(t.name)) continue;
			if (!best || dist(pointOf(pinEnd(t)), toward) < dist(pointOf(pinEnd(best)), toward)) best = t;
		}
		node.left.set(best.name, node.left.get(best.name) - 1);
		return pinEnd(best);
	};
	const capOf = (n) => [...n.left.values()].reduce((a, b) => a + b, 0);
	const claim = (ni, at, kind, board) => {
		const rank = (s) => kind === "ground" ? s.rail === "-" ? 0 : s.rail ? -1 : 1 : kind === "power" ? s.rail === "+" ? 0 : s.rail ? -1 : 1 : s.rail ? -1 : 0;
		let best = null;
		let bestRank = 0;
		let bestDist = 0;
		for (const s of strips.values()) {
			const r = rank(s);
			if (r < 0 || owner.has(s.key) || reserved.has(s.key) || board !== void 0 && s.board !== board || free(s).length !== s.holes.length) continue;
			const dd = dist(s.holes[0], at);
			if (!best || r < bestRank || r === bestRank && dd < bestDist) {
				best = s;
				bestRank = r;
				bestDist = dd;
			}
		}
		if (best) owner.set(best.key, ni);
		return best;
	};
	const jumper = (ni, a, b) => {
		let pick = null;
		for (const i of free(a)) for (const j of free(b)) {
			const dd = dist(a.holes[i], b.holes[j]);
			if (!pick || dd < pick[2]) pick = [
				i,
				j,
				dd
			];
		}
		if (!pick) return false;
		wire(ni, holeEnd(a, pick[0]), holeEnd(b, pick[1]), true);
		return true;
	};
	const nearestDp = (dps, at) => {
		let best = null;
		let bestDist = 0;
		for (const s of dps) {
			const f = free(s);
			if (!f.length) continue;
			const dd = Math.min(...f.map((i) => dist(s.holes[i], at)));
			if (!best || dd < bestDist) {
				best = s;
				bestDist = dd;
			}
		}
		return best;
	};
	for (const [ni, net] of intent.nets.entries()) {
		const kind = kindOf(net);
		const dps = [];
		const addDp = (s) => {
			if (s && !dps.includes(s)) dps.push(s);
		};
		for (const t of net.terminals) if (t.infra) addDp(strips.get(groupKey(t.ref, t.name)));
		const legStrips = net.terminals.flatMap((t) => {
			const pl = legBy.get(terminalKey(t.ref, t.name));
			return pl ? [groupKey(pl.board, pl.group)] : [];
		});
		for (const k of [...new Set(legStrips)].sort(naturalCompare)) addDp(strips.get(k));
		const byComp = /* @__PURE__ */ new Map();
		for (const t of net.terminals) {
			if (t.infra || legBy.has(terminalKey(t.ref, t.name))) continue;
			const c = `${t.ref} ${internalComponent(modOf(t.ref), t.name)}`;
			byComp.set(c, [...byComp.get(c) ?? [], t]);
		}
		const nodes = [...byComp.keys()].sort(naturalCompare).map((c) => {
			const members = byComp.get(c);
			return {
				members,
				left: new Map(members.map((t) => [t.name, terminalCapacity(modOf(t.ref), t.name)]))
			};
		});
		const first = (n) => pointOf(pinEnd(n.members[0]));
		if (!dps.length) {
			if (nodes.length < 2) continue;
			const wide = nodes.filter((n) => capOf(n) >= 2);
			if (nodes.length === 2 || wide.length >= nodes.length - 2) {
				const inner = nodes.length === 2 ? [] : wide.slice(0, nodes.length - 2);
				const outer = nodes.filter((n) => !inner.includes(n));
				const chain = [
					outer[0],
					...inner,
					outer[1]
				];
				for (let k = 1; k < chain.length; k++) {
					const a = take(chain[k - 1], first(chain[k]));
					wire(ni, a, take(chain[k], pointOf(a)), false);
				}
				continue;
			}
			const pts = nodes.map(first);
			const s = claim(ni, {
				x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
				y: pts.reduce((s, p) => s + p.y, 0) / pts.length
			}, kind);
			if (!s) {
				errors.push(`needs a distribution point: net ${net.name} joins ${nodes.length} pins (${nodes.map((n) => terminalName(n.members[0])).join(", ")}), but a header pin takes one wire. Add a breadboard, a rail strip or a terminal block to the netlist.`);
				continue;
			}
			dps.push(s);
		}
		const joined = [dps[0]];
		const rest = dps.slice(1);
		let full = false;
		while (rest.length && !full) {
			let pick = null;
			for (const a of joined) for (const b of rest) {
				const fa = free(a);
				const fb = free(b);
				if (!fa.length || !fb.length) continue;
				const dd = Math.min(...fa.flatMap((i) => fb.map((j) => dist(a.holes[i], b.holes[j]))));
				if (!pick || dd < pick[2]) pick = [
					a,
					b,
					dd
				];
			}
			if (!pick || !jumper(ni, pick[0], pick[1])) full = true;
			else {
				joined.push(pick[1]);
				rest.splice(rest.indexOf(pick[1]), 1);
			}
		}
		if (full) {
			errors.push(`strip full: net ${net.name} cannot join ${rest.map(stripName).join(", ")}: no free hole left`);
			continue;
		}
		const totalFree = () => dps.reduce((sum, s) => sum + free(s).length, 0);
		for (const [k, node] of nodes.entries()) {
			const at = first(node);
			while (totalFree() < nodes.length - k) {
				const from = nearestDp(dps, at);
				const ext = from && (claim(ni, from.holes[0], kind, from.board) ?? claim(ni, at, kind));
				if (!from || !ext || !jumper(ni, from, ext)) break;
				dps.push(ext);
			}
			const target = nearestDp(dps, at);
			if (!target) {
				errors.push(`strip full: net ${net.name} has no free hole left on ${dps.map(stripName).join(", ")}`);
				break;
			}
			const e = take(node, at);
			wire(ni, e, holeEnd(target, nearestHole(target, pointOf(e))), true);
		}
	}
	return errors.length ? {
		ok: false,
		errors
	} : {
		ok: true,
		value: {
			connections,
			netOfWire
		}
	};
}
//#endregion
//#region src/agent/readability.ts
/** Every overlapping pair on the sheet, as "R1 and R2" (bodies) or "R1 caption and R2 body". */
function overlaps(d) {
	const parts = d.parts.filter((p) => moduleOf(d, p.module)).sort((a, b) => naturalCompare(a.uid, b.uid));
	const body = (p) => bodyRect(p, layoutModule(moduleOf(d, p.module)));
	const caption = (p) => captionBox(p, moduleOf(d, p.module));
	const own = (a, b) => a.mount?.board === b.uid || b.mount?.board === a.uid;
	const bodies = [];
	const captions = [];
	for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
		const [a, b] = [parts[i], parts[j]];
		if (!own(a, b) && intersects(body(a), body(b))) bodies.push(`${a.uid} and ${b.uid}`);
		if (intersects(caption(a), caption(b))) captions.push(`${a.uid} caption and ${b.uid} caption`);
	}
	for (const a of parts) for (const b of parts) if (a !== b && !own(a, b) && intersects(caption(a), body(b))) captions.push(`${a.uid} caption and ${b.uid} body`);
	return {
		body: bodies,
		caption: captions
	};
}
function readability(d, routes, netOfWire = /* @__PURE__ */ new Map()) {
	const parts = d.parts.filter((p) => moduleOf(d, p.module));
	const over = overlaps(d);
	const segs = [];
	let wireLength = 0;
	const points = [];
	[...routes.values()].forEach((r, wire) => {
		if (!r) return;
		points.push(...r.points);
		for (let k = 1; k < r.points.length; k++) {
			const [a, b] = [r.points[k - 1], r.points[k]];
			wireLength += Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
			if (a.y === b.y && a.x !== b.x) segs.push({
				wire,
				h: true,
				at: a.y,
				lo: Math.min(a.x, b.x),
				hi: Math.max(a.x, b.x)
			});
			else if (a.x === b.x && a.y !== b.y) segs.push({
				wire,
				h: false,
				at: a.x,
				lo: Math.min(a.y, b.y),
				hi: Math.max(a.y, b.y)
			});
		}
	});
	let wireCrossings = 0;
	const hs = segs.filter((s) => s.h);
	const vs = segs.filter((s) => !s.h);
	for (const h of hs) for (const v of vs) if (h.wire !== v.wire && v.at > h.lo && v.at < h.hi && h.at > v.lo && h.at < v.hi) wireCrossings++;
	const rects = [...parts.flatMap((p) => {
		const m = moduleOf(d, p.module);
		return [bodyRect(p, layoutModule(m)), captionBox(p, m)];
	}), ...points.map((p) => ({
		x: p.x,
		y: p.y,
		w: 0,
		h: 0
	}))];
	const all = rects.length ? rects.reduce(union) : {
		x: 0,
		y: 0,
		w: 0,
		h: 0
	};
	const blockedNets = [...new Set(d.connections.filter((c) => routes.get(c.uid)?.blocked).map((c) => netOfWire.get(c.uid) ?? c.label ?? c.uid))].sort(naturalCompare);
	return {
		bodyOverlaps: over.body.length,
		captionOverlaps: over.caption.length,
		wireCrossings,
		wireLength: Math.round(wireLength),
		sheet: {
			w: Math.ceil(all.w),
			h: Math.ceil(all.h)
		},
		blockedNets
	};
}
function reportText(r) {
	return `Readability: body overlaps ${r.bodyOverlaps}, caption overlaps ${r.captionOverlaps}, wire crossings ${r.wireCrossings}, wire length ${r.wireLength} px, sheet ${r.sheet.w} x ${r.sheet.h} px, blocked nets ${r.blockedNets.length ? r.blockedNets.join(", ") : "none"}.`;
}
//#endregion
//#region src/format/netlist.ts
/** One key per part pin or hole group; JSON keeps any character in a uid or name unambiguous. */
var nodeKey = (part, pin) => JSON.stringify([part, pin]);
/**
* Everything that conducts, as joins between node keys: the edges whose connected components are
* the nets. A wire conducts only when both ends resolve; a broken one stays in the file for repair
* and is listed in `broken` (file order).
*/
function conductors(d, plugs = plugsOf(d)) {
	const joins = [];
	const broken = [];
	for (const c of d.connections) if (resolveEndpoint(d, c.from) && resolveEndpoint(d, c.to)) joins.push({
		a: nodeKey(c.from.part, c.from.pin),
		b: nodeKey(c.to.part, c.to.pin),
		wire: c.uid
	});
	else broken.push(c.uid);
	for (const p of d.parts) {
		const m = moduleOf(d, p.module);
		for (const group of m?.internal ?? []) for (let i = 1; i < group.length; i++) joins.push({
			a: nodeKey(p.uid, group[0]),
			b: nodeKey(p.uid, group[i])
		});
	}
	for (const pl of plugs) joins.push({
		a: nodeKey(pl.part, pl.pin),
		b: nodeKey(pl.board, pl.group)
	});
	return {
		joins,
		broken
	};
}
function netlist(d, plugs = plugsOf(d)) {
	const parent = /* @__PURE__ */ new Map();
	const find = (k) => {
		let root = k;
		for (let up = parent.get(root); up !== void 0 && up !== root; up = parent.get(root)) root = up;
		for (let cur = k; cur !== root;) {
			const next = parent.get(cur);
			parent.set(cur, root);
			cur = next;
		}
		return root;
	};
	const join = (a, b) => {
		if (!parent.has(a)) parent.set(a, a);
		if (!parent.has(b)) parent.set(b, b);
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	};
	const { joins, broken } = conductors(d, plugs);
	for (const j of joins) join(j.a, j.b);
	const byRoot = /* @__PURE__ */ new Map();
	for (const k of parent.keys()) {
		const r = find(k);
		const list = byRoot.get(r);
		if (list) list.push(k);
		else byRoot.set(r, [k]);
	}
	const nets = [...byRoot.values()].filter((n) => n.length > 1).map((n) => n.sort());
	nets.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
	const netOf = /* @__PURE__ */ new Map();
	nets.forEach((n, i) => n.forEach((k) => netOf.set(k, i)));
	return {
		nets,
		netOf,
		broken: broken.sort()
	};
}
/** A wire end as the user reads it: the part's designator (its uid when missing), the pin label or name, and the hole or bus offset. */
function endpointName(d, ep) {
	const part = d.parts.find((p) => p.uid === ep.part);
	const pin = (part && moduleOf(d, part.module))?.pins.find((p) => !isSpacer(p) && p.name === ep.pin);
	const label = pin && !isSpacer(pin) ? pin.label ?? pin.name : ep.pin;
	const at = ep.hole !== void 0 ? ` hole ${ep.hole}` : ep.offset !== void 0 ? `[${ep.offset}]` : "";
	return `${part?.designator ?? ep.part} ${label}${at}`;
}
new Intl.Collator("en", {
	numeric: true,
	sensitivity: "base"
});
//#endregion
//#region src/agent/verify.ts
var ORDER = [
	"intent",
	"part-missing",
	"part-duplicate",
	"module-mismatch",
	"module-missing",
	"value-drift",
	"mount",
	"extra-part",
	"missing-connection",
	"merge",
	"extra-connection",
	"nc",
	"capacity"
];
var NO_INTENT = "no intent: lay out from a netlist or add intent";
/**
* How a sheet's intent finds its modules: the sheet's embedded copy first (so a later library
* change never breaks an old sheet), then the library. Ids the intent embeds itself are left to it.
*/
function intentLookup(d, library) {
	const own = isObj(d.intent) && isObj(d.intent.modules) ? new Set(Object.keys(d.intent.modules)) : /* @__PURE__ */ new Set();
	return (id) => own.has(id) ? void 0 : moduleOf(d, id) ?? library(id);
}
function verifyDiagram(d, library) {
	const found = [];
	const add = (rule, message, causes, more = {}) => found.push({
		rule,
		message,
		causes,
		parts: more.parts ?? [],
		pins: more.pins ?? [],
		wires: more.wires ?? []
	});
	if (d.intent === void 0) add("intent", NO_INTENT, ["intent"]);
	else {
		const r = parseNetlist(d.intent, intentLookup(d, library));
		if (!r.ok) add("intent", `intent is not a valid netlist: ${r.errors.slice(0, 5).join("; ")}${r.errors.length > 5 ? ` (and ${r.errors.length - 5} more)` : ""}`, ["intent"]);
		else against(d, r.intent, add);
	}
	capacity(d, add);
	found.sort((a, b) => ORDER.indexOf(a.rule) - ORDER.indexOf(b.rule) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
	const seen = /* @__PURE__ */ new Map();
	return found.map(({ causes, ...f }) => {
		const base = `${f.rule}|${[...new Set(causes)].sort().join(",")}`;
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return {
			id: n ? `${base}#${n}` : base,
			severity: "error",
			...f
		};
	});
}
/** The value a part has for a param after loading: its override when valid, else the module default. */
function effective(values, m, key) {
	const rule = PARAM_RULES[key];
	const stored = values?.[key];
	const v = isObj(stored) ? stored.value : void 0;
	if (isObj(stored) && stored.unit === rule.unit && validParamValue(key, v)) return v;
	const param = (isObj(m.electrical) && isObj(m.electrical.params) ? m.electrical.params : {})[key];
	const dflt = isObj(param) ? param.default : void 0;
	return validParamValue(key, dflt) ? dflt : void 0;
}
/** The params either module declares, in PARAM_RULES order. */
function paramKeys(...ms) {
	return Object.keys(PARAM_RULES).filter((key) => ms.some((m) => isObj(m.electrical) && isObj(m.electrical.params) && Object.hasOwn(m.electrical.params, key)));
}
/**
* Every value that differs between the intent and the sheet (amendment A2). Value params compare
* effective values on both sides (override when valid, else the module default), so an override
* the intent lacks and a dropped override are both caught. Other part state (an LED color) is
* compared as stored, in both directions.
*/
function valueDrifts(ip, want, part, have) {
	const out = [];
	const keys = /* @__PURE__ */ new Set([
		...paramKeys(want, have),
		...Object.keys(ip.values ?? {}),
		...Object.keys(part.values ?? {})
	]);
	for (const key of keys) {
		if (Object.hasOwn(PARAM_RULES, key)) {
			const unit = PARAM_RULES[key].unit;
			const w = effective(ip.values, want, key);
			const h = effective(part.values, have, key);
			if (w === h) continue;
			const show = (v) => v === void 0 ? "not set" : formatValue(v, unit);
			out.push({
				key,
				text: `${key} is ${show(h)} on the sheet but ${show(w)} in the intent.`
			});
			continue;
		}
		const w = JSON.stringify(ip.values?.[key] ?? null);
		const h = JSON.stringify(part.values?.[key] ?? null);
		if (w !== h) out.push({
			key,
			text: `${key} is ${h} on the sheet but ${w} in the intent.`
		});
	}
	return out;
}
function against(d, intent, add) {
	const byDesignator = /* @__PURE__ */ new Map();
	for (const p of d.parts) byDesignator.set(p.designator, [...byDesignator.get(p.designator) ?? [], p]);
	const uidOf = /* @__PURE__ */ new Map();
	for (const ip of intent.parts) {
		const list = byDesignator.get(ip.ref) ?? [];
		if (!list.length) {
			add("part-missing", `${ip.ref} (${ip.module}) is in the intent but not on the sheet.`, [ip.ref]);
			continue;
		}
		if (list.length > 1) {
			add("part-duplicate", `${list.length} parts on the sheet are named ${ip.ref}; the intent has one.`, [ip.ref], { parts: list.map((p) => p.uid) });
			continue;
		}
		const part = list[0];
		uidOf.set(ip.ref, part.uid);
		if (part.module !== ip.module) {
			add("module-mismatch", `${ip.ref} is a ${part.module} on the sheet but a ${ip.module} in the intent.`, [ip.ref], { parts: [part.uid] });
			continue;
		}
		const m = moduleOf(d, part.module);
		if (!m) {
			add("module-missing", `${ip.ref}'s module "${part.module}" is not embedded in the sheet.`, [ip.ref], { parts: [part.uid] });
			continue;
		}
		for (const { key, text } of valueDrifts(ip, intent.modules[ip.module] ?? m, part, m)) add("value-drift", `${ip.ref} ${text}`, [ip.ref, key], { parts: [part.uid] });
	}
	const issues = new Map(mountIssues(d).map((i) => [i.part, i]));
	for (const ip of intent.parts) {
		if (ip.on === void 0) continue;
		const uid = uidOf.get(ip.ref);
		const board = uidOf.get(ip.on);
		if (!uid || !board) continue;
		if (d.parts.find((p) => p.uid === uid).mount?.board !== board) add("mount", `${ip.ref} should plug into ${ip.on} but is not mounted on it.`, [ip.ref], { parts: [uid, board] });
		else if (issues.has(uid)) add("mount", `${ip.ref} is set to plug into ${ip.on} but is not seated (${issues.get(uid).reason}), so its legs connect nothing.`, [ip.ref], { parts: [uid, board] });
	}
	const refs = new Set(intent.parts.map((p) => p.ref));
	for (const p of d.parts) if (!refs.has(p.designator) && !isBoard(moduleOf(d, p.module))) add("extra-part", `${p.designator} (${p.module}) is on the sheet but not in the intent.`, [p.uid], { parts: [p.uid] });
	connectivity(d, intent, uidOf, add);
}
function connectivity(d, intent, uidOf, add) {
	const nl = netlist(d);
	const partBy = new Map(d.parts.map((p) => [p.uid, p]));
	const keyOf = (t) => {
		const uid = uidOf.get(t.ref);
		return uid === void 0 ? null : nodeKey(uid, t.name);
	};
	const split = (k) => JSON.parse(k);
	const pinOf = (k) => ({
		part: split(k)[0],
		pin: split(k)[1]
	});
	const nameOf = (k) => endpointName(d, pinOf(k));
	const realized = (k) => {
		const i = nl.netOf.get(k);
		return i === void 0 ? `alone ${k}` : `net ${i}`;
	};
	const want = /* @__PURE__ */ new Map();
	intent.nets.forEach((n, i) => n.terminals.forEach((t) => {
		const k = keyOf(t);
		if (k) want.set(k, i);
	}));
	intent.nets.forEach((n) => {
		const parts = /* @__PURE__ */ new Map();
		for (const t of n.terminals) {
			const k = keyOf(t);
			if (!k) continue;
			const r = realized(k);
			parts.set(r, [...parts.get(r) ?? [], k]);
		}
		if (parts.size < 2) return;
		const heads = [...parts.values()].map((ks) => ks[0]);
		add("missing-connection", `Net ${n.name} is not connected: ${heads.map(nameOf).join(", ")} are on ${parts.size} separate pieces.`, [n.name], {
			parts: heads.map((k) => split(k)[0]),
			pins: heads.map(pinOf)
		});
	});
	for (const keys of nl.nets) {
		const hit = /* @__PURE__ */ new Map();
		for (const k of keys) {
			const i = want.get(k);
			if (i !== void 0 && !hit.has(i)) hit.set(i, k);
		}
		if (hit.size < 2) continue;
		const names = [...hit.keys()].map((i) => intent.nets[i].name);
		add("merge", `Nets ${names.join(" and ")} are joined on the sheet (${[...hit.values()].map(nameOf).join(", ")}); they must stay separate.`, [...names].sort(), {
			parts: [...hit.values()].map((k) => split(k)[0]),
			pins: [...hit.values()].map(pinOf)
		});
	}
	const component = (k) => {
		const p = partBy.get(split(k)[0]);
		const m = p && moduleOf(d, p.module);
		return !!m && !isBoard(m);
	};
	const compOf = (k) => {
		const [uid, pin] = split(k);
		return `${uid}|${internalComponent(moduleOf(d, partBy.get(uid).module), pin)}`;
	};
	const ncKeys = new Set(intent.nc.map(keyOf).filter((k) => k !== null));
	const refs = new Set(intent.parts.map((p) => p.ref));
	const unresolved = (k) => {
		const p = partBy.get(split(k)[0]);
		return refs.has(p.designator) && !uidOf.has(p.designator);
	};
	for (const keys of nl.nets) {
		const members = keys.filter(component);
		const requested = new Set(members.filter((k) => want.has(k)).map(compOf));
		for (const k of members) {
			if (want.has(k) || unresolved(k)) continue;
			if (!ncKeys.has(k) && requested.has(compOf(k))) continue;
			const others = members.filter((o) => compOf(o) !== compOf(k));
			if (!others.length) continue;
			const more = others.length > 1 ? ` and ${others.length - 1} more` : "";
			if (ncKeys.has(k)) add("nc", `${nameOf(k)} must stay unconnected (nc) but is connected to ${nameOf(others[0])}${more}.`, [k], {
				parts: [split(k)[0]],
				pins: [pinOf(k)]
			});
			else add("extra-connection", `${nameOf(k)} is connected to ${nameOf(others[0])}${more}, but the intent does not connect it.`, [k], {
				parts: [split(k)[0]],
				pins: [pinOf(k)]
			});
		}
	}
}
/** Every pin, pad and hole holds no more wire ends and legs than it takes (spec 2.2 and 3). */
function capacity(d, add) {
	const plugs = plugsOf(d);
	const legOf = new Map(plugs.map((pl) => [nodeKey(pl.part, pl.pin), pl]));
	const broken = new Set(netlist(d, plugs).broken);
	const slots = /* @__PURE__ */ new Map();
	const slot = (key, what, cap, part) => {
		let s = slots.get(key);
		if (!s) slots.set(key, s = {
			what,
			cap,
			legs: 0,
			wires: [],
			part
		});
		return s;
	};
	const holeSlot = (board, group, hole) => slot(JSON.stringify([
		"hole",
		board,
		group,
		hole
	]), endpointName(d, {
		part: board,
		pin: group,
		hole
	}), 1, board);
	for (const pl of plugs) holeSlot(pl.board, pl.group, pl.hole).legs++;
	const partBy = new Map(d.parts.map((p) => [p.uid, p]));
	for (const c of d.connections) {
		if (broken.has(c.uid)) continue;
		for (const ep of [c.from, c.to]) {
			const m = moduleOf(d, partBy.get(ep.part).module);
			const group = m.holes?.find((g) => g.name === ep.pin);
			if (group && isBoard(m)) holeSlot(ep.part, ep.pin, ep.hole ?? 0).wires.push(c.uid);
			else if (group) slot(JSON.stringify([
				"pad",
				ep.part,
				ep.pin,
				ep.hole ?? 0
			]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid);
			else {
				const leg = legOf.get(nodeKey(ep.part, ep.pin));
				if (leg) holeSlot(leg.board, leg.group, leg.hole).wires.push(c.uid);
				else slot(JSON.stringify([
					"pin",
					ep.part,
					ep.pin
				]), endpointName(d, ep), terminalCapacity(m, ep.pin), ep.part).wires.push(c.uid);
			}
		}
	}
	for (const [key, s] of slots) {
		if (s.legs + s.wires.length <= s.cap) continue;
		const ends = `${s.wires.length} wire end${s.wires.length === 1 ? "" : "s"}`;
		const holds = s.legs ? `a leg and ${ends}` : ends;
		add("capacity", `${s.what} holds ${holds} but takes ${s.cap === 1 ? "one" : s.cap}.`, [key], {
			parts: [s.part],
			wires: s.wires
		});
	}
}
//#endregion
//#region src/agent/layout.ts
var SPACINGS = [
	20,
	40,
	60
];
function layoutNetlist(raw, opts = {}) {
	const library = opts.library ?? libraryLookup;
	const parsed = parseNetlist(raw, library);
	if (!parsed.ok) return {
		ok: false,
		stage: "input",
		errors: parsed.errors
	};
	const intent = parsed.intent;
	let blocked = [];
	for (const [i, spacing] of SPACINGS.entries()) {
		const placed = placeParts(intent, {
			spacing,
			keep: opts.keep
		});
		if (!placed.ok) return {
			ok: false,
			stage: "layout",
			errors: placed.errors
		};
		const base = {
			format: DIAGRAM_FORMAT,
			title: intent.title,
			modules: intent.modules,
			parts: placed.parts,
			connections: [],
			...placed.annotations.length ? { annotations: placed.annotations } : {},
			intent: structuredClone(raw)
		};
		const over = overlaps(base);
		if (over.body.length || over.caption.length) return {
			ok: false,
			stage: "layout",
			errors: [...over.body.map((o) => `body overlap: ${o}; move one of them`), ...over.caption.map((o) => `caption overlap: ${o}; move one of them`)]
		};
		const real = realize(intent, base);
		if (!real.ok) return {
			ok: false,
			stage: "layout",
			errors: real.errors
		};
		const diagram = {
			...base,
			connections: real.value.connections
		};
		const routes = computeRoutes(diagram);
		const stuck = diagram.connections.filter((c) => routes.get(c.uid)?.blocked);
		blocked = [...new Set(stuck.map((c) => real.value.netOfWire.get(c.uid)))].sort(naturalCompare);
		const far = stuck.filter((c) => {
			const [a, b] = [resolveEndpoint(diagram, c.from), resolveEndpoint(diagram, c.to)];
			return a && b && !withinReach(a.end, b.end);
		});
		if (far.length) {
			const span = diagram.parts.map((p) => tightFootprint(p, moduleOf(diagram, p.module))).reduce(union);
			const nets = [...new Set(far.map((c) => real.value.netOfWire.get(c.uid)))].sort(naturalCompare);
			return {
				ok: false,
				stage: "layout",
				errors: [`sheet too large to route: parts span ${Math.ceil(span.w)} x ${Math.ceil(span.h)} px; keep parts within about ${ROUTE_REACH} px of each other (nets ${nets.join(", ")}).`]
			};
		}
		if (blocked.length) continue;
		const findings = verifyDiagram(diagram, library);
		if (findings.length) return {
			ok: false,
			stage: "layout",
			errors: findings.map((f) => `verify ${f.rule}: ${f.message}`)
		};
		return {
			ok: true,
			value: {
				diagram,
				report: readability(diagram, routes, real.value.netOfWire),
				intent,
				attempts: i + 1,
				netOfWire: real.value.netOfWire
			}
		};
	}
	return {
		ok: false,
		stage: "layout",
		errors: [`routes blocked after ${SPACINGS.length} placements with more spacing each time: ${blocked.join(", ")}`]
	};
}
//#endregion
//#region src/agent/partial.ts
var PARTIAL_FORMAT = "circuitoon-partial/1";
var ROTATIONS = [
	0,
	90,
	180,
	270
];
function loadPartial(raw) {
	if (!isObj(raw)) return {
		ok: false,
		errors: ["partial must be a JSON object"]
	};
	const errors = [];
	if (raw.format !== "circuitoon-partial/1") errors.push(`format: must be "${PARTIAL_FORMAT}" (copy the sheet, change its format, and delete x and y on the parts to place again)`);
	if (!isObj(raw.intent)) errors.push("intent: required, the netlist the sheet was laid out from");
	const keep = /* @__PURE__ */ new Map();
	const seen = /* @__PURE__ */ new Map();
	if (!Array.isArray(raw.parts)) errors.push("parts: required list");
	else raw.parts.forEach((p, i) => {
		const at = `parts[${i}]`;
		if (!isObj(p) || typeof p.designator !== "string") return void errors.push(`${at}.designator: required`);
		const first = seen.get(p.designator);
		if (first !== void 0) return void errors.push(`${at}.designator: ${p.designator} is already listed at parts[${first}]`);
		seen.set(p.designator, i);
		if (p.x === void 0 && p.y === void 0) return;
		if (!isNum(p.x) || !isNum(p.y)) return void errors.push(`${at}: give both x and y, or neither`);
		if (p.x % 10 !== 0 || p.y % 10 !== 0) return void errors.push(`${at}: x and y must be on the 10 px grid`);
		const rotation = p.rotation === void 0 ? 0 : p.rotation;
		if (!ROTATIONS.includes(rotation)) return void errors.push(`${at}.rotation: must be 0, 90, 180 or 270`);
		keep.set(p.designator, {
			x: p.x,
			y: p.y,
			rotation
		});
	});
	return errors.length ? {
		ok: false,
		errors
	} : {
		ok: true,
		intent: raw.intent,
		keep
	};
}
//#endregion
//#region src/agent/tables.ts
function quantities(intent) {
	const count = /* @__PURE__ */ new Map();
	for (const p of intent.parts) count.set(p.module, (count.get(p.module) ?? 0) + 1);
	return [...count].map(([module, n]) => ({
		module,
		name: intent.modules[module].name,
		count: n,
		custom: intent.custom.includes(module)
	})).sort((a, b) => naturalCompare(a.name, b.name));
}
function channelTable(intent) {
	return intent.copies.flatMap((c) => Object.entries(c.bindings).map(([port, endpoint]) => ({
		copy: c.id,
		port,
		endpoint
	})));
}
function quantitiesText(rows) {
	return rows.map((r) => `  ${r.count} x ${r.name} [${r.module}]${r.custom ? " (custom, unverified)" : ""}`).join("\n");
}
function channelsText(rows) {
	const w1 = Math.max(4, ...rows.map((r) => r.copy.length));
	const w2 = Math.max(4, ...rows.map((r) => r.port.length));
	return [`${"copy".padEnd(w1)}  ${"port".padEnd(w2)}  bound to`, ...rows.map((r) => `${r.copy.padEnd(w1)}  ${r.port.padEnd(w2)}  ${r.endpoint}`)].join("\n");
}
//#endregion
//#region src/cli/layoutCmd.ts
/** Designators the partial keeps that are not parts of its intent (after repeat expansion). */
function unknownKept(path, intent, keep) {
	const parsed = parseNetlist(intent, libraryLookup);
	if (!parsed.ok) return [];
	const refs = new Set(parsed.intent.parts.map((p) => p.ref));
	return [...keep.keys()].filter((ref) => !refs.has(ref)).sort(naturalCompare).map((ref) => `${path} names ${ref}, which is not a part of its intent; its position is ignored`);
}
function layoutCommand(args, io) {
	const json = args.flags.has("--json");
	const out = flag(args, "--out");
	const keepPath = flag(args, "--keep");
	const [input] = args.positionals;
	if (!out) throw new CliError("layout: -o <sheet.json> is required", EXIT.input);
	if (!input === !keepPath) throw new CliError("layout: give a netlist file, or --keep <partial.json>, but not both", EXIT.input);
	let raw;
	let keep;
	let warnings = [];
	if (keepPath) {
		const p = loadPartial(readJson(io, keepPath));
		if (!p.ok) throw new CliError(`${keepPath}: ${p.errors.join("; ")}`, EXIT.input);
		raw = p.intent;
		keep = p.keep;
		warnings = unknownKept(keepPath, raw, keep);
	} else raw = readJson(io, input);
	if (!json) for (const w of warnings) io.stderr(`warning: ${w}\n`);
	const r = layoutNetlist(raw, { keep });
	if (!r.ok) {
		if (json) printJson(io, {
			format: "circuitoon-cli/layout/1",
			ok: false,
			output: null,
			attempts: 0,
			report: null,
			quantities: [],
			channels: [],
			warnings,
			errors: r.errors
		});
		else io.stderr(`${r.stage === "input" ? "The netlist is not valid" : "The netlist cannot be laid out"}:\n${r.errors.map((e) => `  - ${e}`).join("\n")}\n`);
		return r.stage === "input" ? EXIT.input : EXIT.blocked;
	}
	const { diagram, report, intent, attempts } = r.value;
	writeFile(io, out, serializeDiagram(diagram));
	const q = quantities(intent);
	const ch = channelTable(intent);
	if (json) {
		printJson(io, {
			format: "circuitoon-cli/layout/1",
			ok: true,
			output: out,
			attempts,
			report,
			quantities: q,
			channels: ch,
			warnings,
			errors: []
		});
		return EXIT.ok;
	}
	io.stdout([
		`Laid out "${diagram.title}" into ${out}: ${diagram.parts.length} parts, ${diagram.connections.length} wires (placement ${attempts} of ${SPACINGS.length}).`,
		reportText(report),
		"Bill of quantities:",
		quantitiesText(q),
		...ch.length ? ["Channel allocation:", channelsText(ch)] : [],
		...intent.custom.length ? [`Custom parts (unverified): ${intent.custom.join(", ")}`] : []
	].join("\n") + "\n");
	return EXIT.ok;
}
//#endregion
//#region src/cli/main.ts
var USAGE = `circuitoon <command> [options]

  parts [--search text] [--json]            built-in parts: pins, labels, types, supplies, hole groups
  part <id> [--json]                        one part in full
  layout <netlist.json> -o <sheet.json>     lay out a netlist; or layout --keep <partial.json> -o <sheet.json>
  verify <sheet.json> [--json]              the sheet against its intent
  check <sheet.json> [--json]               the wiring checker, plus verify when the sheet has an intent
  render <sheet.json> -o <sheet.png> [--svg <sheet.svg>] [--dark] [--scale n] [--focus <copy or group>]
  link <sheet.json> [-o <dir>] [--json]     a link that opens the sheet in Circuitoon
  gate <sheet.json> -o <dir> [--json]       every check, the renders and the link; exits 0 only when nothing blocks

Exit codes: 0 ok, 1 findings that block, 2 invalid input, 3 environment problem (such as no browser).
`;
var COMMANDS = {
	parts: partsCommand,
	part: partCommand,
	layout: layoutCommand
};
var CODE_OF = {
	[EXIT.blocked]: "blocked",
	[EXIT.input]: "input",
	[EXIT.environment]: "environment"
};
async function main(argv, io) {
	const json = argv.includes("--json");
	const fail = (exit, code, message, usage = false) => {
		if (json) printJson(io, {
			format: "circuitoon-cli/error/1",
			ok: false,
			exit,
			error: {
				code,
				message
			}
		});
		else io.stderr(`${message}\n${usage ? `\n${USAGE}` : ""}`);
		return exit;
	};
	const parsed = parseArgs(argv);
	if (!parsed.ok) return fail(EXIT.input, "usage", parsed.error, true);
	const args = parsed.value;
	if (args.command === void 0 || args.command === "help" || args.flags.has("--help")) {
		io.stdout(USAGE);
		return EXIT.ok;
	}
	const command = Object.hasOwn(COMMANDS, args.command) ? COMMANDS[args.command] : void 0;
	if (!command) return fail(EXIT.input, "usage", `unknown command "${args.command}"`, true);
	try {
		return await command(args, io);
	} catch (err) {
		if (err instanceof CliError) return fail(err.code, CODE_OF[err.code] ?? "internal", err.message);
		if (!json) throw err;
		return fail(EXIT.blocked, "internal", `internal error: ${err instanceof Error ? err.message : String(err)}`);
	}
}
/**
* Runs the CLI on this process; plugin/bin/circuitoon.mjs calls it. A reader that closes early
* (`circuitoon parts --json | head`) ends the run quietly instead of with an EPIPE stack trace.
*/
function run(argv) {
	process.stdout.on("error", (e) => {
		if (e.code !== "EPIPE") throw e;
		process.exit();
	});
	return main(argv, {
		stdout: (s) => void process.stdout.write(s),
		stderr: (s) => void process.stderr.write(s),
		cwd: process.cwd(),
		env: process.env
	});
}
//#endregion
export { COMMANDS, USAGE, main, run };
