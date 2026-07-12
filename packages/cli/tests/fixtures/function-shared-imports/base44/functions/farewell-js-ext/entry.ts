import { ok } from "../../shared/response.js";

Deno.serve(async (req: Request) => {
  const { name } = await req.json();
  return ok(`Farewell, ${name}!`);
});
