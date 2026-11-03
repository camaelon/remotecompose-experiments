// The privacy notice (GET <base>/privacy/) and the footer that links to it from every page.
// Boilerplate on purpose: what the service keeps, that we may look at it, and what is public.
// The facts in it follow the code: session traces kept TRACE_DAYS, unconfirmed accounts
// removed after a week, one session cookie, published pages public. Keep them in step.

import { TRACE_DAYS } from "./accounts.mjs";

const UPDATED = "3 November 2026";
const REPO = "https://github.com/camaelon/remotecompose-experiments";

/** The footer line, linking to the notice. prefix: the path from the page to the site root. */
export function siteFooter(prefix = "../") {
    return `<footer class="site-foot"><a href="${prefix}privacy/">Privacy</a> · <a href="${REPO}">Source</a></footer>`;
}

export const FOOTER_CSS = `.site-foot{max-width:1100px;margin:48px auto 24px;padding:16px;border-top:1px solid color-mix(in srgb,currentColor 15%,transparent);font-size:13px;opacity:.7;text-align:center}
.site-foot a{color:inherit}
.privacy{display:block;max-width:720px;margin:0 auto;padding:0 16px 32px;line-height:1.6;font-size:15px}
.privacy h2{font-size:18px;margin:28px 0 8px}
.privacy ul{padding-left:20px}`;

const BODY = `
<p>Kobento is an experimental service for building and sharing RemoteCompose documents. It is run on a
best-effort basis, without any guarantee of availability or confidentiality. By using it, through this
site or through its MCP servers, you accept this notice.</p>

<h2>What we keep</h2>
<ul>
<li><b>Your account</b>: your email address, the name you give, your tokens (stored hashed), and whether you
turned on optional features such as app scripts. An account that is never confirmed is deleted after a week.</li>
<li><b>What you send to the tools</b>: the documents, prompts, scripts and files your assistant passes to the
MCP servers, and what the tools return. The details of each session are kept for ${TRACE_DAYS} days; a
summary of usage (which tools, when, how long) is kept longer.</li>
<li><b>What you publish</b>: published pages, what you post to the Stream, and your votes.</li>
<li><b>Technical logs</b>: addresses, times and errors, as any web server keeps, to run the service and
to stop abuse.</li>
</ul>

<h2>We may look at it</h2>
<p>We reserve the right to access, inspect, copy and analyse anything sent to or stored on the service:
documents, prompts, scripts, published pages and logs. We do this to operate and debug the service, to
improve the tools, the components and the guides, to prevent abuse, and to enforce these terms. Do not
send anything you would not want a person to read: no passwords, personal data of others, or
confidential material.</p>

<h2>What is public</h2>
<p>A published page is public: anyone with its link can open it, and it may be listed in the public index
of pages. Items posted to the Stream, with your display name, are visible to everyone, and we may feature
them on the Showcases page. Unpublish a page or remove a Stream item from your account page at any time.</p>

<h2>Removal</h2>
<p>We may remove any content or suspend any account, at our discretion and without notice, in particular
for content that is illegal, harmful, infringing or abusive.</p>

<h2>What we do not do</h2>
<p>We do not sell your data or use it for advertising. We use a single cookie, to keep you signed in
(30 days); there are no tracking or advertising cookies. Sign-in emails are sent through an email
provider, which receives your address for that purpose. We may disclose information when the law
requires it.</p>

<h2>Your assistant</h2>
<p>When you use Kobento from an AI assistant (Claude, ChatGPT, Gemini or another), what you write there is
handled by that assistant's provider under its own terms; we only receive what the assistant sends to
the tools.</p>

<h2>Questions and deletion</h2>
<p>To ask what we hold about you, or to have your account and its data deleted, open an issue on
<a href="${REPO}">GitHub</a>. We may update this notice; the date below says when
it last changed.</p>

<p class="muted">Last updated ${UPDATED}.</p>`;

/** The notice as a whole page. site: {css, nav(current), fonts?}. */
export function privacyPage(site) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy</title>${site.fonts ?? ""}<style>${site.css}</style></head>
<body>
<header>
<nav>${site.nav("privacy")}</nav>
<h1>Privacy</h1>
<p class="sub">What the service keeps, who can see it, and what is public.</p>
</header>
<main class="privacy">${BODY}</main>
${siteFooter("../")}
</body></html>`;
}
