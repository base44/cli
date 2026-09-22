export const CAPTURE_LOGS_HEADER = "X-B44-Capture-Logs";
export const INVOCATION_LOGS_HEADER = "X-B44-Invocation-Logs";

// Budgets are in escaped bytes and stay under the 8 KB the backend accepts for
// this header (INVOCATION_LOGS_MAX_HEADER_BYTES), with room for the function's
// own headers.
export const MAX_CAPTURED_LINES = 40;
const MAX_CAPTURED_BYTES = 6144;
const LINE_ENVELOPE_BYTES = 30;
const RESPONSE_HEADER_BUDGET = 7168;
const HEADER_LINE_OVERHEAD = 4;

// workerd's headers.set throws on any code unit above 0xff, which would silently
// cost the request its logs; escaped text also makes the byte budget exact.
export const ASCII_ESCAPE =
  "const _b44Ascii = (s) => s.replace(/[\\u007f-\\uffff]/g, (c) => '\\\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));";

export const CAPTURE_PATCH = [
  "const _b44Capture = (c, lvl, msg) => {",
  "  if (!c.invocationLogs) return;",
  `  const cost = _b44Ascii(JSON.stringify(msg)).length + ${LINE_ENVELOPE_BYTES};`,
  `  if (c.invocationLogs.length >= ${MAX_CAPTURED_LINES} || c.invocationLogsBytes + cost > ${MAX_CAPTURED_BYTES}) { c.invocationLogsDropped += 1; return; }`,
  "  c.invocationLogsBytes += cost;",
  "  c.invocationLogs.push({ level: lvl, message: msg });",
  "};",
].join("\n");

export const INVOCATION_LOGS_PATCH = [
  `const _b44CaptureStore = (request) => request.headers.get(${JSON.stringify(CAPTURE_LOGS_HEADER)}) === '1' ? { invocationLogs: [], invocationLogsBytes: 0, invocationLogsDropped: 0 } : {};`,
  "const _b44AttachInvocationLogs = (res) => {",
  "  const c = _b44Context();",
  "  if (!c || !c.invocationLogs) return res;",
  "  if (!(res instanceof Response) || res.status === 101 || res.webSocket) return res;",
  `  let existingBytes = ${INVOCATION_LOGS_HEADER.length + HEADER_LINE_OVERHEAD};`,
  `  res.headers.forEach((v, k) => { existingBytes += k.length + v.length + ${HEADER_LINE_OVERHEAD}; });`,
  "  let payload = _b44Ascii(JSON.stringify({ lines: c.invocationLogs, dropped: c.invocationLogsDropped }));",
  `  if (existingBytes + payload.length > ${RESPONSE_HEADER_BUDGET}) payload = JSON.stringify({ lines: [], dropped: c.invocationLogs.length + c.invocationLogsDropped });`,
  `  if (existingBytes + payload.length > ${RESPONSE_HEADER_BUDGET}) return res;`,
  "  let wrapped;",
  "  try { wrapped = new Response(res.body, res); } catch (e) { return res; }",
  `  try { wrapped.headers.set(${JSON.stringify(INVOCATION_LOGS_HEADER)}, payload); } catch (e) {}`,
  "  return wrapped;",
  "};",
  // Same body as the dispatcher's user-exception answer (apps-dispatcher errors.ts:55);
  // the dispatcher strips X-Base44-Cf-Error from user responses (run.ts:73), so this
  // streams as a plain 500 without the dispatch_error metric. Errors the dispatcher
  // classifies by message (errors.ts:41-45) rethrow so their 429 stands.
  "const _b44CrashResponse = (e) => {",
  "  const c = _b44Context();",
  "  if (!c || !c.invocationLogs) return null;",
  "  const m = String(e instanceof Error ? e.message : e).toLowerCase();",
  "  if (m.includes('cpu time limit') || m.includes('too many subrequests')) return null;",
  "  return _b44AttachInvocationLogs(new Response(JSON.stringify({ error: 'user-exception', detail: 'user worker threw an exception' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));",
  "};",
].join("\n");
