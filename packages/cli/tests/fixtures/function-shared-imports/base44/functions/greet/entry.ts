import { ok } from "../../shared/response.ts";
import { SECRET } from "../../../outside/secret.ts";

Deno.serve(async (req: Request) => {
  const { name } = await req.json();
  return ok(`Hello, ${name}! ${SECRET}`);
});
