#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const FORMATS = ['console', 'json', 'md', 'llm', 'html', 'text'];
const SHORT = { f: 'format', o: 'output', h: 'help', v: 'version' };
const BOOLEAN = new Set(['json', 'help', 'version', 'summary', 'no-color']);

/* --- Arguments ------------------------------------------------------------ */

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    let name = null;
    let value;
    if (arg.startsWith('--')) {
      [name, value] = arg.slice(2).split(/=(.*)/s);
    } else if (/^-[a-zA-Z]$/.test(arg)) {
      name = SHORT[arg[1]] ?? arg[1];
    }
    if (!name) {
      positional.push(arg);
      continue;
    }
    if (value === undefined && !BOOLEAN.has(name)) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        value = next;
        i++;
      }
    }
    const v = value ?? 'true';
    if (name === 'fail-on' && flags[name]) flags[name] += ',' + v;
    else flags[name] = v;
  }
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const flag = (name, fallback = '') => flags[name] ?? fallback;
const has = (name) => name in flags;

const endpoint = (flag('endpoint') || process.env.CRAWLWISE_ENDPOINT || 'https://crawlwise.site').replace(/\/+$/, '');
const apiKey = flag('api-key') || process.env.CRAWLWISE_API_KEY || '';
const format = has('json') ? 'json' : flag('format', 'console');
const output = flag('output');
const color = format === 'console' && process.stdout.isTTY && !process.env.NO_COLOR && !has('no-color') && !output;

const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint('1');
const dim = paint('2');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');
const cyan = paint('36');
const inverse = paint('1;30;43');

function usage() {
  console.log(`crawlwise ${VERSION}: the SEO audit that shows its evidence

Usage
  npx crawlwise audit <url>                  audit one page (free: 1 a day, no key)
  npx crawlwise audit <url> --baseline <id>  diff against an earlier audit (needs a key)
  npx crawlwise ai-crawlers <url>            can GPTBot, ClaudeBot and the rest read it? free
  npx crawlwise skills install               add the crawlwise skill to Claude Code and other agents
  npx crawlwise tools                        the free toolkit

Options
  -f, --format <fmt>   ${FORMATS.join(' | ')}   (default console)
  -o, --output <file>  write the report to a file instead of stdout
  --json               same as --format json
  --summary            score and counts only
  --fail-on <rule>     exit 1 when a rule trips. Repeatable or comma-separated:
                         score<90  score<=75  fixes>0  warnings>0
                         critical | warning | never   (regressions vs --baseline)
  --api-key <key>      or set CRAWLWISE_API_KEY (cw_live_…, Pro plan or above)
  --endpoint <origin>  or set CRAWLWISE_ENDPOINT (default ${endpoint})
  --no-color           plain output (NO_COLOR is respected too)
  -v, --version
  -h, --help

Exit codes: 0 ok · 1 a --fail-on rule tripped · 2 usage or request error

Pipe it to your agent:
  npx crawlwise audit https://example.com --format llm | claude "fix the priority items"

Docs: ${endpoint}/agents`);
}

function fail(message, code = 2) {
  console.error('crawlwise: ' + message);
  process.exit(code);
}

async function api(route, init = {}) {
  let response;
  try {
    response = await fetch(endpoint + route, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'crawlwise-cli/' + VERSION,
        ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    fail('could not reach ' + endpoint + ' (' + (error?.cause?.code || error?.message || 'network error') + ')');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || body?.error || 'HTTP ' + response.status;
    fail(detail, 2);
  }
  return body;
}

function emit(text) {
  if (output) {
    fs.writeFileSync(output, text.endsWith('\n') ? text : text + '\n');
    process.stderr.write('crawlwise: wrote ' + output + '\n');
  } else {
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  }
}

/* --- Gate ----------------------------------------------------------------- */

/**
 * `--fail-on` rules. Numbers come from the report the user just saw, so a
 * gate never trips on something the output did not show.
 *   score<N / score<=N   the Crawlwise checklist score
 *   fixes>N              items under "priority" (alias: errors)
 *   warnings>N           items under "worth considering"
 *   critical | warning   regressions against --baseline
 */
function parseRules(raw) {
  return String(raw)
    .split(',')
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => {
      if (['critical', 'warning', 'never'].includes(rule)) return { kind: 'regression', level: rule, text: rule };
      const match = rule.match(/^(score|fixes|errors|warnings)\s*(<=|>=|<|>|=)\s*(\d+)$/);
      if (!match) fail('cannot read --fail-on "' + rule + '". Try score<90, fixes>0, warnings>0, or critical.');
      return { kind: 'metric', metric: match[1] === 'errors' ? 'fixes' : match[1], op: match[2], value: Number(match[3]), text: rule };
    });
}

