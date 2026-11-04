// Published pages as cards (a preview picture, title, size, date, link), like the examples
// site's grid: the deploy server's /pages/ index and the account page's "Your published pages".

import { escapeHtml } from "./web-page.mjs";
import { formatBytes } from "./web-page.mjs";

const esc = (s) => escapeHtml(s ?? "");

export const PAGE_CARD_CSS = `
.pcards { display:grid; gap:14px; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
.pcard { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:12px; overflow:hidden; color:inherit; text-decoration:none; background:var(--card, transparent); }
.pcard:hover { border-color:var(--accent); }
.pcard .pthumb { aspect-ratio:4/3; background:var(--thumb, var(--line)); display:flex; align-items:center; justify-content:center; overflow:hidden; }
.pcard .pthumb img { max-width:100%; max-height:100%; object-fit:contain; display:block; }
.pcard .pthumb span { color:var(--muted); font-size:12px; }
.pcard .pbody { padding:10px 12px 12px; display:flex; flex-direction:column; gap:3px; }
.pcard .ptitle { font-weight:600; overflow-wrap:anywhere; }
.pcard .pmeta { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
.pcell { display:flex; flex-direction:column; border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--card, transparent); }
.pcell:hover { border-color:var(--accent); }
.pcell .pcard { border:0; border-radius:0; flex:1; }
.pcell .pact { border-top:1px solid var(--line); padding:8px 12px 10px; display:flex; flex-direction:column; gap:6px; font-size:13px; }
`;

/**
 * pages: [{id, title, url, created, rc_bytes?, document?: {width, height}, preview?: url|null}].
 * A page without a preview (published before previews existed) shows a placeholder.
 * actions(page) (optional): HTML under each card (its buttons and forms), outside the link.
 */
export function pageCards(pages, { actions = null } = {}) {
    return `<div class="pcards">${pages.map((p) => {
        const doc = p.document?.width > 0 ? `${p.document.width}×${p.document.height}` : "";
        const card = cardHtml(p, doc);
        return actions ? `<div class="pcell">${card}<div class="pact">${actions(p)}</div></div>` : card;
    }).join("\n")}</div>`;
}

function cardHtml(p, doc) {
    return `<a class="pcard" href="${esc(p.url)}">
<div class="pthumb">${p.preview ? `<img src="${esc(p.preview)}" alt="" loading="lazy">` : "<span>no preview</span>"}</div>
<div class="pbody"><span class="ptitle">${esc(p.title || p.id)}</span>
<span class="pmeta">${[p.rc_bytes ? `${formatBytes(p.rc_bytes)} .rc` : "", doc, String(p.created ?? "").replace("T", " ").slice(0, 16) + " UTC"].filter(Boolean).map(esc).join(" · ")}</span></div></a>`;
}
