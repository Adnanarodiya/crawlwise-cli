---
name: crawlwise
description: Audit pages, check AI-crawler access, crawl sites, and apply SEO fixes using crawlwise. Use when the user wants SEO, AEO, GEO, schema, robots, or Core Web Vitals work.
---

# crawlwise

SEO tool for agents. Findings are grouped as **priority / worth considering / not measured**. Never invent a check. If a tool says not measured, say so.

## Two ways in

**1. CLI, no setup.** Works without an account:

```
npx crawlwise ai-crawlers https://example.com          # free: can GPTBot, ClaudeBot and the rest read it?
npx crawlwise audit https://example.com --format llm   # free: 1 page a day, score + top issues
```

With `CRAWLWISE_API_KEY` set (Pro and above, key from https://crawlwise.site/account/api), `audit` returns the full report: every finding, evidence, steps and a verify line. Use `--format llm` and read it directly.

**2. MCP server** (Pro and above): `https://crawlwise.site/mcp`

```
claude mcp add --transport http crawlwise https://crawlwise.site/mcp
codex mcp add crawlwise --url https://crawlwise.site/mcp && codex mcp login crawlwise
gemini mcp add crawlwise --transport http https://crawlwise.site/mcp
```

Then complete Allow in the browser. Other clients: https://crawlwise.site/agents. API key fallback: `/account/api`.

## Rules

- Call `estimate_cost` before a paid tool when the user cares about credits.
- After `audit_page`, poll with `get_audit` and that `job_id` until `status` is `complete`.
- Do not guess findings. Fix only what is under **priority**, and cite its check id.
- `worth_considering` and `not_measured` are not defects. Ask before acting on them.

## Workflows

- [audit and fix this page](workflows/audit-and-fix.md)
- [make this site readable by AI search](workflows/ai-search.md)
- [pre-launch SEO check](workflows/pre-launch.md)
