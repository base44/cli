Deno.serve({ hostname: "127.0.0.1" }, () =>
  Response.json({ shape: "serve(options, handler)" }),
);
