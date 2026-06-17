Deno.serve((req: Request) => {
  return new Response(JSON.stringify({
    authorization: req.headers.get("authorization"),
    serviceAuthorization: req.headers.get("base44-service-authorization"),
  }), {
    headers: { "Content-Type": "application/json" },
  });
});
