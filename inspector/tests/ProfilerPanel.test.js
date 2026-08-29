import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment } from "./test_helpers.js";
import * as profilerModule from "../src/panels/ProfilerPanel.js";

describe("ProfilerPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("accumulateProfiler tracks frame statistics, peak, and byType counts", () => {
        const { accumulateProfiler } = profilerModule;
        const acc = {
            frames: 0,
            total: 0,
            peak: 0,
            last: 0,
            history: [],
            types: new Map(),
            insts: new Map(),
            badFrames: 0,
            lastProblem: "",
            unattributed: 0
        };

        const measurement1 = {
            frame: 1,
            total: 50,
            unattributed: 2,
            byType: [{ key: "op:123", name: "PathData", opCode: 123, count: 10 }],
            byInstance: [{ id: 1, name: "PathData", key: "op:123", count: 10 }]
        };

        accumulateProfiler(acc, measurement1, 50);
        assert.strictEqual(acc.frames, 1);
        assert.strictEqual(acc.total, 50);
        assert.strictEqual(acc.peak, 50);
        assert.strictEqual(acc.last, 50);
        assert.strictEqual(acc.unattributed, 2);
        assert.strictEqual(acc.badFrames, 0);

        const typeEntry = acc.types.get("op:123");
        assert.ok(typeEntry, "Should record type entry");
        assert.strictEqual(typeEntry.total, 10);
        assert.strictEqual(typeEntry.peak, 10);
    });

    test("accumulateProfiler detects bad frames with unexpected ops count", () => {
        const { accumulateProfiler } = profilerModule;
        const acc = {
            frames: 0,
            total: 0,
            peak: 0,
            last: 0,
            history: [],
            types: new Map(),
            insts: new Map(),
            badFrames: 0,
            lastProblem: "",
            unattributed: 0
        };

        const measurement = {
            frame: 2,
            total: 75,
            byType: [],
            byInstance: []
        };

        accumulateProfiler(acc, measurement, 50);
        assert.strictEqual(acc.badFrames, 1);
        assert.ok(acc.lastProblem.includes("expected 50"));
    });

    test("armProfiler connects measurementSink to player and receives live frame measurements", () => {
        const { armProfiler, resetProfilerTotals } = profilerModule;
        resetProfilerTotals();

        let sinkCallback = null;
        const mockPlayer = {
            setMeasurementSink: (fn) => {
                sinkCallback = fn;
            },
            getOpsPerFrame: () => 42
        };

        globalThis.window.currentPlayer = mockPlayer;
        armProfiler();

        assert.ok(typeof sinkCallback === 'function', "armProfiler must attach sinkCallback function to player");

        // Simulate frame measurement from player runtime
        sinkCallback({
            frame: 1,
            total: 42,
            unattributed: 0,
            byType: [{ key: "op:81", name: "FloatExpression", opCode: 81, count: 5 }],
            byInstance: [{ id: 10, name: "FloatExpression", key: "op:81", count: 5 }]
        });

        // Test drawProfiler rendering
        profilerModule.drawProfiler();
        const lastEl = document.getElementById('prof-last');
        const framesEl = document.getElementById('prof-frames');
        if (lastEl) assert.strictEqual(lastEl.textContent, '42');
        if (framesEl) assert.strictEqual(framesEl.textContent, '1');
    });

    test("toggleProfilerMeasurement toggles measuring state and disarms sink when OFF", () => {
        const { toggleProfilerMeasurement, armProfiler } = profilerModule;
        let sink = null;
        const mockPlayer = {
            setMeasurementSink: (fn) => {
                sink = fn;
            }
        };
        globalThis.window.currentPlayer = mockPlayer;

        // Toggle OFF
        toggleProfilerMeasurement();
        assert.strictEqual(sink, null, "Should disarm sink when toggled OFF");

        // Toggle back ON
        toggleProfilerMeasurement();
        assert.ok(typeof sink === 'function', "Should re-arm sink when toggled ON");
    });

    test("coverage excludes wire framing, which would otherwise bury the signal", () => {
        const { computeCoverage } = profilerModule;
        // ContainerEnd (214) closes a container for the reader and has an empty apply(), so the
        // engine never executes one. Counting them reported a thousand "never ran" operations
        // on a document with a thousand containers and nothing else.
        globalThis.currentParsedOps = [
            { OP_CODE: 214 }, { OP_CODE: 214 },
            { OP_CODE: 42 }, { OP_CODE: 46 }
        ];
        const { total, never } = computeCoverage({});
        assert.strictEqual(total, 2, "only executable operations are counted");
        assert.strictEqual(never.length, 2, "neither draw op has been measured in this fixture");
    });

    test("coverage reads the measurement stamp, not a guess", () => {
        const { computeCoverage } = profilerModule;
        // OperationMeasurement stamps an operation with a symbol-keyed id the first time it
        // counts one, and only then. An operation without it has never been counted.
        const measured = { OP_CODE: 42 };
        measured[Symbol("rcMeasureId")] = 7;
        globalThis.currentParsedOps = [measured, { OP_CODE: 46 }];

        const { executed, never, total } = computeCoverage({});
        assert.strictEqual(total, 2);
        assert.strictEqual(executed.length, 1);
        assert.strictEqual(never.length, 1);
        assert.strictEqual(executed[0].id, 7);
        assert.strictEqual(never[0].idx, 1, "the uncounted operation keeps its command-list index");
    });

    test("coverage is empty when there is nothing loaded", () => {
        const { computeCoverage } = profilerModule;
        globalThis.currentParsedOps = [];
        assert.deepStrictEqual(computeCoverage({}), { executed: [], never: [], total: 0 });
    });
});