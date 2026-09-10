/**
 * Post-response detached-work telemetry for generated Worker entries — a
 * usage gauge for fetches that outlive the handler's Response
 * (docs/features/post-response-telemetry.md). workerd cancels such fetches
 * (Deno Deploy tolerated them), so the Deno→CFW migration breaks apps that
 * rely on the pattern.
 *
 * When the bundle request carries `postResponseTelemetry: true` (backend
 * evaluates the app-keyed `post-response-telemetry` flag at deploy time),
 * the entry templates append this prelude and route the handler's response
 * through `_b44AttachTelemetry`. Flag off appends nothing — the generated
 * entry stays byte-identical to the pre-telemetry prod baseline.
 *
 * A request that returns with fetches pending logs one `inflight_at_response`
 * line (through the console patch, so it carries function attribution) naming
 * the target origins (refcounted, cap 10) and mirrors it onto the
 * `X-B44-Post-Response-Telemetry` response header; the platform proxy relays
 * that to Datadog and strips it before the client. Every observed fetch also
 * rides ctx.waitUntil platform-side, so pending fetches complete (bounded by
 * the waitUntil budget) instead of being cancelled, keeping the detached
 * chain alive — its follow-up fetches log `fetch_started_post_response`
 * without user code ever calling Base44.waitUntil. Clean traffic emits
 * nothing and carries no header.
 *
 * Must be self-contained JS (no imports) — inlined into the generated entry
 * after CONSOLE_PATCH. The entry provides `_b44Context` and the patched console.
 */
export const TELEMETRY_PATCH = [
  "const _b44Tele = (c, event, fields) => {",
  "  if (!(c.logBudget > 0)) return;",
  "  c.logBudget -= 1;",
  "  try { console.log(JSON.stringify({ b44_telemetry: 'post_response_work', event, request_id: c.reqId, ...fields })); } catch (e) {}",
  "};",
  // origin only — both query strings and paths can carry secrets (Slack
  // webhook URLs, Telegram bot tokens); the census only needs the host.
  "const _b44Target = (input) => { try { const u = typeof input === 'string' ? new URL(input) : (input instanceof URL ? input : new URL(input.url)); return u.origin; } catch (e) { return 'unknown'; } };",
  "const _b44OrigFetch = globalThis.fetch.bind(globalThis);",
  "globalThis.fetch = (input, init) => {",
  "  const c = _b44Context();",
  "  if (!c || c.respondedAt === undefined) return _b44OrigFetch(input, init);",
  "  const t = _b44Target(input);",
  "  if (c.respondedAt !== null) _b44Tele(c, 'fetch_started_post_response', { target: t, ms_after_response: Date.now() - c.respondedAt });",
  // Refcounted (cap 10 distinct): same-target siblings must not lose the
  // target when the first settles.
  "  const tracked = c.inflight.has(t) || c.inflight.size < 10;",
  "  if (tracked) c.inflight.set(t, (c.inflight.get(t) ?? 0) + 1);",
  "  c.inflightTotal += 1;",
  "  const done = () => { c.inflightTotal -= 1; if (tracked) { const n = c.inflight.get(t); if (n !== undefined) { if (n <= 1) c.inflight.delete(t); else c.inflight.set(t, n - 1); } } };",
  // Ride ctx.waitUntil on every observed fetch (platform-side — user code
  // needs no Base44.waitUntil): workerd then keeps the request context alive
  // until the fetch settles, so a fetch pending at response completes instead
  // of being cancelled, and follow-up fetches in the detached chain run and
  // get logged. Bounded by Cloudflare's waitUntil budget; a no-op for fetches
  // that settle in-request.
  // Fail-fast discriminators: a pre-response rejection, or a pre-response
  // non-ok resolution (an SDK/helper throws on !res.ok and the rejection
  // fail-fasts Promise.all), marks the request as likely orphaning fallout
  // rather than deliberate fire-and-forget — which has neither.
  "  const failed = () => { if (c.respondedAt === null) c.hadRejection = true; done(); };",
  "  const settled = (res) => { if (c.respondedAt === null && res && res.ok === false) c.hadNonOk = true; done(); };",
  "  try { const p = _b44OrigFetch(input, init); p.then(settled, failed); if (c.waitUntil) { try { c.waitUntil(p.then(() => {}, () => {})); } catch (e) {} } return p; } catch (e) { failed(); throw e; }",
  "};",
  "const _b44AttachTelemetry = (res) => {",
  "  const c = _b44Context();",
  "  if (!c || c.respondedAt === undefined) return res;",
  "  c.respondedAt = Date.now();",
  // Upgrade responses can't be reconstructed; a live socket's fetches
  // aren't post-response work anyway.
  "  if (c.inflightTotal <= 0 || res.status === 101 || res.webSocket) return res;",
  "  const pending = { request_id: c.reqId, inflight: c.inflightTotal, targets: [...c.inflight.keys()], rejected_pre_response: c.hadRejection, non_ok_pre_response: c.hadNonOk };",
  "  _b44Tele(c, 'inflight_at_response', pending);",
  // Once the wrap exists the original body stream is transferred — always
  // return the wrap then; fall back to res only if construction itself threw.
  "  let wrapped;",
  "  try { wrapped = new Response(res.body, res); } catch (e) { return res; }",
  "  try { wrapped.headers.set('X-B44-Post-Response-Telemetry', JSON.stringify({ pending })); } catch (e) {}",
  "  return wrapped;",
  "};",
].join("\n");

/** Request-store fields the flag-ON entry seeds. Flag-OFF entries omit them
 *  and every telemetry call site — control must stay byte-identical to the
 *  pre-telemetry prod entry. */
export const TELEMETRY_STORE_FIELDS =
  "reqId: crypto.randomUUID(), respondedAt: null, inflight: new Map(), inflightTotal: 0, hadRejection: false, hadNonOk: false, logBudget: 5";
