import { foo } from "./helper.ts";


Deno.serve(async (req: Request) => {
  const body = await req.json();

  const order = foo(body);

  return new Response(JSON.stringify({ success: true, order: body }));
})
