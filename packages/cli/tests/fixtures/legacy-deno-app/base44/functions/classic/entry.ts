Deno.serve((req: Request) =>
  Response.json({
    shape: "serve(handler)",
    secret: Deno.env.get("LEGACY_APP_SECRET") ?? null,
    serviceAuth: req.headers.get("base44-service-authorization") !== null,
  }),
);
