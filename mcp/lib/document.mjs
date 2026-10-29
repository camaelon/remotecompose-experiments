// The document inputs every tool accepts — a binary .rc or RemoteCompose JSON, by path or
// inline — and turning whichever was given into an .rc file on disk.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonToRc } from "./json2rc.mjs";
import { outputFile, resolvePath } from "./workspace.mjs";

export const DOCUMENT_PROPS = {
    rc_path: { type: "string", description: "Path to a binary .rc file." },
    rc_base64: { type: "string", description: "The .rc bytes, base64." },
    json: {
        description: "A RemoteCompose JSON document (object or string), converted with json2rc first.",
        anyOf: [{ type: "object" }, { type: "string" }],
    },
    json_path: { type: "string", description: "Path to a RemoteCompose JSON document, converted with json2rc first." },
    base_dir: {
        type: "string",
        description: "For json/json_path: the folder {\"file\": ...} bitmaps resolve against " +
                     "(default: json_path's folder, or the working directory/workspace).",
    },
};

export /**
 * Resolve whichever document input was given to an .rc file on disk. A conversion failure
 * is returned, not thrown, so `validate` can report it as a finding.
 */
function prepareDocument(a) {
    const given = ["rc_path", "rc_base64", "json", "json_path"].filter((k) => a[k] !== undefined);
    if (given.length !== 1) {
        throw new Error("give exactly one of `rc_path`, `rc_base64`, `json` or `json_path`");
    }
    if (a.rc_path !== undefined) {
        const rcPath = resolvePath(a.rc_path, "rc_path");
        if (!existsSync(rcPath)) throw new Error(`no such file: ${a.rc_path}`);
        return { rcPath, temp: false, source: "rc" };
    }
    let bytes, source = "rc";
    if (a.rc_base64 !== undefined) {
        bytes = Buffer.from(a.rc_base64, "base64");
    } else {
        source = "json";
        const jsonFile = a.json_path !== undefined ? resolvePath(a.json_path, "json_path") : null;
        if (jsonFile && !existsSync(jsonFile)) throw new Error(`no such file: ${a.json_path}`);
        const dir = a.base_dir !== undefined ? resolvePath(a.base_dir, "base_dir")
            : jsonFile ? path.dirname(jsonFile) : resolvePath(".");
        try {
            bytes = jsonToRc(jsonFile ? readFileSync(jsonFile, "utf8") : a.json, dir);
        } catch (e) {
            return { conversionError: String(e?.message ?? e), source };
        }
    }
    if (!bytes.length) throw new Error("the document is empty");
    const rcPath = outputFile("input", ".rc");
    writeFileSync(rcPath, bytes);
    return { rcPath, temp: true, source, bytes: bytes.length };
}

