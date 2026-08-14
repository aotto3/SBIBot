'use strict';

/**
 * Dashboard views — server-rendered HTML (thin presentation, not unit-tested).
 *
 * A single responsive base layout plus the two pages the walking skeleton needs:
 * the login form and the authenticated health page. Later slices add more pages
 * that reuse `layout()` and the shared CSS / auto-refresh scaffolding here.
 */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_CSS = `
  :root { color-scheme: light dark; --bg:#0f1115; --card:#181b22; --fg:#e7e9ee;
    --muted:#9aa3b2; --line:#272b34; --ok:#3fb950; --bad:#f85149; --accent:#4c8bf5; }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f5f6f8; --card:#fff; --fg:#1b1f27; --muted:#5b6472; --line:#e2e5ea; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    background:var(--bg); color:var(--fg); }
  .wrap { max-width:720px; margin:0 auto; padding:20px 16px 48px; }
  header.bar { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
    margin-bottom:20px; }
  header.bar h1 { font-size:1.25rem; margin:0; }
  .muted { color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:16px; margin-bottom:16px; }
  .card h2 { font-size:0.85rem; text-transform:uppercase; letter-spacing:.04em;
    color:var(--muted); margin:0 0 12px; }
  .stat { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
    padding:8px 0; border-top:1px solid var(--line); }
  .stat:first-of-type { border-top:0; }
  .stat .k { color:var(--muted); }
  .stat .v { font-variant-numeric:tabular-nums; font-weight:600; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.85rem;
    font-weight:600; }
  .pill.ok  { background:color-mix(in srgb,var(--ok) 18%,transparent);  color:var(--ok); }
  .pill.bad { background:color-mix(in srgb,var(--bad) 18%,transparent); color:var(--bad); }
  form.login { display:flex; flex-direction:column; gap:12px; }
  input[type=password] { width:100%; padding:12px; font-size:1rem; border-radius:8px;
    border:1px solid var(--line); background:var(--bg); color:var(--fg); }
  button { padding:12px 16px; font-size:1rem; font-weight:600; border:0; border-radius:8px;
    background:var(--accent); color:#fff; cursor:pointer; }
  button.ghost { background:transparent; color:var(--muted); border:1px solid var(--line); }
  .err { color:var(--bad); font-weight:600; }
  ul.log { list-style:none; margin:0; padding:0; }
  ul.log li { padding:6px 0; border-top:1px solid var(--line); font-size:.92rem;
    display:flex; justify-content:space-between; gap:12px; }
  ul.log li:first-child { border-top:0; }
`;

/**
 * Full HTML document. `refreshSeconds > 0` adds a meta-refresh so the page stays
 * current without manual reload (the simple polling model the PRD specifies).
 */
function layout({ title, body, refreshSeconds = 0 }) {
  const refresh = refreshSeconds > 0
    ? `<meta http-equiv="refresh" content="${refreshSeconds}">`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
${refresh}
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

function loginPage({ error = null } = {}) {
  const body = `
    <header class="bar"><h1>SBIBot Dashboard</h1></header>
    <div class="card">
      <h2>Sign in</h2>
      ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
      <form class="login" method="POST" action="/login">
        <input type="password" name="token" placeholder="Access token" autofocus
               autocomplete="current-password" aria-label="Access token">
        <button type="submit">Sign in</button>
      </form>
    </div>`;
  return layout({ title: 'Sign in · SBIBot', body });
}

function pill(ok, label) {
  return `<span class="pill ${ok ? 'ok' : 'bad'}">${escapeHtml(label)}</span>`;
}

/**
 * @param {object} p
 * @param {string} p.uptime       humanized uptime
 * @param {object} p.discord      { ready, wsPing, guildCount, userTag }
 * @param {string} p.now          current time string (CT)
 * @param {string} p.csrf         CSRF token for the logout form
 * @param {Array}  [p.activity]   recent audit rows [{ action, created_at }]
 * @param {number} [p.refreshSeconds]
 */
function healthPage({ uptime, discord, now, csrf, activity = [], refreshSeconds = 30 }) {
  const d = discord || {};
  const activityHtml = activity.length
    ? `<ul class="log">${activity.map(a => `
        <li><span>${escapeHtml(a.action)}</span>
            <span class="muted">${escapeHtml(formatWhen(a.created_at))}</span></li>`).join('')}</ul>`
    : `<p class="muted">No recorded activity yet.</p>`;

  const body = `
    <header class="bar">
      <h1>SBIBot Dashboard</h1>
      <form method="POST" action="/logout" style="margin:0">
        <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
        <button class="ghost" type="submit">Sign out</button>
      </form>
    </header>

    <div class="card">
      <h2>Health</h2>
      <div class="stat"><span class="k">Discord</span>
        <span class="v">${pill(d.ready, d.ready ? 'Connected' : 'Disconnected')}</span></div>
      <div class="stat"><span class="k">Logged in as</span>
        <span class="v">${escapeHtml(d.userTag || '—')}</span></div>
      <div class="stat"><span class="k">Gateway ping</span>
        <span class="v">${Number.isFinite(d.wsPing) && d.wsPing >= 0 ? escapeHtml(d.wsPing) + ' ms' : '—'}</span></div>
      <div class="stat"><span class="k">Guilds</span>
        <span class="v">${escapeHtml(d.guildCount ?? '—')}</span></div>
      <div class="stat"><span class="k">Process uptime</span>
        <span class="v">${escapeHtml(uptime)}</span></div>
    </div>

    <div class="card">
      <h2>Recent activity</h2>
      ${activityHtml}
    </div>

    <p class="muted">As of ${escapeHtml(now)} · auto-refreshes every ${refreshSeconds}s</p>`;
  return layout({ title: 'Health · SBIBot', body, refreshSeconds });
}

function formatWhen(unixSeconds) {
  if (!unixSeconds) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(unixSeconds * 1000)) + ' CT';
}

module.exports = { layout, loginPage, healthPage, escapeHtml };
