// Trace every .rc in a directory and emit `RCDOC <name>` + `TSTRACE frame ...`,
// matching the reference tracer's batch output so the two can be diffed directly.
import { readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
const dir = process.argv[2];
const frames = process.argv[3] ?? '8';
for (const f of readdirSync(dir).filter((x) => x.endsWith('.rc')).sort()) {
    console.log(`RCDOC ${f}`);
    try {
        const out = execFileSync('node', ['trace.mjs', join(dir, f), '--frames', frames,
            '--dump', '--width', '400', '--height', '400'],
            { maxBuffer: 64 << 20 }).toString();
        for (const line of out.split('\n')) if (line.startsWith('TSTRACE frame')) console.log(line);
    } catch (e) {
        console.log(`TSTRACE docfault ${f} ${String(e.message).split('\n')[0].slice(0, 120)}`);
    }
}
