/**
 * The page shell.
 *
 * Server-rendered HTML with no client framework, because phase two is read-only:
 * a table, a fixture list and match reports. Phase three brings lineup forms and
 * authentication, which is the right moment to introduce a framework -- and the
 * moment a real Postgres server replaces the embedded one.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
:root {
  --bg: #E9ECF1; --surface: #FFFFFF; --surface-2: #F3F5F9;
  --line: #D2D8E2; --line-soft: #E2E7EE;
  --ink: #141821; --ink-2: #3C4455; --muted: #656F84;
  --gold: #9A6B12; --gold-bg: #F6EBD2;
  --risk: #A2333F; --good: #1F6B60;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0D1017; --surface: #14181F; --surface-2: #1A1F28;
    --line: #2A313D; --line-soft: #212832;
    --ink: #E7EAF1; --ink-2: #B7BECC; --muted: #838C9E;
    --gold: #E3B558; --gold-bg: #26200F;
    --risk: #E88C96; --good: #6FC7B6;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 20px 80px; background: var(--bg); color: var(--ink);
  font-family: "Newsreader", Georgia, serif; font-size: 17px; line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1000px; margin: 0 auto; }
h1, h2, h3, nav a, th, .mono, .tag {
  font-family: "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif;
}
h1 { font-size: clamp(1.9rem, 5vw, 2.8rem); font-weight: 800; letter-spacing: -.03em; margin: 0; line-height: 1; }
h2 { font-size: 1.25rem; font-weight: 700; letter-spacing: -.02em; margin: 0; }
h3 { font-size: .95rem; font-weight: 700; margin: 0; }
a { color: var(--gold); text-underline-offset: 2px; }
a:focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
header { padding: 44px 0 0; display: flex; flex-direction: column; gap: 16px; }
.eyebrow, .mono, td.num, th.num, .tag {
  font-family: "IBM Plex Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums;
}
.eyebrow { font-size: .66rem; letter-spacing: .17em; text-transform: uppercase; color: var(--muted); }
nav { display: flex; gap: 18px; flex-wrap: wrap; padding: 18px 0; border-bottom: 1px solid var(--line); }
nav a { font-size: .78rem; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; text-decoration: none; color: var(--muted); }
nav a:hover, nav a[aria-current="page"] { color: var(--gold); }
section { padding: 40px 0 0; display: flex; flex-direction: column; gap: 14px; }
.scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 5px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { text-align: left; padding: 9px 14px; border-bottom: 1px solid var(--line-soft); white-space: nowrap; }
thead th { font-size: .64rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
tbody tr:last-child td { border-bottom: none; }
td.num, th.num { text-align: right; }
tbody tr.highlight td { background: var(--gold-bg); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
.card { background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; }
.note { font-size: .9rem; color: var(--muted); }
.tag { display: inline-block; font-size: .6rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; padding: .25em .5em; border-radius: 3px; background: var(--surface-2); color: var(--muted); border: 1px solid var(--line-soft); }
.score { font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-variant-numeric: tabular-nums; }
.result { display: flex; align-items: baseline; gap: 10px; justify-content: space-between; }
.timeline { display: flex; flex-direction: column; gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
.tl { background: var(--surface); padding: 8px 14px; display: grid; grid-template-columns: 48px 44px 1fr auto; gap: 12px; align-items: baseline; font-size: .9rem; }
.tl .min, .tl .who, .tl .sc { font-family: "IBM Plex Mono", monospace; font-size: .76rem; font-variant-numeric: tabular-nums; }
.tl .min { color: var(--muted); text-align: right; }
.tl .who { color: var(--gold); font-weight: 600; }
.tl .sc { color: var(--muted); }
.tl.goal { background: var(--surface-2); }
.tl.snitch { background: var(--gold-bg); }
.tl.snitch .who { color: var(--gold); }
.bigscore { display: flex; align-items: center; justify-content: center; gap: 22px; padding: 8px 0 0; flex-wrap: wrap; }
.bigscore .n { font-family: "Bricolage Grotesque", sans-serif; font-weight: 800; font-size: clamp(2rem, 7vw, 3.4rem); letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.bigscore .side { font-size: 1.05rem; font-weight: 600; font-family: "Bricolage Grotesque", sans-serif; }
footer { margin-top: 60px; padding-top: 18px; border-top: 1px solid var(--line); }

.navspace { flex: 1; }
nav form.inline { margin: 0; display: inline; }
.linkish {
  background: none; border: none; padding: 0; cursor: pointer; color: var(--muted);
  font-family: "Bricolage Grotesque", sans-serif; font-size: .78rem; font-weight: 600;
  letter-spacing: .08em; text-transform: uppercase;
}
.linkish:hover { color: var(--gold); }

.notice { margin: 22px 0 0; padding: 12px 16px; border-radius: 4px; font-size: .92rem; border-left: 2px solid var(--good); background: var(--surface); }
.notice.problem { border-left-color: var(--risk); }

form { display: flex; flex-direction: column; gap: 14px; }
label { display: flex; flex-direction: column; gap: 5px; font-size: .82rem; font-weight: 600; font-family: "Bricolage Grotesque", sans-serif; color: var(--ink-2); }
input[type="text"], input[type="email"], input[type="password"], select {
  font-family: inherit; font-size: .95rem; padding: 8px 10px; border-radius: 4px;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink);
}
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
button.primary, .buttonlink {
  align-self: flex-start; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700;
  font-size: .85rem; letter-spacing: .02em; padding: 9px 16px; border-radius: 4px;
  border: 1px solid var(--gold); background: var(--gold); color: var(--bg); cursor: pointer;
  text-decoration: none;
}
button.primary:hover { filter: brightness(1.08); }
button.secondary {
  align-self: flex-start; font-family: "Bricolage Grotesque", sans-serif; font-weight: 600;
  font-size: .8rem; padding: 7px 13px; border-radius: 4px; border: 1px solid var(--line);
  background: var(--surface); color: var(--ink); cursor: pointer;
}
button.secondary:hover { border-color: var(--gold); color: var(--gold); }
button:disabled { opacity: .45; cursor: not-allowed; }
.formrow { display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-end; }
.money { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
.money.neg { color: var(--risk); }
.money.pos { color: var(--good); }
.kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 5px; overflow: hidden; }
.kv > div { background: var(--surface); padding: 13px 15px; }
.kv dt { font-family: "IBM Plex Mono", monospace; font-size: .62rem; letter-spacing: .13em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.kv dd { margin: 0; font-family: "Bricolage Grotesque", sans-serif; font-weight: 700; font-size: 1.15rem; font-variant-numeric: tabular-nums; }
.slot { display: grid; grid-template-columns: 90px 1fr; gap: 12px; align-items: center; }
.slot span.pos { font-family: "IBM Plex Mono", monospace; font-size: .68rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.deadline { font-family: "IBM Plex Mono", monospace; font-size: .8rem; color: var(--gold); }
`;

export interface LayoutOptions {
  title: string;
  active?: string;
  subtitle?: string;
  /** Signed-in manager, if any. Drives the right-hand side of the nav. */
  user?: { displayName: string; clubId: string | null } | null;
  /** One-line result carried through a redirect. */
  notice?: { text: string; kind: 'ok' | 'problem' } | null;
  /**
   * Reload the page every N seconds. Used only while a match is being revealed --
   * a meta refresh keeps the whole app free of client-side JavaScript, and a
   * finished page has no reason to reload at all.
   */
  refreshSeconds?: number;
}

