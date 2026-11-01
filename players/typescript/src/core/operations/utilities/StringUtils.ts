// StringUtils: float-to-string formatting utilities.
// Port of Java StringUtils.java.

export const GROUPING_NONE = 0;   // e.g. 1234567890.12
export const GROUPING_BY3 = 1;    // e.g. 1,234,567,890.12
export const GROUPING_BY4 = 2;    // e.g. 12,3456,7890.12
export const GROUPING_BY32 = 3;   // e.g. 1,23,45,67,890.12

export const SEPARATOR_COMMA_PERIOD = 0; // e.g. 123,456.12
export const SEPARATOR_PERIOD_COMMA = 1; // e.g. 123.456,12
export const SEPARATOR_SPACE_COMMA = 2;  // e.g. 123 456,12
export const SEPARATOR_UNDER_PERIOD = 3; // e.g. 123_456.12

export const NO_OPTIONS = 0;
export const NEGATIVE_PARENTHESES = 1;
export const ROUNDING = 2;
export const POINT_ZERO = 4;

export const PAD_NONE = 0;
export const PAD_ZERO = 0x30; // '0'
export const PAD_SPACE = 0x20; // ' '

// Java computes all of this in 32-bit floats, and the digits it prints come from Float.toString
// of a value scaled in floats. Doubles give different digits (0.1 * 57 and friends), so every
// step here goes through Math.fround.
const F_TENTH = Math.fround(0.1);

/** Java Float.toString: shortest digits that read back as this float; d.dddE<n> out of [1e-3, 1e7). */
export function javaFloatToString(v: number): string {
    if (Number.isNaN(v)) return 'NaN';
    if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
    if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
    const sign = v < 0 ? '-' : '';
    const a = Math.abs(v);
    let sci = '';
    for (let p = 0; p < 9; p++) {
        sci = a.toExponential(p);
        if (Math.fround(Number(sci)) === a) break;
    }
    const ePos = sci.indexOf('e');
    const d = sci.substring(0, ePos).replace('.', '');
    const e = Number(sci.substring(ePos + 1));
    if (a >= Math.fround(1e-3) && a < 1e7) {
        if (e >= 0) {
            if (d.length <= e + 1) return `${sign}${d}${'0'.repeat(e + 1 - d.length)}.0`;
            return `${sign}${d.substring(0, e + 1)}.${d.substring(e + 1)}`;
        }
        return `${sign}0.${'0'.repeat(-e - 1)}${d}`;
    }
    return `${sign}${d[0]}.${d.length > 1 ? d.substring(1) : '0'}E${e}`;
}

/** Java Math.round(float): floor(x + 0.5), NaN gives 0, saturating at the int range. */
function javaRound(x: number): number {
    if (Number.isNaN(x)) return 0;
    return Math.fround(Math.max(-2147483648, Math.min(2147483647, Math.floor(x + 0.5))));
}

/** Java (int) of a float, as its decimal digits. */
function javaIntString(x: number): string {
    if (Number.isNaN(x)) return '0';
    return String(Math.max(-2147483648, Math.min(2147483647, Math.trunc(x))));
}

/** Java (long) of a float. */
function javaLong(x: number): bigint {
    if (Number.isNaN(x)) return 0n;
    if (x >= 9223372036854775807) return 9223372036854775807n;
    if (x <= -9223372036854775808) return -9223372036854775808n;
    return BigInt(Math.trunc(x));
}

/**
 * The integer digits of StringUtils.tochars; the only part of its result floatToString reads.
 * ROUNDING applies here, while the decimals come from the unrounded value % 1, so Java gives
 * 9.995 at 2 decimals as "10.99".
 */
function integerDigits(value: number, beforeDecimalPoint: number, afterDecimalPoint: number, rounding: boolean): string {
    if (rounding) {
        let roundingFactor = 0.5;
        for (let i = 0; i < afterDecimalPoint; i++) {
            roundingFactor = Math.fround(roundingFactor / 10);
        }
        value = Math.fround(value + roundingFactor);
    }
    const digits = javaLong(value).toString();
    const intLength = digits === '0' ? 1 : digits.length;
    return digits.substring(digits.length - Math.min(beforeDecimalPoint, intLength));
}

