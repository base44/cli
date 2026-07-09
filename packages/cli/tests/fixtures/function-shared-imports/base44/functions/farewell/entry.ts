import { ok } from "../../shared/response.ts";

Deno.serve(async (req: Request) => {
  const { name } = await req.json();
  return ok(`Goodbye, ${name}!`);
});