const NAV: [string, string][] = [
  ['/', 'Table'],
  ['/fixtures', 'Fixtures'],
  ['/results', 'Results'],
  ['/leaders', 'Leaders'],
  ['/clubs', 'Clubs'],
];

export function page(options: LayoutOptions, body: string): string {
  const nav = NAV.map(
    ([href, label]) =>
      `<a href="${href}"${options.active === href ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  const account = options.user
    ? `<span class="navspace"></span>` +
      `<a href="/my"${options.active === '/my' ? ' aria-current="page"' : ''}>` +
      `${options.user.clubId ? 'My club' : 'Claim a club'}</a>` +
      `<form method="post" action="/logout" class="inline"><button type="submit" class="linkish">Sign out</button></form>`
    : `<span class="navspace"></span><a href="/login">Sign in</a>`;

  const notice = options.notice
    ? `<div class="notice ${options.notice.kind}">${escapeHtml(options.notice.text)}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : ''}
<title>${escapeHtml(options.title)} &middot; Quidditch Legends</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header>
  <p class="eyebrow">Quidditch Legends${options.subtitle ? ` &middot; ${escapeHtml(options.subtitle)}` : ''}</p>
  <h1>${escapeHtml(options.title)}</h1>
</header>
<nav>${nav}${account}</nav>
${notice}
${body}
<footer><p class="note">Every result on this site was simulated by a scheduled job and published from its event log. Nothing here is computed on request.</p></footer>
</div>
</body>
</html>`;
}

export function tableHtml(
  headers: { label: string; num?: boolean }[],
  rows: string[][],
  options: { highlight?: (index: number) => boolean } = {},
): string {
  const head = headers
    .map((header) => `<th${header.num ? ' class="num"' : ''}>${header.label}</th>`)
    .join('');
  const body = rows
    .map(
      (row, index) =>
        `<tr${options.highlight?.(index) ? ' class="highlight"' : ''}>` +
        row
          .map((cell, column) => `<td${headers[column]?.num ? ' class="num"' : ''}>${cell}</td>`)
          .join('') +
        '</tr>',
    )
    .join('');
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
