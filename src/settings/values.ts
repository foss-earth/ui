import type {
  BuiltInParameterUnit,
  NumberRange,
  ParameterBounds,
  ParameterChoice,
  ParameterSpec,
  ParameterUnit,
  ParameterValue,
} from "./types.js";

export function isNumberRange(value: unknown): value is NumberRange {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as NumberRange).min === "number" && typeof (value as NumberRange).max === "number"
    && Object.keys(value).length === 2;
}

export function sameValue(a: ParameterValue | undefined, b: ParameterValue | undefined): boolean {
  if (a === b) return true;
  if (isNumberRange(a) && isNumberRange(b)) return a.min === b.min && a.max === b.max;
  return false;
}

export function copyValue<T extends ParameterValue>(value: T): T {
  return (isNumberRange(value) ? { min: value.min, max: value.max } : value) as T;
}

/**
 * Why a value is not acceptable for a spec, or null when it is. Values are
 * checked, never repaired: an out-of-bounds number is refused, not clamped.
 */
export function validateValue(
  spec: ParameterSpec,
  value: unknown,
  bounds: ParameterBounds | null,
  choices: readonly ParameterChoice[],
): string | null {
  switch (spec.kind) {
    case "boolean":
      return typeof value === "boolean" ? null : "Expected on or off.";
    case "text":
      return typeof value === "string" ? null : "Expected text.";
    case "choice":
      if (typeof value !== "string") return "Expected one of the choices.";
      if (choices.some(choice => choice.id === value)) return null;
      return `"${value}" is not one of ${choices.map(choice => choice.label).join(", ") || "the choices"}.`;
    case "number": {
      if (typeof value === "string") {
        return spec.named?.some(named => named.id === value) ? null : `"${value}" is not a number or a named value.`;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) return "Expected a number.";
      if (bounds && (value < bounds.min || value > bounds.max)) {
        return `${formatQuantity(spec.unit, value)} is outside ${formatQuantity(spec.unit, bounds.min)} to ${formatQuantity(spec.unit, bounds.max)}.`;
      }
      return null;
    }
    case "range": {
      if (!isNumberRange(value) || !Number.isFinite(value.min) || !Number.isFinite(value.max)) return "Expected a range with two ends.";
      if (value.min > value.max) return "The range's ends are reversed.";
      if (bounds && (value.min < bounds.min || value.max > bounds.max)) {
        return `${formatQuantity(spec.unit, value.min)} to ${formatQuantity(spec.unit, value.max)} is outside ${formatQuantity(spec.unit, bounds.min)} to ${formatQuantity(spec.unit, bounds.max)}.`;
      }
      return null;
    }
  }
}

/**
 * Reads a value written as text, as in a URL: numbers, named values,
 * `min..max` or `min,max` ranges, and on/off, true/false, 1/0.
 */
export function parseValue(spec: ParameterSpec, text: string): ParameterValue | null {
  const raw = text.trim();
  switch (spec.kind) {
    case "boolean": {
      const lower = raw.toLowerCase();
      if (["1", "true", "on", "yes"].includes(lower)) return true;
      if (["0", "false", "off", "no"].includes(lower)) return false;
      return null;
    }
    case "text":
    case "choice":
      return raw;
    case "number": {
      if (spec.named?.some(named => named.id === raw)) return raw;
      if (raw === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    }
    case "range": {
      const parts = raw.includes("..") ? raw.split("..") : raw.split(",");
      if (parts.length !== 2 || parts.some(part => part.trim() === "")) return null;
      const [min, max] = parts.map(part => Number(part));
      return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
    }
  }
}

/** The value as it goes into a URL: the inverse of parseValue. */
export function stringifyValue(value: ParameterValue): string {
  if (isNumberRange(value)) return `${value.min}..${value.max}`;
  return String(value);
}

// One formatter for every call: toLocaleString with options builds a new one each time, which the settings
// panels' hundreds of numbers made a noticeable cost at startup.
const NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  const rounded = magnitude >= 100 ? Math.round(value) : magnitude >= 1 ? Math.round(value * 100) / 100 : Math.round(value * 1000) / 1000;
  return NUMBER_FORMAT.format(rounded);
}

