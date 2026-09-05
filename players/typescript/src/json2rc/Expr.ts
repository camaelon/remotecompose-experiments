/**
 * ExpressionParser — infix to RPN, ported from `rcj/expr.py`.
 *
 * An expression compiles to a FloatExpression op and the *result* is a NaN-boxed id, carried
 * as raw int32 bits throughout. Never let one of these become a JS number and back: NaN
 * payloads do not survive canonicalisation, and the id inside them is the whole point.
 *
 * RPN element encodings:
 *   number   -> float32 raw bits
 *   variable -> asNan(varId)
 *   operator -> asNan(OFFSET + opId)
 *   function -> asNan(OFFSET + funcId)
 *
 * The tables below are generated from expr.py rather than retyped, so the two cannot drift.
 */
import { asNanBits, floatToRawIntBits } from "./WireBuffer";

export class ExpressionError extends Error {}

const OFFSET = 3211264;
const RAND_SEED_OP = 40;
const OPERATORS: Record<string, number> = { "+": 1, "-": 2, "*": 3, "/": 4, "%": 5, "u-": 73 };
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "u-": 3 };
const FUNCTIONS: Record<string, number | null> = { "seed": null, "seed_2arg": null, "sin": 18, "cos": 19, "tan": 20, "asin": 21, "acos": 22, "atan": 23, "atan2": 24, "sqrt": 9, "abs": 10, "pow": 8, "min": 6, "max": 7, "floor": 14, "ceil": 31, "log": 15, "ln": 16, "sign": 11, "round": 17, "lerp": 49, "step": 44, "smooth_step": 50, "clamp": 27, "ifElse": 26, "mad": 25, "ping_pong": 54, "fract": 53, "exp": 13, "hypot": 47, "square": 45, "rand": 39, "arrayMin": 34, "arrayMax": 33, "arrayLength": 37, "arraySum": 35, "arraySumSqr": 78, "arraySumXY": 77, "arrayGet": 32, "spline": 38, "arraySpline": 38, "splineLoop": 75, "anim": 256 };
const SYSTEM_VARS: Record<string, number> = { "time": 1, "continuousSec": 1, "continuousSec()": 1, "seconds": 2, "timeInSec": 2, "timeInSec()": 2, "timeInMin": 3, "timeInMin()": 3, "timeInHr": 4, "timeInHr()": 4, "animationTime": 30, "animationTime()": 30, "animTime": 30, "deltaTime": 31, "deltaTime()": 31, "delta_time": 31, "dt": 31, "animationDeltaTime": 31, "animationDeltaTime()": 31, "epochSecond": 32, "epochSecond()": 32, "calendarMonth": 9, "calendarMonth()": 9, "month": 9, "offsetToUtc": 10, "offsetToUtc()": 10, "utcOffset": 10, "weekDay": 11, "weekDay()": 11, "weekday": 11, "dayOfWeek": 11, "dayOfMonth": 12, "dayOfMonth()": 12, "day": 12, "dayOfYear": 34, "dayOfYear()": 34, "year": 35, "year()": 35, "windowWidth": 5, "windowWidth()": 5, "windowHeight": 6, "windowHeight()": 6, "density": 27, "density()": 27, "apiLevel": 28, "apiLevel()": 28, "fontSize": 33, "fontSize()": 33, "touchX": 13, "touchX()": 13, "touchPosX": 13, "touchPositionX": 13, "touchY": 14, "touchY()": 14, "touchPosY": 14, "touchPositionY": 14, "touchVelX": 15, "touchVelX()": 15, "touchVelocityX": 15, "touchVelY": 16, "touchVelY()": 16, "touchVelocityY": 16, "touchTime": 29, "touchTime()": 29, "touchEventTime": 29, "touchEventTime()": 29, "accelX": 17, "accelX()": 17, "accelerationX": 17, "accelerationX()": 17, "accelY": 18, "accelY()": 18, "accelerationY": 18, "accelerationY()": 18, "accelZ": 19, "accelZ()": 19, "accelerationZ": 19, "accelerationZ()": 19, "gyroX": 20, "gyroX()": 20, "gyroRotX": 20, "gyroRotX()": 20, "gyroRotationX": 20, "gyroY": 21, "gyroY()": 21, "gyroRotY": 21, "gyroRotY()": 21, "gyroRotationY": 21, "gyroZ": 22, "gyroZ()": 22, "gyroRotZ": 22, "gyroRotZ()": 22, "gyroRotationZ": 22, "magneticX": 23, "magneticX()": 23, "magneticY": 24, "magneticY()": 24, "magneticZ": 25, "magneticZ()": 25, "light": 26, "light()": 26, "lightLevel": 26, "rand": 3211303, "rand()": 3211303, "a[0]": 3211334, "a[1]": 3211335, "a[2]": 3211336 };

export function isVariableRef(s: string): boolean {
    return s.length >= 2 && (s.startsWith("$") || s.startsWith("@"));
}

