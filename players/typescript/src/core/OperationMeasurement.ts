// OperationMeasurement — per-frame operation counting hooks.
//
// This is *not* a profiler. It is the measurement surface a profiler is built on: it
// counts what executed, per frame, and hands the frame's counts to whoever asked for
// them. Accumulation, graphing, statistics and any notion of "slow" belong to the
// consumer.
//
// Deliberately not measured here:
//
//   * time. Much of a document's cost lands on a render thread the player does not own,
//     so a wall-clock number attributed to an operation would be misleading more often
//     than it was useful. Counts are honest about what they are.
//   * bytes, allocations, or anything requiring instrumentation inside operations. Every
//     count here comes from the single call site the engine already had.
//
// ## Cost when disabled
//
// `RemoteContext.incrementOpCount` already existed and was already called once per
// executed operation. Measurement adds, to that existing call:
//
//   * one argument (a reference already in scope at every call site), and
//   * one null check.
//
// No allocation, no property lookup, no branch beyond the null test. When measurement is
// off the collector object does not exist.

import type { Operation } from './Operation';

/** Identity assigned to an operation instance on first sight. Symbol-keyed so it cannot
 *  collide with engine fields and does not show up in enumeration or serialisation. */
const INSTANCE_ID = Symbol('rcMeasureId');

/** Counts for one operation *type* within a frame. */
export interface TypeCount {
    /** Stable key: the wire opcode where the operation has one, else its class name. */
    key: string;
    /** Class name, for display. */
    name: string;
    /** Wire opcode, or -1 when the operation does not declare one. */
    opCode: number;
    /** Times an operation of this type executed this frame. */
    count: number;
}

/** Counts for one operation *instance* within a frame. */
export interface InstanceCount {
    /** Stable per-instance id, assigned on first sight and constant for the document's life. */
    id: number;
    /** The type key, so a consumer can group instances by type without a second lookup. */
    key: string;
    name: string;
    /** Times this particular instance executed this frame. */
    count: number;
}

/** Everything measured about one frame. Handed to the sink and then discarded. */
export interface FrameMeasurement {
    /** Monotonic frame number since measurement was enabled. */
    frame: number;
    /** Total operations executed — the same number `getOpsPerFrame()` reports. */
    total: number;
    /** Operations that executed without an identifiable instance (see `record`). */
    unattributed: number;
    /** Of `total`, how many ran inside the paint pass. Equals `getOpsPerFrame()`. */
    inPaint: number;
    /** Of `total`, how many ran *between* frames — input handlers firing click and touch
     *  actions. These execute for real but fall outside the engine's own op window. */
    betweenFrames: number;
    byType: TypeCount[];
    byInstance: InstanceCount[];
}

/** Receives one report per frame. Throwing from a sink is contained (see `emit`). */
export type MeasurementSink = (frame: FrameMeasurement) => void;

/**
 * Collects operation counts for a single frame.
 *
 * One instance lives on the RemoteContext while measurement is enabled. It is reset at
 * the start of each frame and emitted at the end.
 */
export class OperationMeasurement {
    private mSink: MeasurementSink | null;
    private mFrame = 0;
    private mTotal = 0;
    /** Value of mTotal when the paint pass opened; everything before it ran between frames. */
    private mFrameStart = 0;
    private mUnattributed = 0;
    private mNextId = 1;

    /** type key -> counts for this frame */
    private mByType = new Map<string, TypeCount>();
    /** instance id -> counts for this frame */
    private mByInstance = new Map<number, InstanceCount>();

    /**
     * Type metadata cached per constructor, so the opcode lookup and name tidying happen
     * once per class rather than once per operation execution.
     */
    private mTypeInfo = new WeakMap<Function, { key: string; name: string; opCode: number }>();

    constructor(sink: MeasurementSink | null) {
        this.mSink = sink;
    }

    setSink(sink: MeasurementSink | null): void {
        this.mSink = sink;
    }

