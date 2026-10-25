# Local Dev Server

**Keywords:** base44 dev, dev --remote, dev server, front door, private app, login gate, /login, session cookie, access_token, proxy, SSR, full-stack, server functions, createClientFromRequest, Base44-App-Id, Base44-Api-Url, service authorization, HMR, websocket, serveCommand, app dev server

`base44 dev` runs the app's backend locally and, when the project configures
`site.serveCommand`, the app's own dev server next to it. The CLI is the single
origin the user opens — the same shape the platform serves in production.

## The Front Door

One express server (`src/cli/dev/dev-server/main.ts`, port 4400 by default)
answers everything:

- `/api/apps/**` and `/api/app-logs/**` — the platform's own surface: entities,
  functions, auth, media, integrations, app logs, falling back to a proxy to base44.app for what the local server
  does not implement.
- everything else — forwarded to the app's dev server, **including the app's own
  routes under `/api`** (`/api/time` is the app's; `/api/apps/...` is not).

Requests that reach app-owned code carry the SDK header contract, because
`createClientFromRequest` cannot build a client without it
(`src/cli/dev/dev-server/routes/app-server.ts`):

| Header | Value |
| --- | --- |
| `Base44-App-Id` | the linked app's id |
| `Base44-Api-Url` | the front door's own origin, so the app's SDK calls back into it |
| `Base44-Service-Authorization` | a locally minted service-role JWT, so `asServiceRole` works for anonymous visitors |

The visitor's own copies of those headers (and `Base44-State`, `X-Data-Env`,
`Base44-Functions-Version`, `X-Base44-App-Url`) are **dropped before ours are
set** — user code initializes its SDK from them, so a caller-supplied
`Base44-Api-Url` would point that SDK, and the credential travelling with it, at
a host the caller chose. `Authorization` passes through untouched: it is the
visitor the app's server code acts as. Same contract as the platform's
published-worker and sandbox-preview proxies.

Websocket upgrades follow the same split: the entity-events socket keeps
`REALTIME_PATH`, everything else (the app's HMR client) is forwarded.

## `--remote`

`base44 dev --remote` puts the same front door in front of the app dev server
(`src/cli/dev/dev-server/remote-front-door.ts`), but with no local backend: the
platform's paths, and the entity-events socket, are proxied to the live app
(its published URL). The app dev server still gets `Base44-App-Id` and
`Base44-Api-Url`, but no service-role token — the CLI cannot mint one the live
app accepts. Ctrl-C exits the process: the front door lives in it.

## Private and Workspace Apps

A public app handles sign-in itself, so `/login` goes to its dev server like any
other page. A private or workspace app is behind the platform's login in
production, and the CLI stands in for it locally
(`src/cli/dev/dev-server/routes/login-gate.ts`). Whether the app is gated comes
from `visibility` in `config.jsonc` (what deploy applies), else the app's
`public_settings` on the server; an unreachable server means public.

- A page load (`GET`, `Accept: text/html`, outside `/api/` and `/media/`) with no
  session cookie is redirected to `/login?from_url=…`.
- `/login` is the CLI's own page: "Continue as <the CLI's account>". Submitting it
  mints an access token, sets it as the `base44_dev_session` cookie (HttpOnly,
  SameSite=Lax) and redirects to `from_url` with `?access_token=`, which the SDK
  stores — the hosted login's own hand-off. `from_url` must be on the front
  door's origin.
- A request with that cookie and no `Authorization` header gets the cookie's
  token as one, so pages the app renders on the server act as the visitor, as
  the platform's cookie makes them in production.
- The SDK's logout (`/api/apps/auth/logout?from_url=…`) clears the cookie.

The token is the CLI account's identity for that data: locally a JWT for the
account seeded as admin in the local database (`createJwtToken`); under
`--remote`, the account's app-user token from the platform (`auth/token`), so
the app reads and writes the live app's data as that user.

## Finding the App Dev Server

The dev server picks its own port, so `ServeRunner` reads the origin off the
first `http://localhost:<port>` the child announces on startup, stripping ANSI
first (Vite bolds the port). The front door's own port is skipped — the Vite
plugin logs its API proxy target, and taking that for the app's address would
point the front door at itself. Requests that arrive before the announcement
wait for it.

A request that comes back carrying `Base44-Dev-Forwarded` means the app dev
server bounced it instead of serving it — almost always a Vite proxy forwarding
all of `/api` rather than just `/api/apps` and `/api/app-logs`. That answers 508 with the fix rather
than looping.

## Testing

`tests/cli/dev-app-server.spec.ts` drives the real command against the
`with-app-server` fixture, whose `serveCommand` is a node server that announces
a Vite-shaped URL and echoes what each request arrived with, and
`with-private-app-server`, the same app with `"visibility": "private"`, for the
login gate.
