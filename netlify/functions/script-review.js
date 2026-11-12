/**
 * script-review.js  (GDA_MIMIQ_Script_Review_Function_v1_0)
 * Last Updated: November 11, 2026
 * Replaces: none (new)
 * Purpose: The only door between the MIMIQ dashboard page and the Script Review web app (Apps Script). It checks the
 *          reviewer's own code, sets the reviewer's name itself (the page cannot claim a name), and passes one of four
 *          allowed actions on with the web app password. The page never sees the web app URL or its password.
 *
 * Netlify environment variables (set by Pete in Netlify, never in the repository):
 *   MIMIQ_SCRIPTS_API_URL       the web app URL ending in /exec
 *   MIMIQ_SCRIPTS_API_PASSWORD  the password setupPassword() made in the Apps Script
 *   MIMIQ_REVIEWER_CODES        Name:code pairs, comma separated, e.g. Pete:<long code>,Brenda:<long code>
 */
const ACTIONS = new Set(['queue', 'script', 'decide', 'reopen']);
const POST_ID = /^[A-Z0-9][A-Z0-9-]{2,40}$/;

const reply = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  body: JSON.stringify(body)
});

function reviewerFor(code) {
  const pairs = String(process.env.MIMIQ_REVIEWER_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const p of pairs) {
    const i = p.indexOf(':');
    if (i < 1) continue;
    const name = p.slice(0, i).trim(), want = p.slice(i + 1).trim();
    if (want.length >= 16 && code.length === want.length && timingSafe(code, want)) return name;
  }
  return null;
}
function timingSafe(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'post_only' });
  const url = process.env.MIMIQ_SCRIPTS_API_URL, password = process.env.MIMIQ_SCRIPTS_API_PASSWORD;
  if (!url || !password) return reply(500, { ok: false, error: 'not_configured' });

  const code = String(event.headers['x-mimiq-reviewer'] || '');
  const by = reviewerFor(code);
  if (!by) return reply(401, { ok: false, error: 'unauthorized' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { ok: false, error: 'bad_json' }); }
  if (!ACTIONS.has(body.action)) return reply(400, { ok: false, error: 'unknown_action' });
  if (body.action !== 'queue' && !POST_ID.test(String(body.post_id || ''))) return reply(400, { ok: false, error: 'bad_post_id' });

  const forward = { password, action: body.action, by };
  if (body.post_id) forward.post_id = String(body.post_id);
  if (body.action === 'decide') {
    forward.decision = String(body.decision || '');
    forward.note = String(body.note || '').slice(0, 1000);
    if (body.hook_n != null && body.hook_n !== '') forward.hook_n = Number(body.hook_n);
  }

  try {
    // Apps Script answers a POST with a redirect to a one-time googleusercontent.com address (Google's Content service
    // page); fetch follows it. doPost has already run when the redirect arrives.
    const res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(forward), signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { return reply(502, { ok: false, error: 'bad_upstream' }); }
    if (data.error === 'unauthorized') return reply(502, { ok: false, error: 'upstream_password' });
    return reply(data.ok ? 200 : 409, Object.assign(data, { reviewer: by }));
  } catch (e) {
    return reply(504, { ok: false, error: 'upstream_timeout' });
  }
};