function compare(a, op, b) {
  return op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b;
}

function tripped(rules, metrics) {
  return rules
    .filter((rule) => rule.kind === 'metric')
    .filter((rule) => {
      const actual = metrics[rule.metric];
      return actual !== null && actual !== undefined && compare(actual, rule.op, rule.value);
    })
    .map((rule) => rule.text + ' (actual ' + metrics[rule.metric] + ')');
}

/* --- Rendering: full report ------------------------------------------------ */

const KIND = {
  priority: { label: 'Priority', blurb: 'Defects with evidence. Fix these.' },
  worth_considering: { label: 'Worth considering', blurb: 'Observations that may not apply to this site. Ask before acting.' },
  not_measured: { label: 'Not measured', blurb: 'Tests that returned no result. They say nothing about the page either way.' },
};

function scoreLine(scoring) {
  return scoring?.score === null || scoring?.score === undefined
    ? 'not scored'
    : scoring.score + '/100 from ' + scoring.applicable + ' applicable checks';
}

function markdown(job, { forAgent = false } = {}) {
  const report = job.report ?? {};
  const checks = report.checks ?? [];
  const passed = checks.filter((check) => check.status === 'pass');
  const lines = [];
  if (forAgent) {
    lines.push(
      '<!-- crawlwise audit, written for a coding agent -->',
      'You are fixing SEO issues found by crawlwise. Fix ONLY the items under "Priority", in order.',
      'Each item cites the check it came from. Do not invent checks. "Worth considering" items need the user\'s answer first, and "Not measured" items are not defects.',
      'When done, re-run: npx crawlwise audit ' + (job.url || '') + ' --format llm',
      ''
    );
  }
  lines.push('# Crawlwise audit: ' + (job.url || ''), '', 'Score: ' + scoreLine(report.scoring), 'Scanned: ' + (job.completed_at || job.created_at || new Date().toISOString()), '');
  for (const key of ['priority', 'worth_considering', 'not_measured']) {
    const list = report[key] ?? [];
    if (!list.length) continue;
    lines.push('## ' + KIND[key].label + ' (' + list.length + ')', KIND[key].blurb, '');
    list.forEach((action, index) => {
      lines.push('### ' + (index + 1) + '. ' + action.title + ' [' + action.priority + ']');
      if (action.checkIds?.length) lines.push('Checks: ' + action.checkIds.join(', '));
      if (action.why) lines.push('Evidence: ' + action.why);
      if (action.steps?.length) lines.push('', 'Steps:', ...action.steps.map((step, i) => i + 1 + '. ' + step));
      if (action.verify) lines.push('Verify: ' + action.verify);
      if (action.code) lines.push('', '```', action.code, '```');
      lines.push('');
    });
  }
  if (!forAgent) {
    lines.push('## Passed checks (' + passed.length + ')', ...passed.map((check) => '- ' + check.title), '');
  }
  lines.push('---', 'Crawlwise checklist score: not a Google score or a ranking prediction. Methodology v' + (report.scoring?.methodology ?? '?') + '. ' + endpoint + '/methodology');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function html(job) {
  const report = job.report ?? {};
  const section = (key) => {
    const list = report[key] ?? [];
    if (!list.length) return '';
    return `<section><h2>${KIND[key].label} <small>${list.length}</small></h2><p class="blurb">${KIND[key].blurb}</p>${list
      .map(
        (a) => `<article><h3>${escapeHtml(a.title)} <span class="pill">${escapeHtml(a.priority)}</span></h3>
<p class="checks">${escapeHtml((a.checkIds ?? []).join(', '))}</p>
${a.why ? `<p><b>Evidence:</b> ${escapeHtml(a.why)}</p>` : ''}
${a.steps?.length ? `<ol>${a.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}
${a.verify ? `<p><b>Verify:</b> ${escapeHtml(a.verify)}</p>` : ''}
${a.code ? `<pre><code>${escapeHtml(a.code)}</code></pre>` : ''}</article>`
      )
      .join('')}</section>`;
  };
  const passed = (report.checks ?? []).filter((c) => c.status === 'pass');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Crawlwise audit: ${escapeHtml(job.url)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#1c1b19;--muted:#6b675f;--card:#fff;--line:#e7e3da;--brand:#c2410c}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#f1eee8;--muted:#a39e94;--card:#1f1e1b;--line:#33312c;--brand:#fb923c}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.6rem;margin:0 0 4px;word-break:break-all}.meta{color:var(--muted);margin:0 0 24px}
.score{font-size:2.4rem;font-weight:700;color:var(--brand)}
h2{margin:32px 0 4px}h2 small{color:var(--muted);font-weight:400}.blurb{color:var(--muted);margin:0 0 12px}
article{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:0 0 12px}
h3{margin:0 0 4px;font-size:1.05rem}.pill{font-size:.75rem;border:1px solid var(--line);border-radius:999px;padding:1px 8px;color:var(--muted)}
.checks{font:12px ui-monospace,monospace;color:var(--muted);margin:0 0 8px}
pre{overflow-x:auto;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px}
ul.passed{columns:2;color:var(--muted)}footer{margin-top:40px;color:var(--muted);font-size:.875rem}a{color:var(--brand)}
@media (max-width:600px){ul.passed{columns:1}}
</style></head><body><main>
<h1>${escapeHtml(job.url)}</h1>
<p class="meta">Crawlwise audit · ${escapeHtml(job.completed_at || job.created_at || '')}</p>
<div class="score">${escapeHtml(scoreLine(report.scoring))}</div>
${section('priority')}${section('worth_considering')}${section('not_measured')}
<section><h2>Passed checks <small>${passed.length}</small></h2><ul class="passed">${passed.map((c) => `<li>${escapeHtml(c.title)}</li>`).join('')}</ul></section>
<footer>The Crawlwise checklist score is not a Google score or a ranking prediction. <a href="${endpoint}/methodology">Methodology</a> · <a href="${endpoint}">crawlwise.site</a></footer>
</main></body></html>`;
}

function consoleReport(job, { summary }) {
  const report = job.report ?? {};
  const priority = report.priority ?? [];
  const review = report.worth_considering ?? [];
  const unmeasured = report.not_measured ?? [];
  const lines = ['', bold(job.url) + '  ·  ' + cyan(scoreLine(report.scoring)), red(priority.length + ' to fix') + ' · ' + yellow(review.length + ' worth reviewing') + ' · ' + dim(unmeasured.length + ' not measured')];
  if (!summary) {
    priority.slice(0, 10).forEach((action, index) => {
      lines.push('', '  ' + bold(index + 1 + '. ' + action.title) + ' ' + dim('[' + action.priority + ']'));
      if (action.why) lines.push('     ' + action.why);
    });
    if (priority.length > 10) lines.push('', dim('  …and ' + (priority.length - 10) + ' more. Use --format md for all of them.'));
  }
  lines.push('', dim('Report: ' + endpoint + '/history'));
  return lines.join('\n');
}

/* --- Rendering: free teaser ------------------------------------------------ */

function upsellBox(teaser) {
  const shown = teaser.topIssues.length;
  const rows = [
    'FREE AUDIT · ' + shown + ' of ' + teaser.issues + ' issues shown',
    '',
    'Unlock every fix, the evidence behind it, Core Web',
    'Vitals and an action plan your agent can apply:',
    '',
    '→ ' + teaser.upgrade.plans,
    '  then: export CRAWLWISE_API_KEY=cw_live_…',
  ];
  const width = Math.max(...rows.map((row) => row.length)) + 4;
  const line = (text, style = (t) => t) => (color ? yellow('│') : '|') + '  ' + style(text.padEnd(width - 4)) + '  ' + (color ? yellow('│') : '|');
  const top = color ? yellow('╭' + '─'.repeat(width) + '╮') : '+' + '-'.repeat(width) + '+';
  const bottom = color ? yellow('╰' + '─'.repeat(width) + '╯') : '+' + '-'.repeat(width) + '+';
  return [top, line(rows[0], (t) => (color ? inverse(t) : t.toUpperCase())), ...rows.slice(1).map((row, i) => line(row, i === 4 ? bold : (t) => t)), bottom].join('\n');
}

function teaserMarkdown(teaser, { forAgent = false } = {}) {
  const lines = [];
  if (forAgent) lines.push('<!-- crawlwise free audit: titles only. The full report (fixes, evidence, steps) needs CRAWLWISE_API_KEY. -->', '');
  lines.push(
    '# Crawlwise free audit: ' + teaser.finalUrl,
    '',
    'Score: ' + (teaser.score ?? 'not scored') + '/100 from ' + teaser.applicable + ' applicable checks',
    'Passed: ' + teaser.passed + ' · Issues: ' + teaser.issues + ' · Not measured: ' + teaser.unmeasured,
    '',
    '## Top issues (' + teaser.topIssues.length + ' of ' + teaser.issues + ')',
    ...teaser.topIssues.map((issue, i) => i + 1 + '. ' + issue.title + ' [' + issue.impact + '] (check: ' + issue.id + ')'),
    '',
    teaser.lockedIssues ? teaser.lockedIssues + ' more issue(s), every fix, its evidence and the action plan are in the full audit: ' + teaser.upgrade.plans : 'The fixes, their evidence and the action plan are in the full audit: ' + teaser.upgrade.plans
  );
  return lines.join('\n');
}

function teaserConsole(teaser, { summary }) {
  const lines = [
    '',
    bold(teaser.finalUrl) + '  ·  ' + cyan((teaser.score ?? 'not scored') + '/100') + dim(' from ' + teaser.applicable + ' applicable checks'),
    green(teaser.passed + ' passed') + ' · ' + red(teaser.issues + ' issues') + ' · ' + dim(teaser.unmeasured + ' not measured'),
  ];
  if (!summary && teaser.topIssues.length) {
    lines.push('', bold('Top issues'));
    teaser.topIssues.forEach((issue, i) => lines.push('  ' + (i + 1) + '. ' + issue.title + ' ' + dim('[' + issue.impact + ']')));
    if (teaser.lockedIssues) lines.push(dim('  + ' + teaser.lockedIssues + ' more, locked on the free audit'));
  }
  lines.push('', upsellBox(teaser), '');
  return lines.join('\n');
}

/* --- Commands -------------------------------------------------------------- */

async function audit(url) {
  if (!FORMATS.includes(format)) fail('unknown --format "' + format + '". Use one of: ' + FORMATS.join(', '));
  const rules = parseRules(flag('fail-on', flag('baseline') ? 'critical' : 'never'));
  const baselineId = flag('baseline');
  if (!apiKey) {
    if (baselineId) fail('--baseline needs an API key. Set CRAWLWISE_API_KEY (Pro plan or above): ' + endpoint + '/account/api');
    return freeAudit(url, rules);
  }

  const started = await api('/v1/audits', { method: 'POST', body: JSON.stringify({ url }) });
  process.stderr.write('crawlwise: audit ' + started.id + ' started\n');
  const deadline = Date.now() + 5 * 60_000;
  let job;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    job = await api('/v1/audits/' + encodeURIComponent(started.id));
    if (job.status === 'complete' || job.status === 'failed' || job.status === 'abandoned') break;
  }
  if (!job || job.status !== 'complete') fail('the audit ended as ' + (job?.status ?? 'still running') + (job?.error ? ': ' + job.error : ''), 2);
  job = { ...job, id: started.id, url: job.url || url };
  const report = job.report ?? {};

  let regressions = [];
  if (baselineId) {
    const before = await api('/v1/audits/' + encodeURIComponent(baselineId));
    if (before.status !== 'complete') fail('the baseline audit ' + baselineId + ' is ' + before.status, 2);
    const old = new Map((before.report?.checks ?? []).map((check) => [check.id, check]));
    regressions = (report.checks ?? []).filter((check) => check.status !== 'pass' && old.get(check.id)?.status === 'pass');
  }

  if (format === 'json') emit(JSON.stringify({ id: job.id, status: job.status, url: job.url, report, regressions: baselineId ? regressions : undefined }, null, 2));
  else if (format === 'md') emit(markdown(job));
  else if (format === 'llm') emit(markdown(job, { forAgent: true }));
  else if (format === 'html') emit(html(job));
  else emit(consoleReport(job, { summary: has('summary') }));

  if (baselineId) {
    const lines = [regressions.length ? regressions.length + ' regression(s) against ' + baselineId + ':' : 'No regressions against ' + baselineId + '.'];
    for (const check of regressions) lines.push('  ' + check.id + ': pass → ' + check.status + '  ' + check.title);
    process.stderr.write(lines.join('\n') + '\n');
  }

  const metrics = {
    score: report.scoring?.score ?? null,
    fixes: (report.priority ?? []).length,
    warnings: (report.worth_considering ?? []).length,
  };
  const reasons = tripped(rules, metrics);
  const level = rules.find((rule) => rule.kind === 'regression')?.level;
  const critical = regressions.filter((check) => ['index', 'ai-crawler-access'].includes(check.id));
  if (level === 'critical' && critical.length) reasons.push('critical regression: ' + critical.map((c) => c.id).join(', '));
  if (level === 'warning' && regressions.length) reasons.push(regressions.length + ' regression(s)');
  return gate(reasons);
}

