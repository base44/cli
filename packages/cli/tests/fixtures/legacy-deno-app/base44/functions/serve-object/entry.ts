Deno.serve({
  hostname: "127.0.0.1",
  handler: () => Response.json({ shape: "serve({ handler })" }),
});
