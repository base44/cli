/**
 * One `_b44_error` log line for a handled 5xx, for the Production Agent.
 *
 * A function that catches its own error and returns a 500 leaves Cloudflare
 * nothing to record: no exception reaches the runtime, so the Tail Worker sees
 * a status and no reason. Every generated entry (single-function and per-app;
 * not actors) appends this prelude and routes the handler's response through
 * `_b44RecordError`, with no build flag: an app is ready the moment it opts in,
 * whatever compiled it.
 *
 * The off switch is the request, not the build: it does nothing unless the
 * request carries `x-b44-feed-context`, which the backend sends only for
 * production calls of apps that opted in while its tail switch is on;
 * presence is enough. For a `Response` with status >= 500 it returns that same
 * response at once — never rebuilt, never delayed, no header set — and inside
 * `ctx.waitUntil` (a line logged there still belongs to the invocation's tail
 * event) picks a message:
 *
 *   1. an Error logged during this request whose message the JSON body repeats
 *      (the newest such, among the last 8 logged);
 *   2. otherwise the body: JSON of at most 2,048 bytes read within 50 ms, first
 *      non-empty string among `error`, `message`, `detail`, `details` and
 *      `error.message` — skipping `error` when it is exactly
 *      "Internal server error" and `details` is present (the SSO examples);
 *   3. otherwise the last Error logged during this request (with a message).
 *
 * The stack comes only from the logged Error that supplied the message, and is
 * minified: Cloudflare remaps the exceptions it captures, never a stack string
 * logged from inside the Worker, so a consumer remaps it with the version's
 * `source_map`. Every
 * env-binding and runtime-secret string of 8+ characters (and the strings
 * nested in JSON-valued ones, such as the private-data-sources manifest) is
 * replaced with `[redacted]`, longest first, before anything is cut. Then it logs
 * one `{ _b44_error: { v: 1, kind: "response", status, name?, message, stack? } }`
 * through the console patch, so the line carries function attribution. Any
 * failure writes nothing and never reaches the request.
 *
 * Must be self-contained JS (no imports) — inlined into the generated entry
 * after CONSOLE_PATCH. The entry provides `_b44Context` and the patched console.
 */

/** The request header that turns recording on. */
const FEED_CONTEXT_HEADER = "x-b44-feed-context";

const ERROR_RECORD_LIMITS = {
  bodyBytes: 2048,
  bodyDeadlineMs: 50,
  nameChars: 64,
  messageBytes: 500,
  stackBytes: 4096,
  minSecretChars: 8,
  loggedErrors: 8,
} as const;

const L = ERROR_RECORD_LIMITS;