async function freeAudit(url, rules) {
  process.stderr.write(dim('crawlwise: free audit (no API key) · 1 page a day · running…') + '\n');
  const teaser = await api('/api/cli/audit', { method: 'POST', body: JSON.stringify({ url }) });
  if (format === 'json') {
    emit(JSON.stringify(teaser, null, 2));
    process.stderr.write('crawlwise: free audit. Full report with fixes: ' + teaser.upgrade.plans + '\n');
  } else if (format === 'md' || format === 'text') {
    emit(teaserMarkdown(teaser));
  } else if (format === 'llm') {
    emit(teaserMarkdown(teaser, { forAgent: true }));
  } else if (format === 'html') {
    fail('--format html needs the full report. Set CRAWLWISE_API_KEY (Pro plan or above): ' + teaser.upgrade.plans);
  } else {
    emit(teaserConsole(teaser, { summary: has('summary') }));
  }
  if (format !== 'console') process.stderr.write('\n' + upsellBox(teaser) + '\n');
  return gate(tripped(rules, { score: teaser.score, fixes: teaser.issues, warnings: null }));
}

function gate(reasons) {
  if (!reasons.length) return 0;
  process.stderr.write(red('crawlwise: --fail-on tripped: ' + reasons.join('; ')) + '\n');
  return 1;
}

