/**
 * ExpressionParser — infix to RPN, matching the Java `ExpressionParser`.
 *
 * Compiles `"windowWidth / 2"` or `"50 + sin(time) * 10"` into a FloatExpression op and
 * returns the result as NaN-encoded id *bits*.
 *
 * Every element of the RPN array is 32 bits:
 *   number literal -> the float's raw bits
 *   variable       -> asNan(varId)
 *   operator       -> asNan(OFFSET + opId)
 *   function       -> asNan(OFFSET + funcId)
 *
 * The array is `number[]` holding bit patterns, never JS floats. Storing a NaN-encoded
 * id as a float and reading it back canonicalises the payload and silently destroys
 * the id, so the bits are never allowed to become a float in transit.
 */

import { asNanBits, floatToRawIntBits } from "./wire.js";
import type { Writer } from "./writer.js";

export const OFFSET = 0x310000;

export class ExpressionError extends Error {}

export const OPERATORS: Record<string, number> = {
    "+": 1, "-": 2, "*": 3, "/": 4, "%": 5, "u-": 73,
};
const PRECEDENCE: Record<string, number> = {
    "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3,
};
export const FUNCTIONS: Record<string, number> = {
    sin: 18, cos: 19, tan: 20, asin: 21, acos: 22, atan: 23, atan2: 24,
    sqrt: 9, abs: 10, pow: 8, min: 6, max: 7, floor: 14, ceil: 31,
    log: 15, ln: 16, sign: 11, round: 17, lerp: 49, step: 44,
    smooth_step: 50, clamp: 27, ifElse: 26, mad: 25, ping_pong: 54,
    fract: 53, exp: 13, hypot: 47, square: 45, rand: 39,
    arrayMin: 34, arrayMax: 33, arrayLength: 37, arraySum: 35,
    arraySumSqr: 78, arraySumXY: 77, arrayGet: 32, spline: 38,
    arraySpline: 38, splineLoop: 75, anim: 256,
};
/** System variable token -> the absolute id handed to asNan. */
const SYSTEM_VARS: Record<string, number> = {
    time: 1, seconds: 2,
    windowWidth: 5, "windowWidth()": 5, windowHeight: 6, "windowHeight()": 6,
    animationTime: 30, touchTime: 29, density: 27, fontSize: 33,
    rand: OFFSET + 39, "rand()": OFFSET + 39,
    "a[0]": OFFSET + 70, "a[1]": OFFSET + 71, "a[2]": OFFSET + 72,
};
const COMPONENT_WIDTH_VARS = new Set(["width", "componentWidth", "componentWidth()"]);
const COMPONENT_HEIGHT_VARS = new Set(["height", "componentHeight", "componentHeight()"]);
/** Recognised as variables by the Java side, but not implemented here. */
const UNSUPPORTED_VARS = new Set(["touchX", "touchY"]);

export function isVariableRef(s: string): boolean {
    return s.length >= 2 && (s.startsWith("$") || s.startsWith("@"));
}

export function variableNameFromRef(s: string): string {
    if (s.startsWith("$vars.") || s.startsWith("@vars.")) return s.slice(6);
    return s.slice(1);
}

function isNumber(token: string): boolean {
    if (token.trim() === "") return false;
    // `Number()` accepts "0x10" and "Infinity"; the Java parser's Float.parseFloat
    // does not accept hex, so reject anything that is not plain decimal notation.
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(token)) return false;
    return Number.isFinite(Number(token));
}

function isAlnum(c: string): boolean {
    return /[0-9A-Za-z]/.test(c);
}

export class ExpressionParser {
    constructor(
        private writer: Writer,
        /** name -> NaN-id bits */
        private variables: Map<string, number>,
    ) {}

    /**
     * Compile `value` into a FloatExpression op and return its asNan(id) bits.
     *
     * A string is a plain expression. `{value, anim}` is an animated one, using the
     * cubic-standard easing the Java writer defaults to.
     */
    parseExpression(value: unknown): number {
        if (typeof value === "string") {
            return this.writer.floatExpression(this.infixToRpn(value));
        }
        if (value && typeof value === "object") {
            const v = value as Record<string, unknown>;
            const ops = this.infixToRpn(String(v.value));
            const duration = v.anim === undefined ? 1.0 : Number(v.anim);
            // anim(duration) with no spec/init/wrap emits [duration] — and nothing at
            // all when the duration is the 1.0 default.
            return this.writer.floatExpression(ops, duration !== 1.0 ? [duration] : null);
        }
        throw new ExpressionError(`expression value type ${typeof value} not supported`);
    }

    isVariable(token: string): boolean {
        if (isVariableRef(token)) {
            const name = variableNameFromRef(token);
            if (!name) return false;
            return [...name].every((c) => isAlnum(c) || c === "_" || c === ".");
        }
        if (this.variables.has(token)) return true;
        return (
            token in SYSTEM_VARS ||
            UNSUPPORTED_VARS.has(token) ||
            COMPONENT_WIDTH_VARS.has(token) ||
            COMPONENT_HEIGHT_VARS.has(token)
        );
    }

