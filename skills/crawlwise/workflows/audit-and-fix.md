# Audit and fix this page

1. Run the audit:
   - MCP: `estimate_cost` operation=audit, then `audit_page` with the URL. Poll `get_audit` with the `job_id` until `status` is `complete`.
   - CLI: `npx crawlwise audit <url> --format llm` (full report needs `CRAWLWISE_API_KEY`).
2. Read **priority** only. Each fix must cite a real check id from the report.
3. Apply those fixes in the user's repo.
4. Audit again. Confirm the cited checks moved out of priority. Repeat until priority is empty.
5. Do not treat worth_considering or not_measured as defects.
