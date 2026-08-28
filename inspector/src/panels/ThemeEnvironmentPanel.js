// =========================================================================
// System Theme & Environment Matrix Switcher
// Modularized in src/panels/ThemeEnvironmentPanel.js
// =========================================================================

import { getOpName, getOpId, selectCommandCard } from "./CommandListPanel.js";
import { applyDensity, applyStageDimensions } from "./StagePanel.js";

export const THEME_MODES = {
    UNSPECIFIED: -1,
    DARK: -2,
    LIGHT: -3
};

export const THEME_LABELS = {
    [-1]: { name: "System Default", icon: "⚙️", badge: "Unspecified (-1)" },
    [-2]: { name: "Dark Theme", icon: "🌙", badge: "Dark Mode (-2)" },
    [-3]: { name: "Light Theme", icon: "☀️", badge: "Light Mode (-3)" }
};

export const PRESET_PALETTES = {
    pixel_blue: {
        name: "Pixel Ocean Blue",
        seed: "#1a73e8",
        icon: "🟦",
        description: "Android 14 default dynamic blue palette"
    },
    lavender_purple: {
        name: "Dynamic Lavender",
        seed: "#7c4dff",
        icon: "🟪",
        description: "Vibrant purple and soft lilac tones"
    },
    forest_emerald: {
        name: "Forest Emerald",
        seed: "#00897b",
        icon: "🟩",
        description: "Earthy botanical green and mint accents"
    },
    sunset_amber: {
        name: "Sunset Amber",
        seed: "#f57c00",
        icon: "🟧",
        description: "Warm gold, coral, and terracotta accents"
    },
    monochrome_slate: {
        name: "Monochrome Slate",
        seed: "#546e7a",
        icon: "⬛",
        description: "Neutral minimalist slate and charcoal"
    }
};

let currentThemeMode = THEME_MODES.UNSPECIFIED;
let activeOverrides = new Map(); // varName/varId -> ARGB int

export function getActiveThemeMode() {
    return currentThemeMode;
}

export function intToHexColor(colorInt) {
    if (typeof colorInt !== "number" || isNaN(colorInt)) return "#000000";
    const a = (colorInt >>> 24) & 0xff;
    const r = (colorInt >>> 16) & 0xff;
    const g = (colorInt >>> 8) & 0xff;
    const b = colorInt & 0xff;
    const hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    return "#" + hex;
}

export function intToRgbaString(colorInt) {
    if (typeof colorInt !== "number" || isNaN(colorInt)) return "rgba(0,0,0,1)";
    const a = ((colorInt >>> 24) & 0xff) / 255;
    const r = (colorInt >>> 16) & 0xff;
    const g = (colorInt >>> 8) & 0xff;
    const b = colorInt & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
}

export function hexToArgbInt(hexStr, alpha = 1.0) {
    if (!hexStr) return 0xff000000;
    let cleanHex = hexStr.replace("#", "").trim();
    if (cleanHex.length === 3) {
        cleanHex = cleanHex.split("").map(c => c + c).join("");
    }
    if (cleanHex.length === 6) {
        const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
        const r = parseInt(cleanHex.substring(0, 2), 16) || 0;
        const g = parseInt(cleanHex.substring(2, 4), 16) || 0;
        const b = parseInt(cleanHex.substring(4, 6), 16) || 0;
        return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
    }
    if (cleanHex.length === 8) {
        return parseInt(cleanHex, 16) | 0;
    }
    return 0xff000000;
}

export function categorizeColorToken(varName) {
    const name = (varName || "").toLowerCase();
    if (name.includes("accent1") || name.includes("primary")) {
        return { key: "accent1", title: "Primary Accent (Accent 1)", icon: "🟣", order: 1 };
    }
    if (name.includes("accent2") || name.includes("secondary")) {
        return { key: "accent2", title: "Secondary Accent (Accent 2)", icon: "🔵", order: 2 };
    }
    if (name.includes("accent3") || name.includes("tertiary")) {
        return { key: "accent3", title: "Tertiary Accent (Accent 3)", icon: "🟠", order: 3 };
    }
    if (name.includes("on_surface") || name.includes("surface") || name.includes("neutral") || name.includes("background") || name.includes("outline")) {
        return { key: "neutral", title: "Surface & Neutral Elements", icon: "⚪", order: 4 };
    }
    if (name.includes("error")) {
        return { key: "error", title: "Error & Warning States", icon: "🔴", order: 5 };
    }
    return { key: "custom", title: "Custom Named Colors", icon: "🎨", order: 6 };
}