async function aiCrawlers(url) {
  const body = await api('/api/tools/ai-crawlers', { method: 'POST', body: JSON.stringify({ url }) });
  if (format === 'json') {
    emit(JSON.stringify(body, null, 2));
    return 0;
  }
  const verdictColor = (verdict) => (verdict === 'blocked' ? red : verdict === 'allowed' ? green : yellow);
  const lines = ['', bold(body.finalUrl || url)];
  for (const row of body.rows ?? []) {
    lines.push('  ' + row.id.padEnd(20) + verdictColor(row.verdict)(row.verdict.padEnd(17)) + dim(row.deliberate ? '(deliberate opt-out)' : row.purpose));
  }
  const blocked = (body.rows ?? []).filter((row) => row.verdict === 'blocked' && !row.deliberate);
  if (blocked.length) lines.push('', red(blocked.length + ' crawler(s) blocked without an intended opt-out: ' + blocked.map((row) => row.id).join(', ')));
  if (body.shareId) lines.push('', 'Shareable: ' + endpoint + '/tools/ai-crawler-check/r/' + body.shareId);
  lines.push('', dim('Next: npx crawlwise audit ' + (body.finalUrl || url) + '   (free, 1 page a day)'));
  emit(lines.join('\n'));
  return 0;
}

async function tools() {
  const body = await api('/api/tools/catalogue').catch(() => null);
  const list = body?.tools ?? [];
  if (format === 'json') {
    emit(JSON.stringify(list, null, 2));
    return 0;
  }
  emit(['', 'Free tools, no account, no credit: ' + endpoint + '/tools', ...list.map((tool) => '  ' + tool.slug.padEnd(22) + tool.title)].join('\n'));
  return 0;
}

