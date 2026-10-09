# crawlwise CLI

**Audit your site in one command.** SEO, AI-crawler access and answer-engine readiness, from your terminal, your CI or your coding agent. Every finding cites the check it came from, and anything we could not measure is marked *not measured*, never counted against you.

```bash
npx crawlwise audit https://your-site.com
```

No install, no account. Needs Node.js 22+. Published on npm as [`crawlwise`](https://www.npmjs.com/package/crawlwise). MIT licensed.

## Commands

```bash
npx crawlwise audit https://example.com              # free: 1 page a day, score + top issues
npx crawlwise ai-crawlers https://example.com        # free: can GPTBot, ClaudeBot, PerplexityBot… read it?
npx crawlwise skills install                         # add the crawlwise skill to Claude Code and other agents
npx crawlwise tools                                  # the free web toolkit
```

## Free vs full audit

| | Free (no key) | Full (`CRAWLWISE_API_KEY`) |
|---|---|---|
| Score and counts | ✅ | ✅ |
| Issues | Top 3 titles | Every finding |
| Fixes, evidence, steps, verify line | — | ✅ |
| Core Web Vitals (PageSpeed + CrUX) | — | ✅ |
| Action plan for agents (`--format llm`) | Titles only | ✅ |
| HTML report, baseline diff | — | ✅ |
| Limit | 1 page a day per network | Your plan's credits (~1.25 per page) |

A full audit needs the Pro plan or above and a key from [crawlwise.site/account/api](https://crawlwise.site/account/api):

```bash
export CRAWLWISE_API_KEY=cw_live_...
```

## Use it with a coding agent

Pipe the agent-ready format straight in:

```bash
npx crawlwise audit https://example.com --format llm | claude "fix the priority items"
```

Or install the skill once and just ask your agent to *"audit example.com with crawlwise and fix the priority items"*:

```bash
npx crawlwise skills install
```

For tool calls instead of a pipe, connect the MCP server: `https://crawlwise.site/mcp` ([setup for every agent](https://crawlwise.site/agents)).

## Output formats

`-f, --format <fmt>` with `-o, --output <file>`:

| Format | For |
|---|---|
| `console` (default) | You, in a terminal |
| `md` | A report file or a PR description |
| `llm` | A coding agent: priority-only instructions, each fix cites its check |
| `html` | A self-contained report to share (full audit) |
| `json` | Scripts and CI |
| `text` | Plain text, no colour |

## CI gate

```bash
npx crawlwise audit "$PREVIEW_URL" --fail-on 'score<90' --fail-on 'fixes>0'
npx crawlwise audit "$PREVIEW_URL" --baseline "$LAST_GOOD_AUDIT_ID" --fail-on critical
```

`--fail-on` rules (repeatable or comma-separated):

| Rule | Trips when |
|---|---|
| `score<N`, `score<=N` | The Crawlwise checklist score is below N |
| `fixes>N` (alias `errors>N`) | More than N items under *priority* |
| `warnings>N` | More than N items under *worth considering* (full audit) |
| `critical` / `warning` / `never` | A regression against `--baseline` at that level |

Quote each rule: shells treat bare `<` and `>` as redirection.

A check that did not run on the baseline is reported as new and never counts as a regression. A methodology change is not a defect.

On GitHub, the [crawlwise audit action](https://github.com/Adnanarodiya/crawlwise-audit-action) does the same and comments the diff on the pull request.

## Exit codes

- `0`: done, and no `--fail-on` rule tripped
- `1`: a `--fail-on` rule tripped
- `2`: usage error, or the API refused the request (including the daily free limit)

## Options

| Flag | Meaning |
|---|---|
| `-f, --format <fmt>` | `console`, `json`, `md`, `llm`, `html`, `text` |
| `-o, --output <file>` | Write to a file instead of stdout |
| `--json` | Same as `--format json` |
| `--summary` | Score and counts only |
| `--fail-on <rule>` | See *CI gate* |
| `--baseline <id>` | Diff against an earlier audit (full audit) |
| `--api-key <key>` | Instead of `CRAWLWISE_API_KEY` |
| `--endpoint <origin>` | Default `https://crawlwise.site` (or `CRAWLWISE_ENDPOINT`) |
| `--no-color` | Plain output; `NO_COLOR` is respected too |

## Develop

```bash
node bin/crawlwise.mjs audit https://example.com
npm test        # runs the CLI against a local mock of the API
```

Links: [crawlwise.site](https://crawlwise.site) · [Agents & MCP](https://crawlwise.site/agents) · [REST API](https://crawlwise.site/docs/api) · [Methodology](https://crawlwise.site/methodology)
