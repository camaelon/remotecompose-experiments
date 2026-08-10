#!/usr/bin/env python3
"""support-audit.py — what the TypeScript player does not implement.

    python3 support-audit.py                # the three tables
    python3 support-audit.py --json         # machine-readable

Static audit, run from `players/typescript`. Answers two questions by reading source
rather than by running documents:

  1. Which opcodes does the Java reference read that this player does not register?
     These are the dangerous ones: an unregistered opcode has no length, so the byte
     stream desynchronises and every operation after it is garbage.

  2. Which operations parse their bytes and then do nothing?

Question 2 needs care, and getting it wrong is the easy failure. Many operations have a
deliberately empty `apply()` and are still fully implemented — a width modifier does not
*apply*, it is read by the layout system. Reporting those as gaps buries the real ones.
So an operation is only called dead when its `apply`/`paint` is inert **and** nothing
outside its own file and the opcode registry ever mentions it.

Regenerate `docs/MISSING_SUPPORT.md` from this when the numbers change.
"""

import json
import pathlib
import re
import sys

TS = pathlib.Path(__file__).resolve().parent
SRC = TS / "src"
OPS = SRC / "core" / "operations"
JAVA = pathlib.Path(
    "/Users/john/code/androidx-main3/frameworks/support/compose/remote/remote-core"
    "/src/main/java/androidx/compose/remote/core/Operations.java")

OP_CODE_RE = re.compile(
    r"static\s+(?:override\s+)?readonly\s+OP_CODE\s*(?::\s*number\s*)?=\s*(\d+)")


def body_after(src, brace_pos):
    """The {...} body whose opening brace is at or after brace_pos."""
    i = src.find("{", brace_pos)
    if i < 0:
        return ""
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[i + 1:j]
    return ""


def is_inert(body):
    """True when the body holds no executable statement — comments do not count."""
    b = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    b = re.sub(r"//.*", "", b)
    return b.strip() == ""


def scan_typescript():
    classes = []
    for f in sorted(OPS.rglob("*.ts")):
        src = f.read_text()
        rel = str(f.relative_to(SRC))
        for cm in re.finditer(r"export class (\w+)(?:\s+extends\s+([\w.]+))?", src):
            name = cm.group(1)
            nxt = src.find("export class ", cm.end())
            seg = src[cm.end(): nxt if nxt > 0 else len(src)]
            opm = OP_CODE_RE.search(seg)
            inert = {}
            for meth in ("apply", "paint"):
                mm = (re.search(r"\b(?:override\s+)?" + meth + r"\s*\([^)]*\)\s*:\s*\w+\s*\{", seg)
                      or re.search(r"\b(?:override\s+)?" + meth + r"\s*\([^)]*\)\s*\{", seg))
                if mm:
                    inert[meth] = is_inert(body_after(seg, mm.end() - 1))
            classes.append(dict(file=rel, name=name,
                                opcode=int(opm.group(1)) if opm else None,
                                inert=inert))
    return classes


def java_opcodes():
    """(code -> NAME) for every constant, and the set of codes Java actually registers."""
    s = JAVA.read_text()
    consts = {int(m.group(2)): m.group(1)
              for m in re.finditer(r"public static final int (\w+)\s*=\s*(\d+)\s*;", s)}
    names = {v: k for k, v in consts.items()}
    # Registrations live on several maps: map, mapV7, sMapV7AndroidX, sMapV7Widgets, …
    # Matching only `map.put(` misses two thirds of them.
    reg = {names[p] for p in re.findall(r"\w+\.put\(\s*([A-Z][A-Z_0-9]*)\s*,", s)
           if p in names}
    return consts, reg


def ts_registered(classes):
    src = (SRC / "core" / "Operations.ts").read_text()
    byname = {c["name"]: c["opcode"] for c in classes if c["opcode"] is not None}
    reg = {byname[m.group(1)]
           for m in re.finditer(r"m\.set\(\s*([A-Za-z0-9_]+)\.OP_CODE", src)
           if byname.get(m.group(1)) is not None}
    reg |= {int(m.group(1)) for m in re.finditer(r"m\.set\(\s*(\d+)\s*,", src)}
    return reg


def consumers(name, own_file):
    """Files other than the class's own and the registry that reference this class."""
    own = own_file.split("/")[-1]
    pat = re.compile(r"instanceof\s+" + name + r"\b|\b" + name + r"\.(?!OP_CODE|read)")
    out = []
    for p in SRC.rglob("*.ts"):
        base = p.name
        if base in (own, "Operations.ts"):
            continue
        for i, line in enumerate(p.read_text().split("\n"), 1):
            if pat.search(line):
                out.append(f"{base}:{i}")
                break
    return out


STUB_FILE = "UnsupportedOperations.ts"


def stub_opcodes():
    """Opcodes handled by a parsing stub: read correctly, executed not at all.

    These would otherwise vanish from this report. The stubs inherit an empty `apply` from
    a shared base rather than declaring their own, so the inert-body scan below never sees
    them, and being registered they are not 'unregistered' either. Reporting a gap as
    nothing is the failure mode this whole tool exists to avoid.
    """
    f = SRC / "core" / "operations" / STUB_FILE
    if not f.exists():
        return {}
    src = f.read_text()
    out = {}
    for m in re.finditer(r"export class (\w+) extends UnsupportedOperation \{"
                         r"(?:.(?!export class))*?OP_CODE = (\d+)", src, re.S):
        out[int(m.group(2))] = m.group(1)
    return out


def main():
    classes = scan_typescript()
    stubs = stub_opcodes()
    consts, jreg = java_opcodes()
    tsreg = ts_registered(classes)

    unregistered = sorted(jreg - tsreg)
    stub_rows = sorted((op, name) for op, name in stubs.items())
    dead, consumed = [], []
    for c in classes:
        if not any(c["inert"].get(m) for m in ("apply", "paint")):
            continue
        if c["opcode"] is None:
            continue
        hits = consumers(c["name"], c["file"])
        row = dict(opcode=c["opcode"], name=c["name"],
                   java=consts.get(c["opcode"], "?"), consumers=hits[:3])
        (consumed if hits else dead).append(row)
    dead.sort(key=lambda r: r["opcode"])
    consumed.sort(key=lambda r: r["opcode"])

    if "--json" in sys.argv:
        print(json.dumps(dict(unregistered=[[c, consts[c]] for c in unregistered],
                              stubs=[[op, name, consts.get(op, "?")] for op, name in stub_rows],
                              dead=dead, consumed=consumed), indent=2))
        return

    print(f"Java registers {len(jreg)} opcodes; this player registers {len(tsreg)}.\n")
    print(f"=== A. Unregistered — the reader desynchronises on these ({len(unregistered)})")
    for c in unregistered:
        print(f"  {c:>4}  {consts[c]}")
    print(f"\n=== D. Parsed by a stub — stream stays aligned, operation does nothing ({len(stub_rows)})")
    for op, name in stub_rows:
        print(f"  {op:4d}  {consts.get(op, '?'):38s} {name}")

    print(f"\n=== B. Parsed, then ignored — silently does nothing ({len(dead)})")
    for r in dead:
        print(f"  {r['opcode']:>4}  {r['java']:<38} {r['name']}")
    print(f"\n=== C. Inert apply(), but consumed by the layout system ({len(consumed)}) "
          f"— correct as-is, do not 'fix'")
    for r in consumed:
        print(f"  {r['opcode']:>4}  {r['java']:<38} {r['name']:<30} {r['consumers'][0]}")


if __name__ == "__main__":
    main()
