import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectPages, pageOfRouteFile } from "@/core/version/pages.js";

// The platform reads the same files into the names an app's SEO settings are
// keyed by; each case here is one of its own, so the two readings agree.
describe("pageOfRouteFile", () => {
  it.each([
    ["index", { path: "/", name: "Home" }],
    ["login", { path: "/login", name: "Login" }],
    ["notes.index", { path: "/notes", name: "Notes" }],
    ["notes.$id", { path: "/notes/:id", name: "NotesId" }],
    ["notes/$id", { path: "/notes/:id", name: "NotesId" }],
    ["notes/route", { path: "/notes", name: "Notes" }],
    ["_dashboard.stats", { path: "/stats", name: "Stats" }],
    ["(marketing).pricing", { path: "/pricing", name: "Pricing" }],
    ["files.$", null],
    ["$", null],
    ["store-admin/$", null],
    ["files.[$]", { path: "/files/$", name: "Files" }],
    ["my-stats", { path: "/my-stats", name: "MyStats" }],
    ["notes.lazy", { path: "/notes", name: "Notes" }],
    ["script[.]js", { path: "/script.js", name: "ScriptJs" }],
    ["[index]", { path: "/index", name: "Index" }],
    ["[_]health", { path: "/_health", name: "Health" }],
    ["_auth/index", { path: "/", name: "Home" }],
    ["_auth.index", { path: "/", name: "Home" }],
    ["notes.-archived", { path: "/notes/-archived", name: "NotesArchived" }],
    ["posts_", { path: "/posts", name: "Posts" }],
    ["posts_.edit", { path: "/posts/edit", name: "PostsEdit" }],
    ["posts_/edit", { path: "/posts/edit", name: "PostsEdit" }],
    ["posts[_]", { path: "/posts_", name: "Posts" }],
    [
      "posts.{-$category}",
      { path: "/posts/:category?", name: "PostsCategory" },
    ],
    ["users.user-{$id}", { path: "/users/:id", name: "UsersId" }],
    ["files.[{$x}]", { path: "/files/{$x}", name: "FilesX" }],
    ["__root", null],
    ["api/time", null],
    ["api.time", null],
    ["_auth", null],
    ["_auth.route", null],
    ["(marketing)", null],
    ["-components/Button", null],
    ["notes/-helpers/format", null],
    ["posts.loader", null],
    ["posts.component", null],
  ])("%s", (file, expected) => {
    expect(pageOfRouteFile(file)).toEqual(expected);
  });
});

describe("collectPages", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "b44-pages-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function write(files: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
  }

  async function routes(files: string[]): Promise<void> {
    await write({
      "src/routeTree.gen.ts": "",
      ...Object.fromEntries(files.map((file) => [`src/routes/${file}`, ""])),
    });
  }

  it("reads nothing when the build left no route tree", async () => {
    await write({ "src/routes/index.jsx": "" });

    expect(await collectPages(root)).toBeNull();
  });

  it("lists the pages home first, each with its route file", async () => {
    await routes(["__root.jsx", "index.jsx", "login.jsx", "notes.$id.jsx"]);

    expect(await collectPages(root)).toEqual([
      { path: "/", name: "Home", file: "src/routes/index.jsx" },
      { path: "/login", name: "Login", file: "src/routes/login.jsx" },
      { path: "/notes/:id", name: "NotesId", file: "src/routes/notes.$id.jsx" },
    ]);
  });

  it("gives distinct pages distinct names, in path order", async () => {
    await routes([
      "__root.jsx",
      "home.jsx",
      "index.jsx",
      "foo-bar.jsx",
      "foo/bar.jsx",
    ]);

    expect((await collectPages(root))?.map((p) => [p.path, p.name])).toEqual([
      ["/", "Home"],
      ["/foo-bar", "FooBar"],
      ["/foo/bar", "FooBar2"],
      ["/home", "Home2"],
    ]);
  });

  it("leaves out a route with server handlers and no component", async () => {
    await routes(["__root.jsx", "index.jsx"]);
    await write({
      "src/routes/robots[.]txt.js":
        'export const Route = createFileRoute("/robots.txt")({\n  server: { handlers: { GET } },\n})',
      "src/routes/contact.jsx":
        'export const Route = createFileRoute("/contact")({\n  server: { handlers: { POST } },\n  component: Contact,\n})',
    });

    expect((await collectPages(root))?.map((p) => p.path)).toEqual([
      "/",
      "/contact",
    ]);
  });

  it("invents no home page for a pathless layout", async () => {
    await routes(["__root.jsx", "_auth.jsx", "_auth.dashboard.jsx"]);

    expect(await collectPages(root)).toEqual([
      {
        path: "/dashboard",
        name: "Dashboard",
        file: "src/routes/_auth.dashboard.jsx",
      },
    ]);
  });

  it("reads JS and TS route modules but not declaration files", async () => {
    await routes(["__root.ts", "index.ts", "about.js", "types.d.ts"]);

    expect((await collectPages(root))?.map((p) => p.path)).toEqual([
      "/",
      "/about",
    ]);
  });

  it("is an empty list for file routes with no page", async () => {
    await routes(["__root.jsx", "api/time.js"]);

    expect(await collectPages(root)).toEqual([]);
  });
});
