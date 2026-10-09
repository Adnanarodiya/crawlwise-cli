// Runs the real CLI against a local mock of the crawlwise API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'crawlwise.mjs');

const TEASER = {
  free: true,
  url: 'https://example.com',
  finalUrl: 'https://example.com/',
  hostname: 'example.com',
  scannedAt: '2026-10-09T00:00:00.000Z',
  score: 72,
  applicable: 20,
  total: 31,
  passed: 14,
  issues: 6,
  unmeasured: 2,
  lockedIssues: 3,
  methodology: 6,
  topIssues: [
    { id: 'meta-description', title: 'Meta description is missing', impact: 'High', status: 'fail', category: 'seo' },
    { id: 'h1', title: 'More than one H1', impact: 'Medium', status: 'warning', category: 'seo' },
    { id: 'og', title: 'Open Graph image missing', impact: 'Low', status: 'fail', category: 'seo' },
  ],
  limits: { perDay: 1 },
  upgrade: { plans: 'https://crawlwise.site/plans', apiKey: 'https://crawlwise.site/account/api' },
};

const REPORT = {
  scoring: { score: 88, applicable: 25, total: 31, methodology: 6 },
  priority: [
    { title: 'Add a meta description', priority: 'High', why: 'No <meta name="description"> in the source HTML.', steps: ['Write 150 characters.', 'Add the tag.'], verify: 'View source.', checkIds: ['meta-description'] },
  ],
  worth_considering: [{ title: 'Consider FAQ schema', priority: 'Low', why: 'Q&A content found.', steps: [], verify: '', checkIds: ['faq'] }],
  not_measured: [],
  checks: [
    { id: 'title', title: 'Title tag', status: 'pass' },
    { id: 'meta-description', title: 'Meta description', status: 'fail' },
    { id: 'index', title: 'Indexable', status: 'pass' },
  ],
};
const BASELINE_REPORT = { ...REPORT, checks: REPORT.checks.map((c) => ({ ...c, status: 'pass' })) };

let server;
let endpoint;

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/api/cli/audit' && req.method === 'POST') {
      if (JSON.parse(body).url === 'https://limited.example') return send(429, { error: "That is today's free CLI audit from this network.", code: 'RATE_LIMITED' });
      return send(200, TEASER);
    }
    if (req.headers.authorization !== 'Bearer cw_live_test') return send(401, { error: { message: 'Missing API key' } });
    if (req.url === '/v1/audits' && req.method === 'POST') return send(202, { id: 'job_new', status: 'queued' });
    if (req.url === '/v1/audits/job_new') return send(200, { status: 'complete', url: 'https://example.com/', completed_at: '2026-10-09T00:00:00Z', report: REPORT });
    if (req.url === '/v1/audits/job_old') return send(200, { status: 'complete', url: 'https://example.com/', report: BASELINE_REPORT });
    send(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  endpoint = 'http://127.0.0.1:' + server.address().port;
});

after(() => server.close());

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args, '--endpoint', endpoint], {
      env: { ...process.env, CRAWLWISE_API_KEY: '', NO_COLOR: '1', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const KEY = { CRAWLWISE_API_KEY: 'cw_live_test' };

test('free audit prints score, top issues and the upgrade box', async () => {
  const { code, stdout } = await run(['audit', 'https://example.com']);
  assert.equal(code, 0);
  assert.match(stdout, /72\/100/);
  assert.match(stdout, /Meta description is missing/);
  assert.match(stdout, /3 more, locked/);
  assert.match(stdout, /FREE AUDIT · 3 OF 6 ISSUES SHOWN/);
  assert.match(stdout, /crawlwise\.site\/plans/);
});

test('free audit json stays clean on stdout; the box goes to stderr', async () => {
  const { code, stdout, stderr } = await run(['audit', 'https://example.com', '--json']);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).score, 72);
  assert.match(stderr, /FREE AUDIT/);
});

test('free audit llm format is agent-ready markdown', async () => {
  const { stdout } = await run(['audit', 'https://example.com', '-f', 'llm']);
  assert.match(stdout, /^<!-- crawlwise free audit/);
  assert.match(stdout, /check: meta-description/);
});

test('free audit refuses html and --baseline without a key', async () => {
  assert.equal((await run(['audit', 'https://example.com', '-f', 'html'])).code, 2);
  const baseline = await run(['audit', 'https://example.com', '--baseline', 'job_old']);
  assert.equal(baseline.code, 2);
  assert.match(baseline.stderr, /needs an API key/);
});

test('free audit rate limit surfaces the server message with exit 2', async () => {
  const { code, stderr } = await run(['audit', 'https://limited.example']);
  assert.equal(code, 2);
  assert.match(stderr, /free CLI audit/);
});

test('score gate trips on the free audit', async () => {
  assert.equal((await run(['audit', 'https://example.com', '--fail-on', 'score<90'])).code, 1);
  assert.equal((await run(['audit', 'https://example.com', '--fail-on', 'score<50'])).code, 0);
});

test('full audit renders md, llm, html and json', async () => {
  const md = await run(['audit', 'https://example.com', '-f', 'md'], KEY);
  assert.equal(md.code, 0, md.stderr);
  assert.match(md.stdout, /## Priority \(1\)/);
  assert.match(md.stdout, /Checks: meta-description/);
  assert.match(md.stdout, /## Passed checks \(2\)/);

  const llm = await run(['audit', 'https://example.com', '--format=llm'], KEY);
  assert.match(llm.stdout, /Fix ONLY the items under "Priority"/);

  const html = await run(['audit', 'https://example.com', '-f', 'html'], KEY);
  assert.match(html.stdout, /^<!doctype html>/);
  assert.match(html.stdout, /&lt;meta name=&quot;description&quot;&gt;/);

  const json = await run(['audit', 'https://example.com', '--json'], KEY);
  assert.equal(JSON.parse(json.stdout).report.scoring.score, 88);
});

test('full audit writes to a file with -o', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-')), 'report.html');
  const { code } = await run(['audit', 'https://example.com', '-f', 'html', '-o', file], KEY);
  assert.equal(code, 0);
  assert.match(fs.readFileSync(file, 'utf8'), /Crawlwise audit/);
});

test('full audit gates: fixes, warnings, score', async () => {
  assert.equal((await run(['audit', 'https://example.com', '--fail-on', 'fixes>0'], KEY)).code, 1);
  assert.equal((await run(['audit', 'https://example.com', '--fail-on', 'score<80,warnings>5'], KEY)).code, 0);
  assert.equal((await run(['audit', 'https://example.com', '--fail-on', 'score<80', '--fail-on', 'warnings>0'], KEY)).code, 1);
});

test('baseline: a warning-level regression trips --fail-on warning, not critical', async () => {
  const warn = await run(['audit', 'https://example.com', '--baseline', 'job_old', '--fail-on', 'warning'], KEY);
  assert.equal(warn.code, 1);
  assert.match(warn.stderr, /meta-description: pass → fail/);
  assert.equal((await run(['audit', 'https://example.com', '--baseline', 'job_old'], KEY)).code, 0);
});

test('version and help exit 0; unknown command exits 2', async () => {
  assert.match((await run(['--version'])).stdout, /^\d+\.\d+\.\d+/);
  assert.equal((await run(['--help'])).code, 0);
  assert.equal((await run(['nope'])).code, 2);
});
