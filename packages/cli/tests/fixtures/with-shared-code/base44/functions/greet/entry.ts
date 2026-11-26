import { GREETING } from "../../shared/greeting.ts";

Deno.serve(() => Response.json({ greeting: GREETING }));
