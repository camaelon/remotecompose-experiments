// Sending email through Resend (https://resend.com): one POST to its API, no SDK.
//
//   RESEND_API_KEY   the API key (Resend -> API Keys). Without one nothing is sent: the link
//                    is written to the log instead, so a local run, or a server not set up
//                    yet, still works (journalctl -u 'rcmcp@*' shows it)
//   RC_MAIL_FROM     the sender, e.g. "RemoteCompose <noreply@kobento.dev>"; its domain must
//                    be verified in Resend
//   RC_MAIL_API_URL  the endpoint (default https://api.resend.com/emails; tests point it at a mock)

const log = (...a) => console.error(new Date().toISOString(), ...a);

export const mailConfigured = (env = process.env) => Boolean(env.RESEND_API_KEY);

/**
 * Sends one email. link: the one link it carries, which is all the log shows when no key is
 * set (never the body). Resolves {sent: true, id} or {sent: false, logged: true}; throws with
 * Resend's own error text (never the key) when it refuses.
 */
export async function sendMail({ to, subject, text, html, link }, env = process.env) {
    const key = env.RESEND_API_KEY;
    if (!key) {
        log(`mail to ${to}: ${subject} ${link ?? ""}`.trim());
        return { sent: false, logged: true };
    }
    const from = env.RC_MAIL_FROM;
    if (!from) throw new Error("mail not sent: RESEND_API_KEY is set but RC_MAIL_FROM is not");
    let res;
    try {
        res = await fetch(env.RC_MAIL_API_URL || "https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [to], subject, text, html }),
            signal: AbortSignal.timeout(15_000),
        });
    } catch (e) {
        throw new Error(`mail not sent: cannot reach the mail API (${e?.cause?.code ?? e?.name ?? "error"})`);
    }
    const body = await res.text();
    let j = null;
    try { j = JSON.parse(body); } catch { /* not JSON */ }
    if (!res.ok) {
        const why = String(j?.message ?? j?.error ?? body).split(key).join("[key]").slice(0, 300);
        throw new Error(`mail not sent: Resend answered ${res.status}: ${why}`);
    }
    return { sent: true, id: j?.id ?? null };
}

const escape = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** A plain email: a heading, a few lines, one button and the link spelled out. Returns {text, html}. */
export function linkEmail({ heading, lines, button, link, footer }) {
    const text = [heading, "", ...lines, "", `${button}: ${link}`, "", ...(footer ? [footer] : [])].join("\n");
    const p = (t) => `<p style="margin:0 0 14px;color:#1b1f27;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">${escape(t)}</p>`;
    const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f6f7f9">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e5ea;border-radius:12px;padding:24px">
<p style="margin:0 0 6px;color:#5d6676;font:600 12px system-ui,-apple-system,sans-serif;letter-spacing:.05em;text-transform:uppercase">RemoteCompose</p>
<h1 style="margin:0 0 16px;color:#1b1f27;font:600 20px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif">${escape(heading)}</h1>
${lines.map(p).join("\n")}
<p style="margin:20px 0"><a href="${escape(link)}" style="display:inline-block;background:#2f6fde;color:#ffffff;text-decoration:none;font:600 15px system-ui,-apple-system,sans-serif;padding:10px 18px;border-radius:8px">${escape(button)}</a></p>
<p style="margin:0 0 14px;color:#5d6676;font:13px/1.5 system-ui,-apple-system,sans-serif">Or open this link: <a href="${escape(link)}" style="color:#2f6fde;word-break:break-all">${escape(link)}</a></p>
${footer ? `<p style="margin:16px 0 0;color:#5d6676;font:13px/1.5 system-ui,-apple-system,sans-serif">${escape(footer)}</p>` : ""}
</div></body></html>`;
    return { text, html };
}