export function variableNameFromRef(s: string): string {
    if (s.startsWith("$vars.") || s.startsWith("@vars.")) return s.slice(6);
    return s.slice(1);
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Component-value variables resolve through the writer, not to a fixed system id. */
const COMPONENT_WIDTH_VARS = new Set(["width", "componentWidth", "componentWidth()"]);
const COMPONENT_HEIGHT_VARS = new Set(["height", "componentHeight", "componentHeight()"]);

export interface ExprWriter {
    floatExpression(opsBits: number[], animFloats?: number[] | null): number;
    addComponentValue(valueType: number): number;
}

export class ExpressionParser {
    constructor(private writer: ExprWriter,
                private variables: { has(n: string): boolean;
                                     get(n: string): number | undefined }) {}

    parseExpression(value: any): number {
        if (typeof value === "string") {
            return this.writer.floatExpression(this.infixToRpn(value));
        }
        if (value && typeof value === "object") {
            const ops = this.infixToRpn(String(value.value));
            const duration = Number(value.anim ?? 1.0);
            // anim(duration) with the default easing writes nothing extra at 1.0.
            return this.writer.floatExpression(ops, duration !== 1.0 ? [duration] : null);
        }
        throw new ExpressionError(`cannot compile expression ${JSON.stringify(value)}`);
    }

    isVariable(token: string): boolean {
        if (COMPONENT_WIDTH_VARS.has(token) || COMPONENT_HEIGHT_VARS.has(token)) return true;
        if (token in SYSTEM_VARS) return true;
        const name = isVariableRef(token) ? variableNameFromRef(token) : token;
        return this.variables.has(name);
    }

    variableNanBits(token: string): number {
        if (COMPONENT_WIDTH_VARS.has(token)) return this.writer.addComponentValue(0);
        if (COMPONENT_HEIGHT_VARS.has(token)) return this.writer.addComponentValue(1);
        if (token in SYSTEM_VARS) return asNanBits(SYSTEM_VARS[token]);
        const name = isVariableRef(token) ? variableNameFromRef(token) : token;
        const bits = this.variables.get(name);
        if (bits === undefined) throw new ExpressionError(`Unknown variable: ${token}`);
        return bits;
    }

    private isNumber(token: string): boolean {
        return NUMBER_RE.test(token);
    }

    private tokenize(expression: string): string[] {
        const tokens: string[] = [];
        let sb = "";
        for (let i = 0; i < expression.length; i++) {
            const c = expression[i];
            if (/\s/.test(c)) continue;
            if (/[A-Za-z0-9]/.test(c) || "_.$@[]".includes(c)) {
                sb += c;
            } else if (c === "(") {
                // "foo()" is one token: a no-argument system variable, not a call.
                if (i + 1 < expression.length && expression[i + 1] === ")") { sb += "()"; i++; }
                else { if (sb) { tokens.push(sb); sb = ""; } tokens.push("("); }
            } else {
                if (sb) { tokens.push(sb); sb = ""; }
                tokens.push(c);
            }
        }
        if (sb) tokens.push(sb);

        // Merge a unary "-" with a following literal into one negative literal.
        const merged: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t === "-" && i + 1 < tokens.length && this.isNumber(tokens[i + 1])) {
                const prev = merged.length ? merged[merged.length - 1] : null;
                const unary = prev === null || prev === "(" || prev === "," ||
                              prev in OPERATORS;
                if (unary) { merged.push("-" + tokens[i + 1]); i++; continue; }
            }
            merged.push(t);
        }
        return merged;
    }

    infixToRpn(expression: string, extraFunctions?: Record<string, number>): number[] {
        const FUNCS: Record<string, number | null> =
            extraFunctions ? { ...FUNCTIONS, ...extraFunctions } : FUNCTIONS;
        const output: number[] = [];
        const stack: string[] = [];
        let lastWasOperator = true;

        const emitOp = (op: string): void => {
            if (op in OPERATORS) output.push(asNanBits(OFFSET + OPERATORS[op]));
            else if (op in FUNCS && FUNCS[op] !== null) {
                output.push(asNanBits(OFFSET + (FUNCS[op] as number)));
            }
        };

        for (const token of this.tokenize(expression)) {
            if (this.isNumber(token)) {
                output.push(floatToRawIntBits(parseFloat(token)));
                lastWasOperator = false;
            } else if (this.isVariable(token)) {
                output.push(this.variableNanBits(token));
                lastWasOperator = false;
            } else if (token in FUNCS) {
                stack.push(token);
                lastWasOperator = true;
            } else if (token === ",") {
                while (stack.length && stack[stack.length - 1] !== "(") emitOp(stack.pop()!);
                // seed(a, b): RAND_SEED is emitted *at the comma*, between its operands, and
                // the entry renamed so the closing paren emits nothing more.
                if (stack.length >= 2 && stack[stack.length - 1] === "(" &&
                    stack[stack.length - 2] === "seed") {
                    output.push(asNanBits(OFFSET + RAND_SEED_OP));
                    stack[stack.length - 2] = "seed_2arg";
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
                while (stack.length && stack[stack.length - 1] !== "(") emitOp(stack.pop()!);
                if (!stack.length) throw new ExpressionError("Mismatched parentheses");
                stack.pop();
                if (stack.length && stack[stack.length - 1] in FUNCS) {
                    const fn = stack.pop()!;
                    if (fn === "seed") {
                        output.push(asNanBits(OFFSET + RAND_SEED_OP));
                        output.push(floatToRawIntBits(1.0));
                    } else if (fn !== "seed_2arg") emitOp(fn);
                }
                lastWasOperator = false;
            } else {
                throw new ExpressionError(`Unknown token in expression: ${token}`);
            }
        }
        while (stack.length) {
            const op = stack.pop()!;
            if (op === "seed") {
                output.push(asNanBits(OFFSET + RAND_SEED_OP));
                output.push(floatToRawIntBits(1.0));
            } else if (op !== "seed_2arg") emitOp(op);
        }
        return output;
    }
}