const UNIT_TEXT: Record<BuiltInParameterUnit, string> = {
  MiB: "MiB",
  px: "px",
  ms: "ms",
  s: "s",
  h: "h",
  m: "m",
  Hz: "Hz",
  count: "",
  levels: "levels",
  ratio: "×",
  fraction: "%",
  deg: "°",
  "deg/px": "°/px",
  "deg/s": "°/s",
  "m/s": "m/s",
  fps: "fps",
  samples: "samples",
  "per-frame": "per frame",
  "per-notch": "per notch",
  "per-px": "per px",
  "per-s": "per s",
  none: "",
};

export function unitId(unit: ParameterUnit): string {
  return typeof unit === "string" ? unit : unit.id;
}

export function unitSuffix(unit: ParameterUnit): string {
  const text = unitText(unit);
  if (text === "") return "";
  return text === "°" || text === "×" || text === "%" ? text : ` ${text}`;
}

/** A number in its unit for display; a fraction shows as a percentage. */
export function formatQuantity(unit: ParameterUnit, value: number): string {
  if (unit === "fraction") return `${formatNumber(value * 100)}%`;
  return `${formatNumber(value)}${unitSuffix(unit)}`;
}

/** A value for display: "256 MiB", "on", "4 to 64 px", "8%", or a choice's label. */
export function formatValue(spec: ParameterSpec, value: ParameterValue, choices: readonly ParameterChoice[] = spec.choices ?? []): string {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (isNumberRange(value)) {
    return spec.unit === "fraction"
      ? `${formatQuantity(spec.unit, value.min)} to ${formatQuantity(spec.unit, value.max)}`
      : `${formatNumber(value.min)} to ${formatNumber(value.max)}${unitSuffix(spec.unit)}`;
  }
  if (typeof value === "number") return formatQuantity(spec.unit, value);
  if (spec.kind === "choice") return choices.find(choice => choice.id === value)?.label ?? value;
  if (spec.kind === "number") return spec.named?.find(named => named.id === value)?.label ?? value;
  if (spec.sensitive) return value ? "set" : "not set";
  return value === "" ? "empty" : value;
}

/** A unit's own text, "MiB", "°", "%" or "" for a count, as a phrase writes it beside a value or in a label. */
export function unitText(unit: ParameterUnit): string {
  return typeof unit === "string" ? UNIT_TEXT[unit] : unit.text;
}

/**
 * A number as a slider writes it: always the same number of characters, so
 * the box around it never changes width while a value moves. `pad` is the
 * leading zeros drawn faint, then the sign (when the range has negatives)
 * and the digits: "0" "10" for 10 fps on a 10 to 240 track.
 */
export interface NumberFace {
  pad: string;
  sign: string;
  digits: string;
}

export interface NumberFaces {
  /** Characters every value takes, padding included. */
  chars: number;
  /** True when large values are shortened to three figures and k, M or G: "10.7M". */
  compact: boolean;
  show(value: number): NumberFace;
  /** The value rounded to what `show` writes, in the parameter's own unit; compact faces leave it as it is. */
  round(value: number): number;
}

/** Values at or above this, in the unit shown, are written with k, M or G. */
const COMPACT_FROM = 100_000;
const COMPACT_SUFFIXES = ["", "k", "M", "G", "T"] as const;

function decimalsOf(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let decimals = 0; decimals <= 3; decimals += 1) {
    if (Math.abs(Math.round(step * 10 ** decimals) - step * 10 ** decimals) < 1e-6) return decimals;
  }
  return 3;
}

