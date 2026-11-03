// HostApi: what an app does with a playing document, by name — the playground's panel as code.
//
//   const host = RC.createHostApi(player);
//   host.variables();                    // { price: "float", label: "string", accent: "color", ... }
//   host.set("price", 12.5);             // a host value the document shows
//   host.get("qty");                     // a value the document changed (a slider it exports)
//   host.onAction("checkout", (value) => { ... });   // a hostNamedAction the document sent
//   host.onChange("qty", (value) => { ... });        // a variable that changed, whoever changed it
//   host.dispose();
//
// It follows the player across document loads (a restart, a theme or look switch): the values it
// set are applied again to each new document, and its listeners move over. Values are numbers
// (float, int), "#AARRGGBB" strings (colours), strings, and number arrays (float arrays).

import type { RcdPlayer } from './main';
import type { CoreDocument } from '../core/CoreDocument';
import type { WebRemoteContext } from './WebRemoteContext';

export type HostType = 'string' | 'float' | 'color' | 'image' | 'int' | 'long' | 'float_array';
export type HostValue = number | string | number[];

export interface HostApi {
    /** The document's named variables and their types. */
    variables(): Record<string, HostType>;
    /** A variable's current value, or undefined when the document has none of that name. */
    get(name: string): HostValue | undefined;
    /** Sets a host variable; false when the document has no such variable or the value does not fit its type. */
    set(name: string, value: HostValue): boolean;
    /** Calls `handler(value, name)` for each hostNamedAction of that name ("*": every one). Returns a remover. */
    onAction(name: string, handler: (value: unknown, name: string) => void): () => void;
    /** Calls `handler(value, name)` when that variable's value changes ("*": any). Returns a remover. */
    onChange(name: string, handler: (value: HostValue | undefined, name: string) => void): () => void;
    /** Stops watching; the values set stay as they are. */
    dispose(): void;
}

const TYPES: HostType[] = ['string', 'float', 'color', 'image', 'int', 'long', 'float_array'];

const hex = (argb: number) => '#' + (argb >>> 0).toString(16).toUpperCase().padStart(8, '0');

function parseColor(v: HostValue): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v | 0;
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(v).trim());
    if (!m) return null;
    let n = parseInt(m[1], 16);
    if (m[1].length === 6) n = 0xff000000 + n;
    return n | 0;
}

function floats(v: HostValue): number[] | null {
    const xs = Array.isArray(v) ? v.map(Number)
        : String(v).split(/[\s,;[\]]+/).filter((t) => t !== '').map(Number);
    return xs.length && xs.every(Number.isFinite) ? xs : null;
}

type Listener<T> = { name: string; handler: (value: T, name: string) => void };

/** Polls the player this often for a new document and for changed values. */
const TICK_MS = 50;

export function createHostApi(player: RcdPlayer): HostApi {
    const actions: Listener<unknown>[] = [];
    const changes: Listener<HostValue | undefined>[] = [];
    const sticky = new Map<string, HostValue>();   // what was set, for the next document
    const last = new Map<string, string>();        // values as last seen, to tell a change
    let doc: CoreDocument | null = null;
    let disposed = false;

    const ctx = (): WebRemoteContext | null => player.getRemoteContext();
    const named = (): Map<string, { id: number; type: number }> => ctx()?.getNamedVariables() ?? new Map();

    function read(name: string): HostValue | undefined {
        const c = ctx();
        const v = named().get(name);
        if (!c || !v) return undefined;
        switch (TYPES[v.type]) {
            case 'float': return c.getFloat(v.id);
            case 'int': case 'long': return c.getInteger(v.id);
            case 'color': return hex(c.getColor(v.id));
            case 'string': return c.getText(v.id) ?? '';
            case 'float_array': {
                const s = c.mRemoteComposeState;
                const a = s.getDynamicFloats(v.id) ?? s.getArray(v.id)?.getFloats?.();
                return a ? Array.from(a as ArrayLike<number>) : [];
            }
            default: return undefined;
        }
    }

    function write(name: string, value: HostValue): boolean {
        const c = ctx();
        const v = named().get(name);
        if (!c || !v) return false;
        switch (TYPES[v.type]) {
            case 'float': { const f = Number(value); if (!Number.isFinite(f)) return false; c.setNamedFloatOverride(name, f); return true; }
            case 'int': case 'long': { const n = Number(value); if (!Number.isFinite(n)) return false; c.setNamedIntegerOverride(name, Math.trunc(n)); return true; }
            case 'color': { const col = parseColor(value); if (col === null) return false; c.setNamedColorOverride(name, col); return true; }
            case 'string': c.setNamedStringOverride(name, String(value)); return true;
            case 'float_array': { const xs = floats(value); if (!xs) return false; c.setNamedFloatArrayOverride(name, xs); return true; }
            default: return false;
        }
    }

    function attach(d: CoreDocument) {
        doc = d;
        d.addActionCallback({
            onAction: (name: string, value: unknown) => {
                if (disposed || doc !== d) return;
                for (const l of actions.slice()) {
                    if (l.name === '*' || l.name === name) {
                        try { l.handler(value, name); } catch (e) { console.error(e); }
                    }
                }
            },
        });
        for (const [name, value] of sticky) write(name, value);
        player.repaint?.();
    }

    function tick() {
        if (disposed) return;
        const d = player.getDocument();
        if (d && d !== doc && named().size) attach(d);
        if (!changes.length || !doc) return;
        const watched = changes.some((l) => l.name === '*') ? [...named().keys()] : [...new Set(changes.map((l) => l.name))];
        for (const name of watched) {
            const value = read(name);
            const key = JSON.stringify(value);
            if (last.get(name) === key) continue;
            const first = !last.has(name);
            last.set(name, key);
            if (first) continue;   // the value when watching began is not a change
            for (const l of changes.slice()) {
                if (l.name === '*' || l.name === name) {
                    try { l.handler(value, name); } catch (e) { console.error(e); }
                }
            }
        }
    }

    const timer = setInterval(tick, TICK_MS);
    tick();

    const remover = <T>(list: Listener<T>[], l: Listener<T>) => () => {
        const i = list.indexOf(l);
        if (i >= 0) list.splice(i, 1);
    };

    return {
        variables() {
            const out: Record<string, HostType> = {};
            for (const [name, v] of named()) out[name] = TYPES[v.type] ?? 'string';
            return out;
        },
        get: read,
        set(name, value) {
            const ok = write(name, value);
            if (ok) {
                sticky.set(name, value);
                player.repaint?.();
            }
            return ok;
        },
        onAction(name, handler) {
            const l = { name, handler };
            actions.push(l);
            return remover(actions, l);
        },
        onChange(name, handler) {
            const l = { name, handler };
            changes.push(l);
            if (name !== '*' && !last.has(name)) last.set(name, JSON.stringify(read(name)));
            return remover(changes, l);
        },
        dispose() {
            disposed = true;
            clearInterval(timer);
            actions.length = 0;
            changes.length = 0;
        },
    };
}
