# Bugbot: Security Review

Scan PR diff for Python security vulnerabilities. Post findings as a PR comment titled **"Security Review"**.

---

## Patterns to Flag

| Category | Look For |
|----------|----------|
| **Auth Bypass** | Missing permission checks in code or via middleware (routers) |
| **IDOR** | User-controlled IDs without ownership verification |
| **Injection** | Raw SQL, unsanitized input in queries, `eval()`, `exec()` |
| **NoSQL Injection** | User input in MongoDB queries, `$where`, `$regex`, unsanitized operators |
| **Path Traversal** | User input in file paths without sanitization |
| **Data Leak** | Secrets/tokens in responses, logs, or URLs |
| **Mass Assignment** | `**request.json()` or `**body` in DB updates |
| **Race Condition** | Check-then-act without atomic ops or locks |
| **Hardcoded Secrets** | API keys, passwords, tokens in code |
| **XSS** | User input rendered in HTML without escaping or sanitization |

> **Note:** This list is not exhaustive. Flag any code pattern that could lead to a security vulnerability, even if not listed above.

---

## Output Format

Post a single comment:

```
## 🔒 Security Review

### Findings

| Severity | File | Issue |
|----------|------|-------|
| 🔴 Critical | `path:line` | Description |
| 🟠 High | `path:line` | Description |
| 🟡 Medium | `path:line` | Description |


---
*No findings* — if nothing detected
```