/**
 * Copies the bundled skill into the folders agents read skills from:
 * ~/.claude/skills (Claude Code) and ~/.agents/skills (the shared location
 * other agents use). `--dir <path>` installs into one folder instead.
 */
function skillsInstall() {
  const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'crawlwise');
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) fail('the bundled skill is missing from this package. Reinstall: npx crawlwise@latest skills install');
  const targets = flag('dir')
    ? [path.resolve(flag('dir'), 'crawlwise')]
    : [path.join(os.homedir(), '.claude', 'skills', 'crawlwise'), path.join(os.homedir(), '.agents', 'skills', 'crawlwise')];
  for (const dest of targets) {
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(src, dest, { recursive: true });
    console.log(green('✓') + ' installed ' + dest);
  }
  console.log('\nRestart your agent, then ask: ' + bold('"audit https://your-site.com with crawlwise and fix the priority items"'));
  return 0;
}

/* --- Main ------------------------------------------------------------------ */

const [command, target] = positional;
if (has('version') && !command) {
  console.log(VERSION);
  process.exit(0);
}
if (!command || has('help') || command === 'help') {
  usage();
  process.exit(has('help') || command === 'help' ? 0 : 2);
}

if (command === 'audit') {
  if (!target) fail('which URL?  crawlwise audit https://example.com');
  process.exit(await audit(target));
} else if (command === 'ai-crawlers') {
  if (!target) fail('which URL?  crawlwise ai-crawlers https://example.com');
  process.exit(await aiCrawlers(target));
} else if (command === 'tools') {
  process.exit(await tools());
} else if (command === 'skills' && (target === 'install' || target === 'add')) {
  process.exit(skillsInstall());
} else if (command === 'version') {
  console.log(VERSION);
  process.exit(0);
} else {
  usage();
  process.exit(2);
}
