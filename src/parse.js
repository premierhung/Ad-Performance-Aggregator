/**
 * Numeric field parsers that read ASCII digits straight from a byte buffer,
 * so the hot loop never allocates a string per field.
 */

/** Returned by the parsers when a field is not a valid number. */
export const INVALID = -1;

const DIGIT_ZERO = 0x30;
const DECIMAL_POINT = 0x2e;

// 15 digits stay below Number.MAX_SAFE_INTEGER (about 9.007e15).
const MAX_INTEGER_DIGITS = 15;
// Whole dollars are scaled by 100, so they get two digits less.
const MAX_WHOLE_DOLLAR_DIGITS = 13;
const MAX_FRACTION_DIGITS = 2;

/**
 * Parses bytes [start, end) as a non-negative decimal integer.
 *
 * @param {Uint8Array} bytes
 * @param {number} start inclusive
 * @param {number} end exclusive
 * @returns {number} the value, or INVALID
 */
export function parseUnsignedInt(bytes, start, end) {
  const length = end - start;
  if (length < 1 || length > MAX_INTEGER_DIGITS) return INVALID;

  let value = 0;
  for (let i = start; i < end; i++) {
    const digit = bytes[i] - DIGIT_ZERO;
    if (digit < 0 || digit > 9) return INVALID;
    value = value * 10 + digit;
  }
  return value;
}

/**
 * Parses bytes [start, end) as a non-negative money amount ("45", "45.5",
 * "45.50") and returns it in whole cents. Integer cents add up exactly, while
 * summing millions of floats accumulates rounding error.
 *
 * Amounts with more than two fractional digits are INVALID: rounding them
 * here would silently change the data.
 *
 * @param {Uint8Array} bytes
 * @param {number} start inclusive
 * @param {number} end exclusive
 * @returns {number} the amount in cents, or INVALID
 */
export function parseCents(bytes, start, end) {
  let i = start;
  let dollars = 0;
  for (; i < end && bytes[i] !== DECIMAL_POINT; i++) {
    const digit = bytes[i] - DIGIT_ZERO;
    if (digit < 0 || digit > 9) return INVALID;
    dollars = dollars * 10 + digit;
  }

  const wholeDigits = i - start;
  if (wholeDigits < 1 || wholeDigits > MAX_WHOLE_DOLLAR_DIGITS) return INVALID;
  if (i === end) return dollars * 100;

  const fractionStart = i + 1;
  const fractionDigits = end - fractionStart;
  if (fractionDigits < 1 || fractionDigits > MAX_FRACTION_DIGITS) return INVALID;

  const tenths = bytes[fractionStart] - DIGIT_ZERO;
  if (tenths < 0 || tenths > 9) return INVALID;
  if (fractionDigits === 1) return dollars * 100 + tenths * 10;

  const hundredths = bytes[fractionStart + 1] - DIGIT_ZERO;
  if (hundredths < 0 || hundredths > 9) return INVALID;
  return dollars * 100 + tenths * 10 + hundredths;
}