export function extractDocumentThemeTokens(doc) {
    const tokens = {
        namedColors: [],
        namedFloats: [],
        themeSections: [],
        categories: new Map(),
        totalColorTokens: 0,
        hasThemeOps: false
    };

    if (!doc) return tokens;

    const allOps = (typeof window !== "undefined" && typeof window.getAllOperationsFlat === "function")
        ? window.getAllOperationsFlat(doc, window.currentBuffer ? new Uint8Array(window.currentBuffer) : null)
        : (doc.getOperations ? doc.getOperations() : (doc.mOps || []));

    const ctx = (typeof window !== "undefined" && window.currentPlayer && typeof window.currentPlayer.getRemoteContext === "function")
        ? window.currentPlayer.getRemoteContext()
        : null;

    const varNameMap = new Map();
    const colorConstMap = new Map();
    let currentThemeScope = THEME_MODES.UNSPECIFIED;

    allOps.forEach((op, idx) => {
        const code = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? 0);

        if (code === 63) {
            const themeVal = op.mTheme ?? op.theme ?? -1;
            tokens.hasThemeOps = true;
            currentThemeScope = themeVal;
            tokens.themeSections.push({
                opIndex: idx,
                theme: themeVal,
                label: THEME_LABELS[themeVal]?.name || `Theme ${themeVal}`
            });
        }

        if (code === 138) {
            const id = op.mId ?? op.id ?? 0;
            const color = op.mColor ?? op.color ?? 0;
            colorConstMap.set(id, { color, opIndex: idx, themeScope: currentThemeScope });
        }

        if (code === 137) {
            const name = op.mVarName ?? op.varName ?? "";
            const id = op.mVarId ?? op.varId ?? 0;
            const type = op.mVarType ?? op.varType ?? 0;
            varNameMap.set(id, { name, type, opIndex: idx });
        }
    });

    varNameMap.forEach(({ name, type, opIndex }, varId) => {
        if (type === 2 || name.toLowerCase().startsWith("color.")) {
            let currentColor = 0;
            if (ctx && typeof ctx.getColor === "function") {
                currentColor = ctx.getColor(varId);
            }
            if (!currentColor && colorConstMap.has(varId)) {
                currentColor = colorConstMap.get(varId).color;
            }

            const cat = categorizeColorToken(name);
            const tokenEntry = {
                id: varId,
                name: name,
                category: cat.key,
                categoryTitle: cat.title,
                categoryIcon: cat.icon,
                categoryOrder: cat.order,
                initialColor: currentColor,
                currentColor: activeOverrides.has(name) ? activeOverrides.get(name) : currentColor,
                hex: intToHexColor(activeOverrides.has(name) ? activeOverrides.get(name) : currentColor),
                isOverridden: activeOverrides.has(name) || activeOverrides.has(varId),
                opIndex: opIndex
            };

            tokens.namedColors.push(tokenEntry);

            if (!tokens.categories.has(cat.key)) {
                tokens.categories.set(cat.key, {
                    key: cat.key,
                    title: cat.title,
                    icon: cat.icon,
                    order: cat.order,
                    tokens: []
                });
            }
            tokens.categories.get(cat.key).tokens.push(tokenEntry);
        } else if (type === 1 || name.toLowerCase().startsWith("system.")) {
            let currentVal = 1.0;
            if (ctx && typeof ctx.getFloat === "function") {
                currentVal = ctx.getFloat(varId);
            }
            tokens.namedFloats.push({
                id: varId,
                name: name,
                value: currentVal,
                opIndex: opIndex
            });
        }
    });

    tokens.totalColorTokens = tokens.namedColors.length;
    return tokens;
}