    variableNanBits(token: string): number {
        if (token in SYSTEM_VARS) return asNanBits(SYSTEM_VARS[token]);
        if (COMPONENT_WIDTH_VARS.has(token)) return this.writer.addComponentWidthValue();
        if (COMPONENT_HEIGHT_VARS.has(token)) return this.writer.addComponentHeightValue();
        if (UNSUPPORTED_VARS.has(token)) {
            throw new ExpressionError(`system variable '${token}' (touch) not yet supported`);
        }
        if (isVariableRef(token)) {
            const name = variableNameFromRef(token);
            const hit = this.variables.get(name);
            if (hit !== undefined) return hit;
            throw new ExpressionError(`Variable not found: ${name}`);
        }
        const hit = this.variables.get(token);
        if (hit !== undefined) return hit;
        throw new ExpressionError(`Unknown variable: ${token}`);
    }

    // ── compiler ─────────────────────────────────────────────────────────

    infixToRpn(expression: string): number[] {
        const output: number[] = [];
        const stack: string[] = [];
        const tokens = this.tokenize(expression);
        let lastWasOperator = true;

        const emitOp = (op: string): void => {
            if (op in OPERATORS) output.push(asNanBits(OFFSET + OPERATORS[op]));
            else if (op in FUNCTIONS) output.push(asNanBits(OFFSET + FUNCTIONS[op]));
        };

        for (const token of tokens) {
            if (isNumber(token)) {
                output.push(floatToRawIntBits(Number(token)));
                lastWasOperator = false;
            } else if (this.isVariable(token)) {
                output.push(this.variableNanBits(token));
                lastWasOperator = false;
            } else if (token in FUNCTIONS) {
                stack.push(token);
                lastWasOperator = true;
            } else if (token === ",") {
                while (stack.length && stack[stack.length - 1] !== "(") {
                    emitOp(stack.pop()!);
                }
                lastWasOperator = true;
            } else if (token in OPERATORS || token === "-") {
                if (token === "-" && lastWasOperator) {
                    stack.push("u-");
                } else {
                    while (stack.length && stack[stack.length - 1] in OPERATORS) {
                        const p1 = PRECEDENCE[stack[stack.length - 1]] ?? 0;
                        const p2 = PRECEDENCE[token] ?? 0;
                        if (p1 > p2 || (p1 === p2 && token !== "u-")) emitOp(stack.pop()!);
                        else break;
                    }
                    stack.push(token);
                }
                lastWasOperator = true;
            } else if (token === "(") {
                stack.push(token);
                lastWasOperator = true;
            } else if (token === ")") {
                while (stack.length && stack[stack.length - 1] !== "(") {
                    emitOp(stack.pop()!);
                }
                if (!stack.length) throw new ExpressionError("Mismatched parentheses");
                stack.pop();
                if (stack.length && stack[stack.length - 1] in FUNCTIONS) {
                    emitOp(stack.pop()!);
                }
                lastWasOperator = false;
            } else {
                throw new ExpressionError(`Unknown token in expression: ${token}`);
            }
        }
        while (stack.length) emitOp(stack.pop()!);
        return output;
    }

    private tokenize(expression: string): string[] {
        const tokens: string[] = [];
        let sb = "";
        let i = 0;
        const n = expression.length;
        while (i < n) {
            const c = expression[i];
            if (/\s/.test(c)) {
                i++;
                continue;
            }
            if (isAlnum(c) || "_.$@[]".includes(c)) {
                sb += c;
            } else if (c === "(") {
                // `foo()` is one token, so a no-argument system variable such as
                // `windowWidth()` stays a single name rather than a call.
                if (i + 1 < n && expression[i + 1] === ")") {
                    sb += "()";
                    i++;
                } else {
                    if (sb) { tokens.push(sb); sb = ""; }
                    tokens.push("(");
                }
            } else {
                if (sb) { tokens.push(sb); sb = ""; }
                tokens.push(c);
            }
            i++;
        }
        if (sb) tokens.push(sb);

        // Fold a unary minus into the literal that follows it, so `-3` is one number
        // rather than a negate applied to 3 — the Java tokenizer does the same, and the
        // RPN differs if it does not.
        const merged: string[] = [];
        i = 0;
        while (i < tokens.length) {
            const t = tokens[i];
            if (t === "-" && i + 1 < tokens.length && isNumber(tokens[i + 1])) {
                const prev = merged.length ? merged[merged.length - 1] : null;
                const isUnary =
                    prev === null || prev === "(" || prev === "," ||
                    (prev.length === 1 && prev in OPERATORS);
                if (isUnary) {
                    merged.push("-" + tokens[i + 1]);
                    i += 2;
                    continue;
                }
            }
            merged.push(t);
            i++;
        }
        return merged;
    }
}
