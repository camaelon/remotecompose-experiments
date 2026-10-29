// CollapsiblePriority: utility for sorting components by collapsible priority, and the
// shared body of CollapsibleRowLayout / CollapsibleColumnLayout.computeVisibleChildren.
// Port of Java CollapsiblePriority.java.

import { Component, Visibility } from '../Component';
import { LayoutComponent } from '../LayoutComponent';
import { CollapsiblePriorityModifier } from '../modifiers/ModifierOperations';
import type { PaintContext } from '../../../PaintContext';
import type { MeasurePass } from '../measure/MeasurePass';
import type { Size } from '../measure/Size';

const FLOAT_MAX = 3.4028234663852886e38;   // Java Float.MAX_VALUE

// Java's (int) cast of a float: truncates, saturates, NaN is 0.
function javaInt(v: number): number {
    if (Number.isNaN(v)) return 0;
    if (v >= 2147483647) return 2147483647;
    if (v <= -2147483648) return -2147483648;
    return Math.trunc(v);
}

// Java's List.sort (TimSort) on fewer than 32 elements: the leading run, then a binary
// insertion sort. Reproduced so a comparator that is not transitive (the priority comparator
// truncates, so 1 and 1.5 tie but 1 and 2.2 do not) orders exactly as the reference.
function javaSmallSort<T>(a: T[], cmp: (x: T, y: T) => number): void {
    const n = a.length;
    if (n < 2) return;
    let runHi = 1;
    if (cmp(a[runHi++], a[0]) < 0) {
        while (runHi < n && cmp(a[runHi], a[runHi - 1]) < 0) runHi++;
        const head = a.slice(0, runHi).reverse();
        for (let i = 0; i < runHi; i++) a[i] = head[i];
    } else {
        while (runHi < n && cmp(a[runHi], a[runHi - 1]) >= 0) runHi++;
    }
    for (let start = runHi; start < n; start++) {
        const pivot = a[start];
        let left = 0, right = start;
        while (left < right) {
            const mid = (left + right) >> 1;
            if (cmp(pivot, a[mid]) < 0) right = mid; else left = mid + 1;
        }
        for (let k = start; k > left; k--) a[k] = a[k - 1];
        a[left] = pivot;
    }
}

export class CollapsiblePriority {
    static readonly HORIZONTAL = 0;
    static readonly VERTICAL = 1;

    /** The child's priority on that axis; a child without one counts as Float.MAX_VALUE. */
    static getPriority(c: Component, orientation: number): number {
        if (c instanceof LayoutComponent) {
            const priority = c.selfOrModifier(CollapsiblePriorityModifier);
            if (priority && priority.getOrientation() === orientation) {
                return priority.getPriority();
            }
        }
        return FLOAT_MAX;
    }

    /** The component that stays last: the highest priority number, the first on ties. */
    static findLastStanding(components: Component[], orientation: number): Component | null {
        if (components.length === 0) return null;
        let best = components[0];
        let maxPriority = CollapsiblePriority.getPriority(best, orientation);
        for (let i = 1; i < components.length; i++) {
            const p = CollapsiblePriority.getPriority(components[i], orientation);
            if (p > maxPriority) { maxPriority = p; best = components[i]; }
        }
        return best;
    }

    /** Highest priority first, with the reference's comparator `(int) (p2 - p1)`. */
    static sortWithPriorities(components: Component[], orientation: number): Component[] {
        const sorted = [...components];
        javaSmallSort(sorted, (a, b) => javaInt(Math.fround(
            CollapsiblePriority.getPriority(b, orientation) - CollapsiblePriority.getPriority(a, orientation))));
        return sorted;
    }
}

/**
 * CollapsibleRowLayout (axis 0) / CollapsibleColumnLayout (axis 1).computeVisibleChildren.
 *
 * The children are measured along the main axis unbounded (Float.MAX_VALUE), except a
 * weighted child or a nested collapsible of the same kind, which get what the children before
 * them left; then, highest priority first, they are kept while they fit in `maxMain`, and the
 * first that does not fit and every one after it is GONE. Within a frame the reference
 * measures the children again on every call (they all need measuring until laid out), and a
 * dropped child stays GONE, no longer taking space from the ones after it; `fresh` restarts
 * from the children's own visibility, for the first call of a measure.
 *
 * Returns the largest cross size of the children that were not GONE before the drop (what
 * the reference wraps the cross axis to on the first frame), and of those kept (what it
 * wraps to once settled, on the next frame), the sum of the kept main sizes, and the counts.
 */
export function computeVisibleChildren(host: LayoutComponent, axis: number,
                                       context: PaintContext, maxMain: number, maxCross: number,
                                       measure: MeasurePass, fresh: boolean,
                                       sameKind: (c: Component) => boolean) {
    const self = measure.get(host);
    self.addVisibilityOverride(Visibility.OVERRIDE_VISIBLE);
    let currentMax = maxMain;
    let hasPriorities = false;
    let preDropCount = 0, preDropMain = 0, preDropCross = 0;
    const children = host.mChildrenComponents;
    for (const c of children) {
        if (fresh && measure.contains(c.getComponentId())) measure.get(c).clearVisibilityOverride();
        const weighted = c instanceof LayoutComponent
            && (axis === 0 ? c.hasWidthWeight() : c.hasHeightWeight());
        const lim = sameKind(c) || weighted ? currentMax : FLOAT_MAX;
        if (axis === 0) c.measure(context, 0, lim, 0, maxCross, measure);
        else c.measure(context, 0, maxCross, 0, lim, measure);
        const m = measure.get(c);
        if (!m.isGone()) {
            preDropCount++;
            const main = axis === 0 ? m.getW() : m.getH();
            preDropMain += main;
            preDropCross = Math.max(preDropCross, axis === 0 ? m.getH() : m.getW());
            currentMax -= main;
        }
        if (c instanceof LayoutComponent && c.selfOrModifier(CollapsiblePriorityModifier)) {
            hasPriorities = true;
        }
    }
    const ordered = hasPriorities
        ? CollapsiblePriority.sortWithPriorities(children, axis) : children;
    let keptMain = 0, keptCross = 0, kept = 0;
    let overflow = false;
    for (const child of ordered) {
        const cm = measure.get(child);
        if (overflow || cm.isGone()) {
            cm.addVisibilityOverride(Visibility.OVERRIDE_GONE);
            continue;
        }
        const s = axis === 0 ? cm.getW() : cm.getH();
        if (keptMain + s > maxMain) {
            cm.addVisibilityOverride(Visibility.OVERRIDE_GONE);
            overflow = true;
        } else {
            keptMain += s;
            keptCross = Math.max(keptCross, axis === 0 ? cm.getH() : cm.getW());
            kept++;
        }
    }
    return { preDropCount, preDropMain, preDropCross, kept, keptMain, keptCross };
}