export function setDocumentTheme(themeId, syncBackground = true) {
    currentThemeMode = themeId;
    const player = (typeof window !== "undefined") ? window.currentPlayer : null;

    if (player && typeof player.setTheme === "function") {
        player.setTheme(themeId);
    }

    if (syncBackground && typeof document !== "undefined") {
        const canvas = document.getElementById("previewCanvas");
        if (canvas) {
            if (themeId === THEME_MODES.DARK) {
                canvas.style.background = "#0f172a";
            } else if (themeId === THEME_MODES.LIGHT) {
                canvas.style.background = "#ffffff";
            }
        }
    }

    if (typeof document !== "undefined") {
        const btnUnspecified = document.getElementById("themeBtnUnspecified");
        const btnDark = document.getElementById("themeBtnDark");
        const btnLight = document.getElementById("themeBtnLight");

        if (btnUnspecified) btnUnspecified.classList.toggle("active", themeId === THEME_MODES.UNSPECIFIED);
        if (btnDark) btnDark.classList.toggle("active", themeId === THEME_MODES.DARK);
        if (btnLight) btnLight.classList.toggle("active", themeId === THEME_MODES.LIGHT);

        const badge = document.getElementById("activeThemeBadge");
        if (badge) {
            const meta = THEME_LABELS[themeId] || { name: `Theme ${themeId}`, icon: "⚙️" };
            badge.innerHTML = `${meta.icon} ${meta.name}`;
        }
    }

    if (player && typeof player.repaint === "function") {
        player.repaint();
    }

    if (typeof window !== "undefined") {
        if (typeof window.updateVariablesPanel === "function") window.updateVariablesPanel();
        if (typeof window.updateRunningTreeLive === "function") window.updateRunningTreeLive();
    }

    updateThemePanelUI();
}

export function overrideNamedColor(varNameOrId, hexOrInt) {
    const player = (typeof window !== "undefined") ? window.currentPlayer : null;
    if (!player) return;

    const ctx = player.getRemoteContext ? player.getRemoteContext() : null;
    if (!ctx) return;

    let colorInt = typeof hexOrInt === "number" ? hexOrInt : hexToArgbInt(hexOrInt);
    activeOverrides.set(varNameOrId, colorInt);

    if (typeof varNameOrId === "string" && typeof ctx.setNamedColorOverride === "function") {
        ctx.setNamedColorOverride(varNameOrId, colorInt);
    }

    if (typeof varNameOrId === "number" && typeof ctx.loadColor === "function") {
        ctx.loadColor(varNameOrId, colorInt);
    }

    if (typeof player.repaint === "function") {
        player.repaint();
    }

    updateThemePanelUI();
    if (typeof window !== "undefined" && typeof window.updateVariablesPanel === "function") {
        window.updateVariablesPanel();
    }
}

export function resetAllThemeOverrides() {
    activeOverrides.clear();
    const player = (typeof window !== "undefined") ? window.currentPlayer : null;
    if (!player) return;

    const ctx = player.getRemoteContext ? player.getRemoteContext() : null;
    if (ctx && typeof ctx.clearNamedColorOverride === "function") {
        const doc = (typeof window !== "undefined") ? window.currentDocument : null;
        const tokens = extractDocumentThemeTokens(doc);
        tokens.namedColors.forEach(tok => {
            if (typeof ctx.clearNamedColorOverride === "function") {
                ctx.clearNamedColorOverride(tok.name);
            }
        });
    }

    if (typeof player.repaint === "function") {
        player.repaint();
    }

    updateThemePanelUI();
    if (typeof window !== "undefined" && typeof window.updateVariablesPanel === "function") {
        window.updateVariablesPanel();
    }
}

