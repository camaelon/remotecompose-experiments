// A tiny generator that shows the contract: a filled square of a given size, drawn with a
// path the server computes. {"$gen": {"kind": "demo-box", "size": 40}}
export const kind = "demo-box";
export const doc = "A square path of the given size, for testing the $gen hook";
export function generate(spec, ctx) {
    const s = Number(spec.size ?? 40);
    const p = ctx.path("demo", [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: s, y: 0 }, { type: "lineTo", x: s, y: s }, { type: "lineTo", x: 0, y: s }, { type: "close" }]);
    return { canvas: { modifiers: [{ size: s }], commands: [{ type: "drawPath", path: p }] } };
}
