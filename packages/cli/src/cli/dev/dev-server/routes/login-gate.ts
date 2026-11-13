import type { Request, Response } from "express";
import { Router, urlencoded } from "express";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";

const SESSION_COOKIE = "base44_dev_session";
const LOGIN_PATH = "/login";
const LOGOUT_PATH = "/api/apps/auth/logout";

export interface LoginGateOptions {
  /** The Base44 account the developer is signed in to the CLI with. */
  email: string;
  /** Where the app's data comes from, as shown on the sign-in page. */
  dataSource: string;
  /** Mints the access token the app's SDK stores once the developer signs in. */
  mintToken: () => Promise<string>;
}

/**
 * Stands in for the platform's login in front of a private or workspace app:
 * page loads without a session are sent to the CLI's own sign-in page, which
 * hands the app an access token the way the hosted login does
 * (`?access_token=` on the way back) and keeps it in a session cookie. Like the
 * platform's, that cookie identifies the visitor on requests that carry no
 * token of their own, such as page loads the app renders on the server.
 */
export function createLoginGate(
  { email, dataSource, mintToken }: LoginGateOptions,
  logger: DevLogger,
): Router {
  const router = Router();

  router.get(LOGIN_PATH, (req, res) => {
    const fromUrl = sameOriginTarget(req, req.query.from_url).toString();
    res.type("html").send(loginPage(email, dataSource, fromUrl));
  });

  router.post(LOGIN_PATH, urlencoded({ extended: false }), async (req, res) => {
    let token: string;
    try {
      token = await mintToken();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Sign-in failed: ${message}`);
      res.status(502).type("text").send(`Sign-in failed: ${message}`);
      return;
    }
    const target = sameOriginTarget(req, req.body?.from_url);
    target.searchParams.set("access_token", token);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
    );
    res.redirect(303, target.toString());
  });

  router.get(LOGOUT_PATH, (req, res) => {
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    res.redirect(sameOriginTarget(req, req.query.from_url).toString());
  });

  router.use((req, res, next) => {
    const token = sessionToken(req);
    if (!token) {
      if (isPageLoad(req)) {
        redirectToLogin(req, res);
        return;
      }
    } else if (!req.headers.authorization) {
      req.headers.authorization = `Bearer ${token}`;
    }
    next();
  });

  return router;
}

// API and media requests carry their own credentials; only pages are gated.
const UNGATED_PATH_PATTERN = /^\/(api|media)\//;

function isPageLoad(req: Request): boolean {
  return (
    req.method === "GET" &&
    !UNGATED_PATH_PATTERN.test(req.path) &&
    (req.headers.accept ?? "").includes("text/html")
  );
}

function sessionToken(req: Request): string | undefined {
  for (const cookie of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = cookie.trim().split("=");
    if (name === SESSION_COOKIE && value.length > 0) {
      return decodeURIComponent(value.join("=")) || undefined;
    }
  }
  return undefined;
}

function redirectToLogin(req: Request, res: Response): void {
  const login = new URL(LOGIN_PATH, origin(req));
  login.searchParams.set(
    "from_url",
    new URL(req.originalUrl, origin(req)).href,
  );
  res.redirect(login.toString());
}

function origin(req: Request): string {
  return `http://${req.headers.host}`;
}

/** A redirect target on this origin only, so a link cannot send the token elsewhere. */
function sameOriginTarget(req: Request, fromUrl: unknown): URL {
  const base = origin(req);
  if (typeof fromUrl === "string") {
    try {
      const target = new URL(fromUrl, base);
      if (target.origin === base && target.pathname !== LOGIN_PATH) {
        return target;
      }
    } catch {
      // Not a URL: fall through to the app's root.
    }
  }
  return new URL("/", base);
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

function loginPage(email: string, dataSource: string, fromUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { max-width: 22rem; padding: 2rem; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 0.75rem; }
  h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  p { margin: 0 0 1.25rem; line-height: 1.5; opacity: 0.8; }
  button { width: 100%; padding: 0.6rem 1rem; font: inherit; border: 0; border-radius: 0.5rem; background: CanvasText; color: Canvas; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>Sign in to this private app</h1>
  <p>In local development you sign in as the Base44 account the CLI is signed in with. The app uses ${escapeHtml(dataSource)}.</p>
  <form method="post" action="${LOGIN_PATH}">
    <input type="hidden" name="from_url" value="${escapeHtml(fromUrl)}">
    <button type="submit" data-testid="dev-login-continue">Continue as ${escapeHtml(email)}</button>
  </form>
</main>
</body>
</html>`;
}