export function generateM3TonalPalette(seedHex) {
    const seedInt = hexToArgbInt(seedHex);
    const r = (seedInt >>> 16) & 0xff;
    const g = (seedInt >>> 8) & 0xff;
    const b = seedInt & 0xff;

    const rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
    const max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
            case gNorm: h = (bNorm - rNorm) / d + 2; break;
            case bNorm: h = (rNorm - gNorm) / d + 4; break;
        }
        h /= 6;
    }

    function hslToArgb(hue, sat, lum) {
        let r1, g1, b1;
        if (sat === 0) {
            r1 = g1 = b1 = lum;
        } else {
            const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
            const p = 2 * lum - q;
            r1 = hue2rgb(p, q, hue + 1/3);
            g1 = hue2rgb(p, q, hue);
            b1 = hue2rgb(p, q, hue - 1/3);
        }
        const a = 255;
        return ((a << 24) | (Math.round(r1 * 255) << 16) | (Math.round(g1 * 255) << 8) | Math.round(b1 * 255)) | 0;
    }

    const tones = [
        { tone: 10, lum: 0.10 },
        { tone: 50, lum: 0.20 },
        { tone: 100, lum: 0.30 },
        { tone: 200, lum: 0.45 },
        { tone: 400, lum: 0.60 },
        { tone: 600, lum: 0.75 },
        { tone: 800, lum: 0.88 },
        { tone: 900, lum: 0.95 }
    ];

    const palette = {};

    tones.forEach(({ tone, lum }) => {
        palette[`color.system_accent1_${tone}`] = hslToArgb(h, Math.min(1, s * 1.2), 1 - lum);
    });

    tones.forEach(({ tone, lum }) => {
        palette[`color.system_accent2_${tone}`] = hslToArgb(h, s * 0.6, 1 - lum);
    });

    const h3 = (h + 0.16) % 1.0;
    tones.forEach(({ tone, lum }) => {
        palette[`color.system_accent3_${tone}`] = hslToArgb(h3, s * 0.8, 1 - lum);
    });

    palette["color.system_on_surface_light"] = hslToArgb(h, 0.05, 0.12);
    palette["color.system_on_surface_dark"] = hslToArgb(h, 0.05, 0.92);
    palette["color.system_neutral2_800"] = hslToArgb(h, 0.08, 0.20);
    palette["color.system_neutral2_400"] = hslToArgb(h, 0.08, 0.65);

    return palette;
}

export function applyPresetPalette(presetKey) {
    const preset = PRESET_PALETTES[presetKey];
    if (!preset) return;

    const generatedColors = generateM3TonalPalette(preset.seed);
    Object.keys(generatedColors).forEach(tokenName => {
        overrideNamedColor(tokenName, generatedColors[tokenName]);
    });
}

export function applyCustomSeedPalette(seedHex) {
    if (!seedHex) return;
    const generatedColors = generateM3TonalPalette(seedHex);
    Object.keys(generatedColors).forEach(tokenName => {
        overrideNamedColor(tokenName, generatedColors[tokenName]);
    });
}

