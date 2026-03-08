# Error Report Summary (last 5 days)

Fetch the last 5 days of error-report issues from the Base44 CLI GitHub repo, produce a summary report with Mermaid graphs, action items, and evaluation. Output is written to `error-reports/` (gitignored).

## Instructions

### 1. Compute the date range

- "Last 5 days" = from today backward (e.g. today 2026-03-08 → `created:>=2026-03-03`).
- On macOS: `date -v-5d +%Y-%m-%d`. On Linux: `date -d '5 days ago' +%Y-%m-%d`.

### 2. Fetch issues with GitHub CLI only

- List issues:
  ```bash
  gh issue list --repo base44/cli --label "error-report" --state all --search "created:>=YYYY-MM-DD" --limit 20
  ```
- For each issue number in the list, fetch the full body:
  ```bash
  gh issue view <number> --repo base44/cli --json title,number,state,createdAt,body
  ```
- Use only the `gh` CLI; no direct GitHub API calls.

### 3. Read and understand each issue

- For each issue: command, error message, stack trace, environment (OS, command), and whether it is a CLI bug, backend issue, or user error (working as designed).

### 4. Ensure report directory is gitignored

- If `error-reports/` is not in `.gitignore`, add:
  ```text
  # Error report summaries (generated, do not commit)
  error-reports/
  ```
- Create the directory if needed: `mkdir -p error-reports`.

### 5. Write the report

Write to `error-reports/last-5-days-summary.md` (or `error-reports/YYYY-MM-DD-summary.md` for a date-stamped name) with:

1. **Meta** — Run date, "last 5 days" window, total issue count, table of issues (title, link, created date, state).
2. **Graphs (Mermaid)** — Embed in the same file:
   - **Total errors over time:** Bar or xychart with X = date (by day), Y = number of errors. Use each report’s "Total errors" and the report date from the issue title.
   - **Errors by type:** Pie or bar of count per type. Derive type from issue body (e.g. auth, deploy, backend 428, config not found, timeout, user validation).
   - **Top N per-error:** Bar chart of the top 5–10 recurring error patterns (normalize issue titles or first error line; group and count).
3. **Per-issue summary** — Short description of what failed, root cause if evident, 1–2 bullets per issue.
4. **Main action items** — Grouped by theme (auth, deploy, entities, config, telemetry, UX). Concrete next steps with file/line references where applicable.
5. **What else to evaluate** — Trends (same error across reports), gaps (missing context, unclear reproduction), suggestions (telemetry, docs, CLI UX).

### 6. Reply to the user

- Give a short summary (e.g. how many issues, main themes) and the path to the report file.

## Output

- Report path: `error-reports/last-5-days-summary.md` (or date-stamped equivalent).
- All charts are Mermaid code blocks so they render in GitHub and Cursor.