/** Scale, Math.round, scale back, Float.toString(...).substring(2, after + 2), trim, pad. */
function fractionDigits(fractionalPart: number, scaleDigits: number, afterDecimalPoint: number,
                        post: number, keep: number): string {
    for (let i = 0; i < scaleDigits; i++) fractionalPart = Math.fround(fractionalPart * 10);
    fractionalPart = javaRound(fractionalPart);
    for (let i = 0; i < scaleDigits; i++) fractionalPart = Math.fround(fractionalPart * F_TENTH);
    const str = javaFloatToString(fractionalPart);
    let fact = str.substring(2, Math.min(str.length, afterDecimalPoint + 2));
    let trim = fact.length;
    for (let i = fact.length - 1; i >= keep; i--) {
        if (fact[i] !== '0') break;
        trim--;
    }
    fact = fact.substring(0, trim);
    if (post !== 0 && fact.length < afterDecimalPoint) {
        fact += String.fromCharCode(post).repeat(afterDecimalPoint - fact.length);
    }
    return fact;
}

function padInteger(s: string, beforeDecimalPoint: number, pre: number): string {
    if (s.length < beforeDecimalPoint) {
        return pre !== 0 ? String.fromCharCode(pre).repeat(beforeDecimalPoint - s.length) + s : s;
    }
    return s.substring(s.length - beforeDecimalPoint);
}

/**
 * Legacy float-to-string: padding before/after decimal, no grouping/separator.
 */
export function floatToStringLegacy(
    value: number,
    beforeDecimalPoint: number,
    afterDecimalPoint: number,
    pre: number,  // char code, 0 = no pad
    post: number  // char code, 0 = no pad
): string {
    const isNeg = value < 0;
    if (isNeg) value = -value;
    const integerPart = padInteger(javaIntString(value), beforeDecimalPoint, pre);
    if (afterDecimalPoint === 0) return (isNeg ? '-' : '') + integerPart;
    const fact = fractionDigits(value % 1, afterDecimalPoint, afterDecimalPoint, post, 0);
    return (isNeg ? '-' : '') + integerPart + '.' + fact;
}

/**
 * Full float-to-string with grouping, separators, and options.
 */
export function floatToStringFull(
    value: number,
    beforeDecimalPoint: number,
    afterDecimalPoint: number,
    pre: number,   // char code, 0 = no pad
    post: number,  // char code, 0 = no pad
    separator: number,
    grouping: number,
    options: number
): string {
    let groupSep = ',';
    let decSep = '.';
    switch (separator) {
        case SEPARATOR_PERIOD_COMMA:
            groupSep = '.'; decSep = ','; break;
        case SEPARATOR_SPACE_COMMA:
            groupSep = ' '; decSep = ','; break;
        case SEPARATOR_UNDER_PERIOD:
            groupSep = '_'; decSep = '.'; break;
        // default is SEPARATOR_COMMA_PERIOD: groupSep=',', decSep='.'
    }

    const useParenthesesForNeg = (options & NEGATIVE_PARENTHESES) !== 0;
    const rounding = (options & ROUNDING) !== 0;
    const isNeg = value < 0;
    if (isNeg) value = -value;

    let integerPartString = integerDigits(value, beforeDecimalPoint, afterDecimalPoint, rounding);

    if (grouping !== GROUPING_NONE) {
        const len = integerPartString.length;
        const first = grouping === GROUPING_BY4 ? 4 : 3;
        const step = grouping === GROUPING_BY4 ? 4 : grouping === GROUPING_BY32 ? 2 : 3;
        for (let i = len - first; i > 0; i -= step) {
            integerPartString = integerPartString.substring(0, i)
                + groupSep + integerPartString.substring(i);
        }
    }

    // At most 9 digits in all, unless padding after the point.
    const iLen = integerPartString.length;
    integerPartString = padInteger(integerPartString, beforeDecimalPoint, pre);
    let trimAfter = afterDecimalPoint;
    if (iLen + afterDecimalPoint > 9) trimAfter = Math.max(1, 9 - iLen);
    if (post === 0) afterDecimalPoint = trimAfter;

    const wrap = (body: string): string => {
        if (!isNeg) return body;
        return useParenthesesForNeg ? `(${body})` : `-${body}`;
    };
    if (afterDecimalPoint === 0) return wrap(integerPartString);
    const fact = fractionDigits(value % 1, trimAfter, afterDecimalPoint, post, 1);
    return wrap(integerPartString + decSep + fact);
}
