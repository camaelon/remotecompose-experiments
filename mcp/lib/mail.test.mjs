import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { linkEmail, sendMail } from "./mail.mjs";

/** A stand-in for Resend's API: answers `status` with `reply`, keeps what it was sent. */
async function mock(status = 200, reply = { id: "msg_1" }) {
    const got = [];
    const server = createServer(async (req, res) => {
        let body = ""; for await (const c of req) body += c;
        got.push({ method: req.method, auth: req.headers.authorization, type: req.headers["content-type"], json: JSON.parse(body) });
        res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(reply));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return { got, url: `http://127.0.0.1:${server.address().port}/emails`, close: () => server.close() };
}

const KEY = "re_test_key_1234567890";

test("sendMail posts {from, to, subject, text, html} with the key as a bearer token", async () => {
    const m = await mock();
    try {
        const r = await sendMail({ to: "a@example.com", subject: "Hi", text: "t", html: "<p>h</p>", link: "https://x/l" },
            { RESEND_API_KEY: KEY, RC_MAIL_FROM: "RemoteCompose <noreply@example.com>", RC_MAIL_API_URL: m.url });
        assert.deepEqual(r, { sent: true, id: "msg_1" });
        assert.equal(m.got.length, 1);
        assert.equal(m.got[0].method, "POST");
        assert.equal(m.got[0].auth, `Bearer ${KEY}`);
        assert.equal(m.got[0].type, "application/json");
        assert.deepEqual(m.got[0].json, { from: "RemoteCompose <noreply@example.com>", to: ["a@example.com"], subject: "Hi", text: "t", html: "<p>h</p>" });
    } finally { m.close(); }
});

test("a refusal reports Resend's message, never the key", async () => {
    const m = await mock(403, { statusCode: 403, message: `The kobento.dev domain is not verified (key ${KEY})`, name: "validation_error" });
    try {
        await assert.rejects(sendMail({ to: "a@example.com", subject: "s", text: "t", html: "h" },
            { RESEND_API_KEY: KEY, RC_MAIL_FROM: "x <n@kobento.dev>", RC_MAIL_API_URL: m.url }),
            (e) => /Resend answered 403: The kobento.dev domain is not verified/.test(e.message) && !e.message.includes(KEY));
    } finally { m.close(); }
    await assert.rejects(sendMail({ to: "a@b.co", subject: "s", text: "t" }, { RESEND_API_KEY: KEY }), /RC_MAIL_FROM/);
    await assert.rejects(sendMail({ to: "a@b.co", subject: "s", text: "t" }, { RESEND_API_KEY: KEY, RC_MAIL_FROM: "x <n@b.co>", RC_MAIL_API_URL: "http://127.0.0.1:9/" }),
        (e) => /cannot reach/.test(e.message) && !e.message.includes(KEY));
});

test("without a key the link is logged, not the body, and nothing is sent", async () => {
    const lines = [];
    const orig = console.error;
    console.error = (...a) => lines.push(a.join(" "));
    try {
        const r = await sendMail({ to: "dev@example.com", subject: "Your link", text: "SECRET BODY", html: "<p>SECRET BODY</p>", link: "http://l/verify?code=abc" }, {});
        assert.deepEqual(r, { sent: false, logged: true });
    } finally { console.error = orig; }
    assert.equal(lines.length, 1);
    assert.match(lines[0], /mail to dev@example\.com: Your link http:\/\/l\/verify\?code=abc$/);
    assert.ok(!lines[0].includes("SECRET"));
});

test("linkEmail: text and html carry the link; html escapes", () => {
    const { text, html } = linkEmail({ heading: "Confirm <you>", lines: ["a & b"], button: "Go", link: "https://x/?code=1&y=2", footer: "f" });
    assert.match(text, /Go: https:\/\/x\/\?code=1&y=2/);
    assert.ok(html.includes("Confirm &lt;you&gt;") && html.includes("a &amp; b") && html.includes('href="https://x/?code=1&amp;y=2"'));
});
