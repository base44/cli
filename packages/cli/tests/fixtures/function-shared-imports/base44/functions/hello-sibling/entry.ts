import { greet } from "./util.ts";

Deno.serve(async (req: Request) => {
  const { name } = await req.json();
  return Response.json({ message: greet(name) });
});