    /**
     * Record one executed operation.
     *
     * `op` may be undefined: a few call sites count an operation the engine performed
     * without a corresponding object. Those still contribute to `total`, and are reported
     * separately as `unattributed` rather than being silently dropped or invented — a
     * profiler showing a total that its own breakdown does not add up to is worse than
     * one that says how much it could not attribute.
     */
    record(op?: Operation): void {
        this.mTotal++;
        if (op === undefined || op === null) {
            this.mUnattributed++;
            return;
        }

        const info = this.typeInfo(op);
        let t = this.mByType.get(info.key);
        if (t === undefined) {
            t = { key: info.key, name: info.name, opCode: info.opCode, count: 0 };
            this.mByType.set(info.key, t);
        }
        t.count++;

        const anyOp = op as any;
        let id: number | undefined = anyOp[INSTANCE_ID];
        if (id === undefined) {
            id = this.mNextId++;
            // Non-enumerable so the marker never appears in serialisation, structured
            // cloning, or a debugger's property list for the operation.
            Object.defineProperty(anyOp, INSTANCE_ID, {
                value: id, enumerable: false, writable: false, configurable: true,
            });
        }
        let inst = this.mByInstance.get(id);
        if (inst === undefined) {
            inst = { id, key: info.key, name: info.name, count: 0 };
            this.mByInstance.set(id, inst);
        }
        inst.count++;
    }

    /** Class name and opcode, cached per constructor. */
    private typeInfo(op: Operation): { key: string; name: string; opCode: number } {
        const ctor = (op as any).constructor as Function;
        let info = this.mTypeInfo.get(ctor);
        if (info === undefined) {
            // The bundler prefixes class names with `_`; strip it so reports read like
            // the source rather than like the build output.
            const raw = (ctor && ctor.name) || 'Unknown';
            const name = raw.startsWith('_') ? raw.slice(1) : raw;
            const code = (ctor as any)?.OP_CODE;
            const opCode = typeof code === 'number' ? code : -1;
            // Prefer the opcode as the key: it is stable across minified builds, where
            // class names are not.
            info = { key: opCode >= 0 ? `op:${opCode}` : `cls:${name}`, name, opCode };
            this.mTypeInfo.set(ctor, info);
        }
        return info;
    }

    /**
     * Mark where the paint pass begins.
     *
     * Deliberately does NOT clear. Click and touch handlers execute their child actions
     * between frames, and clearing here would throw that work away — the engine's own
     * counter does exactly that, which is why input-driven operations have never appeared
     * in an op count. Recording the boundary instead keeps them, and lets a report say
     * which side of it each one fell on.
     */
    markFrameStart(): void {
        this.mFrameStart = this.mTotal;
    }

    /** Build this frame's report and hand it to the sink. */
    emit(): void {
        if (this.mSink === null) return;
        const byType = [...this.mByType.values()].sort((a, b) => b.count - a.count);
        const byInstance = [...this.mByInstance.values()].sort((a, b) => b.count - a.count);
        const report: FrameMeasurement = {
            frame: this.mFrame++,
            total: this.mTotal,
            unattributed: this.mUnattributed,
            inPaint: this.mTotal - this.mFrameStart,
            betweenFrames: this.mFrameStart,
            byType,
            byInstance,
        };
        try {
            this.mSink(report);
            this.reset();
        } catch (e) {
            this.reset();
            // A sink that throws must not take the document down with it: measurement is
            // an observer, and an observer that can break the thing it observes is worse
            // than no observer.
            // eslint-disable-next-line no-console
            console.error('measurement sink threw:', e);
        }
    }

    /** Clear after emitting, so the next window starts here — which means work done
     *  between frames lands in the *next* report rather than being discarded. */
    private reset(): void {
        this.mTotal = 0;
        this.mFrameStart = 0;
        this.mUnattributed = 0;
        this.mByType.clear();
        this.mByInstance.clear();
    }
}