export const ERROR_RECORDS_PATCH = [
  `const _b44ErrorStore = (request) => request.headers.has(${JSON.stringify(FEED_CONTEXT_HEADER)}) ? { errorRecord: { logged: [] } } : {};`,
  // The last few Errors passed to any console method during the request,
  // oldest first, each read once at log time (a later mutation of the Error
  // must not change the record). More than one: a handler that logs the real
  // failure and then an unrelated warning must still match the first.
  "const _b44NoteError = (a) => {",
  "  const c = _b44Context();",
  "  if (!c || !c.errorRecord) return;",
  "  for (const x of a) {",
  "    if (!(x instanceof Error)) continue;",
  "    const r = (k) => { try { const v = x[k]; return typeof v === 'string' ? v : undefined; } catch (e) { return undefined; } };",
  "    const logged = c.errorRecord.logged;",
  "    logged.push({ name: r('name'), message: r('message'), stack: r('stack') });",
  `    if (logged.length > ${L.loggedErrors}) logged.shift();`,
  "  }",
  "};",
  "for (const _l of ['log', 'info', 'warn', 'error', 'debug']) { const _f = console[_l]; console[_l] = (...a) => { try { _b44NoteError(a); } catch (e) {} return _f(...a); }; }",
  // JSON body of the clone: undefined when absent, too large, too slow or not JSON.
  "const _b44ReadJson = async (res) => {",
  "  if (!res.body) return undefined;",
  "  const reader = res.body.getReader();",
  "  const chunks = [];",
  "  let size = 0;",
  "  let timer;",
  `  const deadline = new Promise((r) => { timer = setTimeout(() => r(null), ${L.bodyDeadlineMs}); });`,
  "  try {",
  "    for (;;) {",
  "      const step = await Promise.race([reader.read(), deadline]);",
  "      if (step === null) return undefined;",
  "      if (step.done) break;",
  "      size += step.value.byteLength;",
  `      if (size > ${L.bodyBytes}) return undefined;`,
  "      chunks.push(step.value);",
  "    }",
  "  } finally {",
  "    clearTimeout(timer);",
  "    try { reader.cancel().catch(() => {}); } catch (e) {}",
  "  }",
  "  const buf = new Uint8Array(size);",
  "  let o = 0;",
  "  for (const ch of chunks) { buf.set(ch, o); o += ch.byteLength; }",
  "  try { return JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return undefined; }",
  "};",
  "const _b44HasString = (v, s, d = 0) => {",
  "  if (v === s) return true;",
  "  if (d > 16 || !v || typeof v !== 'object') return false;",
  "  for (const k of Object.keys(v)) if (_b44HasString(v[k], s, d + 1)) return true;",
  "  return false;",
  "};",
  "const _b44BodyMessage = (b) => {",
  "  if (!b || typeof b !== 'object' || Array.isArray(b)) return undefined;",
  "  const s = (v) => (typeof v === 'string' && v.trim() !== '' ? v : undefined);",
  "  const skipError = Object.prototype.hasOwnProperty.call(b, 'details') && b.error === 'Internal server error';",
  "  const nested = b.error && typeof b.error === 'object' ? b.error.message : undefined;",
  "  return (skipError ? undefined : s(b.error)) ?? s(b.message) ?? s(b.detail) ?? s(b.details) ?? s(nested);",
  "};",
  // Bindings are objects (KV, service, Hyperdrive); only strings and the
  // values nested in JSON-valued strings are candidates.
  "const _b44SecretValues = (c) => {",
  "  const out = new Set();",
  "  let budget = 10000;",
  "  const add = (v, d) => {",
  "    if (--budget < 0) return;",
  "    if (typeof v === 'string') {",
  `      if (v.length >= ${L.minSecretChars}) out.add(v);`,
  // JSON.parse accepts leading whitespace, so the detection must too; the
  // original string stays a candidate either way.
  "      const t = v.trimStart();",
  "      if (d < 2 && (t[0] === '{' || t[0] === '[')) { try { add(JSON.parse(v), d + 1); } catch (e) {} }",
  "    } else if (d > 0 && d < 16 && v && typeof v === 'object') {",
  "      for (const k of Object.keys(v)) add(v[k], d + 1);",
  "    }",
  "  };",
  "  for (const src of [c.secrets, c.workerEnv]) {",
  "    if (!src || typeof src !== 'object') continue;",
  "    for (const k of Object.keys(src)) { try { add(src[k], 0); } catch (e) {} }",
  "  }",
  "  return [...out].sort((x, y) => y.length - x.length);",
  "};",
  "const _b44Scrub = (s, secrets) => { let out = s; for (const v of secrets) if (out.includes(v)) out = out.split(v).join('[redacted]'); return out; };",
  "const _b44Well = (s) => (typeof s.toWellFormed === 'function' ? s.toWellFormed() : s);",
  "const _b44Bytes = (s) => new TextEncoder().encode(s).length;",
  "const _b44CutBytes = (s, max) => {",
  "  if (_b44Bytes(s) <= max) return s;",
  "  let n = 0;",
  "  let out = '';",
  "  for (const ch of s) {",
  "    const cp = ch.codePointAt(0);",
  "    const b = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;",
  "    if (n + b > max) break;",
  "    n += b;",
  "    out += ch;",
  "  }",
  "  return out;",
  "};",
  "const _b44CutLines = (s, max) => {",
  "  if (_b44Bytes(s) <= max) return s;",
  "  let n = 0;",
  "  let out = '';",
  "  for (const line of s.split('\\n')) {",
  "    const b = _b44Bytes(line) + (out ? 1 : 0);",
  "    if (n + b > max) break;",
  "    out += (out ? '\\n' : '') + line;",
  "    n += b;",
  "  }",
  "  return out;",
  "};",
  // `logged` is the request's Errors at response time, oldest first.
  "const _b44WriteErrorRecord = async (c, status, copy, logged) => {",
  "  try {",
  "    const body = await _b44ReadJson(copy);",
  "    const usable = logged.filter((e) => e.message);",
  "    let chosen;",
  "    if (body !== undefined) {",
  "      for (let i = usable.length - 1; i >= 0; i--) if (_b44HasString(body, usable[i].message)) { chosen = usable[i]; break; }",
  "    }",
  "    let message = chosen ? chosen.message : _b44BodyMessage(body);",
  "    if (message === undefined && usable.length > 0) { chosen = usable[usable.length - 1]; message = chosen.message; }",
  "    if (message === undefined) return;",
  "    const secrets = _b44SecretValues(c);",
  "    const clean = (s) => _b44Well(_b44Scrub(s, secrets));",
  "    const rec = { v: 1, kind: 'response', status };",
  `    const name = chosen && chosen.name ? Array.from(clean(chosen.name)).slice(0, ${L.nameChars}).join('') : '';`,
  "    if (name) rec.name = name;",
  `    rec.message = _b44CutBytes(clean(message), ${L.messageBytes});`,
  `    const stack = chosen && chosen.stack ? _b44CutLines(clean(chosen.stack), ${L.stackBytes}) : '';`,
  "    if (stack) rec.stack = stack;",
  "    console.error({ _b44_error: rec });",
  "  } catch (e) {}",
  "};",
  // Returns `res` itself in every path; the work rides waitUntil on a clone.
  "const _b44RecordError = (res) => {",
  "  try {",
  "    const c = _b44Context();",
  "    if (!c || !c.errorRecord || !c.waitUntil || !(res instanceof Response) || !(res.status >= 500)) return res;",
  "    c.waitUntil(_b44WriteErrorRecord(c, res.status, res.clone(), c.errorRecord.logged.slice()));",
  "  } catch (e) {}",
  "  return res;",
  "};",
].join("\n");