export function renderThemeEnvironmentPanel(doc) {
    const container = (typeof document !== "undefined") ? document.getElementById("themeEnvContainer") : null;
    if (!container) return;

    if (!doc) {
        container.innerHTML = `<div style="text-align:center; padding:32px; color:var(--text-muted); font-size:0.85rem;">No document loaded. Load a <code>.rc</code> file to inspect named color tokens and environment matrix.</div>`;
        return;
    }

    const tokens = extractDocumentThemeTokens(doc);

    let html = `<div style="display:flex; flex-direction:column; gap:12px; font-size:0.8rem;">` +
        `<div class="card" style="padding:10px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">` +
            `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">` +
                `<span style="font-weight:600; color:var(--text-primary); display:flex; align-items:center; gap:6px;">` +
                    `<span>🌗</span> System Theme Mode` +
                `</span>` +
                `<span class="badge" id="activeThemeBadge" style="background:var(--accent-dim); color:var(--accent-color); font-size:0.7rem;">` +
                    `${THEME_LABELS[currentThemeMode]?.icon || "⚙️"} ${THEME_LABELS[currentThemeMode]?.name || "System Default"}` +
                `</span>` +
            `</div>` +
            `<div style="display:flex; gap:6px;">` +
                `<button id="themeBtnLight" class="btn btn-secondary ${currentThemeMode === THEME_MODES.LIGHT ? "active" : ""}" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:0.75rem; padding:6px 8px;" onclick="setDocumentTheme(${THEME_MODES.LIGHT})">` +
                    `<span>☀️</span> Light Mode (-3)` +
                `</button>` +
                `<button id="themeBtnDark" class="btn btn-secondary ${currentThemeMode === THEME_MODES.DARK ? "active" : ""}" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:0.75rem; padding:6px 8px;" onclick="setDocumentTheme(${THEME_MODES.DARK})">` +
                    `<span>🌙</span> Dark Mode (-2)` +
                `</button>` +
                `<button id="themeBtnUnspecified" class="btn btn-secondary ${currentThemeMode === THEME_MODES.UNSPECIFIED ? "active" : ""}" style="flex:1; display:flex; align-items:center; justify-content:center; gap:6px; font-size:0.75rem; padding:6px 8px;" onclick="setDocumentTheme(${THEME_MODES.UNSPECIFIED})">` +
                    `<span>⚙️</span> Default (-1)` +
                `</button>` +
            `</div>` +
        `</div>` +
        `<div class="card" style="padding:10px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">` +
            `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">` +
                `<span style="font-weight:600; color:var(--text-primary); display:flex; align-items:center; gap:6px;">` +
                    `<span>🎨</span> Dynamic Material You Presets` +
                `</span>` +
                `<button class="btn btn-secondary btn-xs" style="font-size:0.68rem;" onclick="resetAllThemeOverrides()">` +
                    `⟳ Reset Colors` +
                `</button>` +
            `</div>` +
            `<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">`;

    Object.keys(PRESET_PALETTES).forEach(key => {
        const p = PRESET_PALETTES[key];
        html += `<button class="btn btn-secondary btn-xs" style="display:flex; align-items:center; gap:4px; font-size:0.72rem; padding:4px 8px;" onclick="applyPresetPalette('${key}')" title="${p.description}">` +
            `<span>${p.icon}</span> ${p.name}` +
        `</button>`;
    });

    html += `</div>` +
        `<div style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2); padding:6px 8px; border-radius:4px;">` +
            `<span style="color:var(--text-muted); font-size:0.72rem;">Custom Seed:</span>` +
            `<input type="color" id="customSeedColorInput" value="#1a73e8" style="width:28px; height:24px; padding:0; border:none; border-radius:3px; cursor:pointer; background:transparent;" onchange="applyCustomSeedPalette(this.value); document.getElementById('customSeedHexInput').value = this.value;">` +
            `<input type="text" id="customSeedHexInput" value="#1a73e8" style="width:80px; font-family:var(--code-font); font-size:0.72rem; padding:2px 6px; border-radius:3px; border:1px solid var(--border-color); background:var(--bg-primary); color:var(--text-primary);" onchange="applyCustomSeedPalette(this.value); document.getElementById('customSeedColorInput').value = this.value;">` +
            `<button class="btn btn-primary btn-xs" style="font-size:0.7rem; padding:3px 8px;" onclick="applyCustomSeedPalette(document.getElementById('customSeedHexInput').value)">` +
                `Generate Palette` +
            `</button>` +
        `</div>` +
    `</div>` +
    `<div class="card" style="padding:10px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">` +
        `<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">` +
            `<span style="font-weight:600; color:var(--text-primary); display:flex; align-items:center; gap:6px;">` +
                `<span>🏷️</span> Document Named Color Tokens` +
            `</span>` +
            `<span class="badge" style="font-size:0.7rem;">${tokens.totalColorTokens} Tokens</span>` +
        `</div>`;

    if (tokens.namedColors.length === 0) {
        html += `<div style="color:var(--text-muted); font-size:0.75rem; padding:8px 0; text-align:center;">` +
            `No named color tokens (<code>NamedVariable</code> type <code>COLOR</code>) found in this document.` +
        `</div>`;
    } else {
        const sortedCategories = Array.from(tokens.categories.values()).sort((a, b) => a.order - b.order);
        sortedCategories.forEach(cat => {
            html += `<div style="margin-top:10px; margin-bottom:4px; font-weight:600; color:var(--text-secondary); font-size:0.72rem; display:flex; align-items:center; gap:4px; border-bottom:1px solid rgba(255,255,255,0.06); padding-bottom:3px;">` +
                `<span>${cat.icon}</span> ${cat.title} (${cat.tokens.length})` +
            `</div>` +
            `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap:6px; margin-bottom:8px;">`;

            cat.tokens.forEach(tok => {
                const hexVal = tok.hex;
                const overrideBadge = tok.isOverridden ? `<span class="badge" style="background:#eab308; color:#000; font-size:0.6rem; padding:1px 4px;">Modified</span>` : "";

                html += `<div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-primary); padding:6px 8px; border-radius:4px; border:1px solid var(--border-color); gap:8px;">` +
                    `<div style="display:flex; align-items:center; gap:8px; overflow:hidden; flex:1;">` +
                        `<input type="color" value="${hexVal}" style="width:24px; height:24px; padding:0; border:1px solid rgba(255,255,255,0.2); border-radius:3px; cursor:pointer; flex-shrink:0;" onchange="overrideNamedColor('${tok.name}', this.value)" title="Click to override color">` +
                        `<div style="overflow:hidden; display:flex; flex-direction:column;">` +
                            `<div style="font-family:var(--code-font); font-size:0.72rem; color:var(--text-primary); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;" title="${tok.name}">` +
                                `${tok.name} ${overrideBadge}` +
                            `</div>` +
                            `<div style="font-size:0.65rem; color:var(--text-muted); display:flex; gap:6px;">` +
                                `<span>ID: <b>#${tok.id}</b></span>` +
                                `<span>Hex: <b>${hexVal}</b></span>` +
                            `</div>` +
                        `</div>` +
                    `</div>` +
                    `<button class="btn btn-secondary btn-xs" style="font-size:0.65rem; padding:2px 6px;" onclick="event.stopPropagation(); selectCommandCard(${tok.opIndex}, ${tok.id})" title="Jump to Op #${tok.opIndex + 1} in Command List">` +
                        `🔍 Op #${tok.opIndex + 1}` +
                    `</button>` +
                `</div>`;
            });

            html += `</div>`;
        });
    }

    html += `</div>` +
        `<div class="card" style="padding:10px; background:var(--bg-secondary); border-radius:6px; border:1px solid var(--border-color);">` +
            `<div style="font-weight:600; color:var(--text-primary); margin-bottom:8px; display:flex; align-items:center; gap:6px;">` +
                `<span>📱</span> Environment Variables & Density Matrix` +
            `</div>` +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">` +
                `<div>` +
                    `<label style="font-size:0.7rem; color:var(--text-muted); display:block; margin-bottom:3px;">Display Density (Scale)</label>` +
                    `<select class="form-control" style="width:100%; font-size:0.75rem; padding:4px 6px;" onchange="applyDensity(parseFloat(this.value))">` +
                        `<option value="1.0">1.0x (mdpi / Desktop)</option>` +
                        `<option value="1.5">1.5x (hdpi / Auto)</option>` +
                        `<option value="2.0">2.0x (xhdpi / Watch)</option>` +
                        `<option value="2.625" selected>2.625x (xxhdpi / Phone Pixel 6)</option>` +
                        `<option value="3.0">3.0x (xxhdpi / Flagship)</option>` +
                        `<option value="3.5">3.5x (xxxhdpi)</option>` +
                    `</select>` +
                `</div>` +
                `<div>` +
                    `<label style="font-size:0.7rem; color:var(--text-muted); display:block; margin-bottom:3px;">Device Screen Size Preset</label>` +
                    `<select class="form-control" style="width:100%; font-size:0.75rem; padding:4px 6px;" onchange="const [w, h] = this.value.split(',').map(Number); applyStageDimensions(w, h);">` +
                        `<option value="411,891">Phone (411 × 891 px - Pixel 6)</option>` +
                        `<option value="390,844">Phone Compact (390 × 844 px)</option>` +
                        `<option value="384,384">Watch Round (384 × 384 px)</option>` +
                        `<option value="454,454">Watch Large (454 × 454 px)</option>` +
                        `<option value="800,1280">Tablet (800 × 1280 px)</option>` +
                        `<option value="256,256">Standard Canvas (256 × 256 px)</option>` +
                    `</select>` +
                `</div>` +
            `</div>` +
        `</div>` +
    `</div>`;

    container.innerHTML = html;
}

export function updateThemePanelUI() {
    const doc = (typeof window !== "undefined") ? window.currentDocument : null;
    if (doc) {
        renderThemeEnvironmentPanel(doc);
    }
}

if (typeof window !== "undefined") {
    window.setDocumentTheme = setDocumentTheme;
    window.overrideNamedColor = overrideNamedColor;
    window.resetAllThemeOverrides = resetAllThemeOverrides;
    window.applyPresetPalette = applyPresetPalette;
    window.applyCustomSeedPalette = applyCustomSeedPalette;
    window.renderThemeEnvironmentPanel = renderThemeEnvironmentPanel;
    window.updateThemePanelUI = updateThemePanelUI;
}