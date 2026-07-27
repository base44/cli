// Legacy Deno-convention function that also relies on the project's own
// import map alias. Both must keep working.
import { greeting } from "project-alias/greeting.ts";
import { secrets } from "base44:runtime";

Deno.serve(() =>
  Response.json({
    greeting,
    denoEnv: Deno.env.get("HOME") ? "readable" : "missing",
    runtimeSecrets: typeof secrets.get,
  }),
);
