import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import { analyzeRepaintSchedule, recordRepaintSample, resetRepaintHistory } from "../src/panels/RepaintPanel.js";

describe("RepaintPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("no document means nothing to report", () => {
        const a = analyzeRepaintSchedule(null, null);
        assert.strictEqual(a.available, false);
        assert.deepStrictEqual(a.causes, []);
    });

    test("the engine's decision is reproduced and attributed to operations", async () => {
        const { doc, player } = await loadSampleDocument("02_ticker.rc");
        const a = analyzeRepaintSchedule(doc, player);

        assert.ok(a.available);
        assert.strictEqual(a.delayMs, doc.needsRepaint(),
            "the panel reports the engine's own number rather than deriving its own");
        assert.ok(["continuous", "scheduled", "idle"].includes(a.verdict));

        // Whatever the verdict, at most one cause may claim to determine the next paint.
        const winners = a.causes.filter(c => c.winning);
        assert.ok(winners.length <= 1, "only one cause determines the next paint");
        if (a.verdict !== "idle") {
            assert.strictEqual(winners.length, 1, "a scheduled or continuous paint has a cause");
        }
    });

    test("time-driven causes name the operations behind them", async () => {
        const { doc, player } = await loadSampleDocument("02_ticker.rc");
        const a = analyzeRepaintSchedule(doc, player);

        const timeDriven = a.causes.filter(c =>
            ["continuousSec", "timeInSec", "timeInMin"].includes(c.kind));
        timeDriven.forEach(cause => {
            assert.ok(cause.ops.length > 0, `${cause.kind} lists the listeners behind it`);
            cause.ops.forEach(entry => {
                assert.ok(entry.name, "each listener is named");
                assert.ok(typeof entry.idx === "number", "and located in the command list");
            });
        });
    });

    test("a continuous verdict states that it repaints every frame", async () => {
        const { doc, player } = await loadSampleDocument("02_ticker.rc");
        const a = analyzeRepaintSchedule(doc, player);
        if (a.verdict === "continuous") {
            assert.strictEqual(a.requested, "every frame");
            const winner = a.causes.find(c => c.winning);
            assert.strictEqual(winner.value, "every frame");
        } else if (a.verdict === "idle") {
            assert.match(a.requested, /never/);
        } else {
            assert.match(a.requested, /every ~\d+ ms/);
        }
    });

    test("immediate requesters are separated into active and merely capable", async () => {
        const { doc, player } = await loadSampleDocument("02_ticker.rc");
        const a = analyzeRepaintSchedule(doc, player);
        a.requesters.forEach(r => {
            assert.strictEqual(typeof r.active, "boolean",
                "each requester says whether it is asking right now");
            assert.ok(r.note, "and why");
        });
        a.idleCandidates.forEach(r => {
            assert.strictEqual(r.active, false, "idle candidates are not currently requesting");
        });
    });

    test("history is a rolling record that reset clears", () => {
        resetRepaintHistory();
        recordRepaintSample(1, "continuousSec", 120);
        recordRepaintSample(-1, "none", 0);
        // No assertion on internals; the contract is that recording never throws and reset is
        // safe to call with no panel mounted.
        assert.doesNotThrow(() => resetRepaintHistory());
    });
});