/** Three significant figures, then k, M or G: "0.10", "15.0", "150", "1.50k", "10.7M". */
function compactDigits(magnitude: number): string {
  let tier = 0;
  let mantissa = magnitude;
  while (tier < COMPACT_SUFFIXES.length - 1 && Math.round(mantissa * 100) / 100 >= 1000) { mantissa /= 1000; tier += 1; }
  const decimals = mantissa >= 99.95 ? 0 : mantissa >= 9.995 ? 1 : 2;
  let text = mantissa.toFixed(decimals);
  // 999.9 rounds up to the next tier: "1.00k", not "1000".
  if (Number(text) >= 1000 && tier < COMPACT_SUFFIXES.length - 1) { tier += 1; text = (mantissa / 1000).toFixed(2); }
  return `${text}${COMPACT_SUFFIXES[tier]}`;
}

/**
 * How a number parameter's slider writes its values across its whole range:
 * the step's decimals (or, on a log2 scale, enough that one step from the
 * small end shows: 010 to 240 fps, 0.25 to 2.00 ×), leading zeros up to the
 * widest value, a
 * sign on every value when the range goes below zero, and three figures with
 * k, M or G once values reach 100,000. A fraction is written as a percentage.
 */
export function numberFaces(spec: Pick<ParameterSpec, "unit" | "step" | "scale">, bounds: NumberRange | null): NumberFaces {
  const factor = spec.unit === "fraction" ? 100 : 1;
  const low = (bounds?.min ?? 0) * factor;
  const high = (bounds?.max ?? 0) * factor;
  const widest = Math.max(Math.abs(low), Math.abs(high));
  const signed = low < 0;
  const compact = widest >= COMPACT_FROM;
  let decimals = 0;
  if (compact || spec.unit === "count") decimals = 0;
  else if (spec.scale === "log2") {
    // Fine enough that one step from the small end shows as a new value, so keys never stick.
    const smallest = Math.min(Math.abs(low), Math.abs(high)) || widest;
    const smallestStep = smallest * (2 ** (spec.step ?? 0.05) - 1);
    decimals = smallestStep > 0 ? Math.min(3, Math.max(0, Math.ceil(-Math.log10(smallestStep) - 1e-9))) : 0;
  } else if (spec.step) decimals = decimalsOf(spec.step * factor);
  else if (high > low) decimals = Math.min(3, Math.max(0, Math.ceil(-Math.log10((high - low) / 200))));
  const integerDigits = compact ? 0 : Math.max(1, String(Math.floor(Number(widest.toFixed(decimals)))).length);
  const width = compact ? 5 : integerDigits + (decimals > 0 ? decimals + 1 : 0);
  const chars = width + (signed ? 1 : 0);
  const round = (value: number): number => {
    if (compact || !Number.isFinite(value)) return value;
    const shown = Math.round(value * factor * 10 ** decimals) / 10 ** decimals / factor;
    return Object.is(shown, -0) ? 0 : shown;
  };
  return {
    chars,
    compact,
    round,
    show(value) {
      const shown = value * factor;
      const magnitude = Math.abs(shown);
      let digits = compact ? compactDigits(magnitude) : magnitude.toFixed(decimals);
      // A value that rounds to zero carries no minus sign.
      const zero = Number(digits.replace(/[kMGT]$/, "")) === 0;
      const sign = !signed ? "" : zero ? "±" : shown < 0 ? "−" : "+";
      if (!compact && digits.split(".")[0].length > integerDigits) digits = magnitude.toFixed(0);
      const pad = "0".repeat(Math.max(0, width - digits.length));
      return { pad, sign, digits };
    },
  };
}

/** A number typed into a slider's field: "1,024", "−5", "10.7M" and "1.5k" all read. */
export function parseShownNumber(text: string): number | null {
  const match = /^([+−-]?)\s*([\d,]*\.?\d*)\s*([kKmMgGtT]?)$/.exec(text.trim().replace(/^±/, ""));
  if (!match || !/\d/.test(match[2])) return null;
  const tier = ["", "k", "m", "g", "t"].indexOf(match[3].toLowerCase());
  const value = Number(match[2].replace(/,/g, "")) * 1000 ** Math.max(0, tier);
  if (!Number.isFinite(value)) return null;
  return match[1] === "−" || match[1] === "-" ? -value : value;
}
