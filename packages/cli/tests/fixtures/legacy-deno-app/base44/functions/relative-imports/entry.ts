import { reply } from "./reply.ts";
import { VERSION } from "./version.ts";
import { helper } from "./helper.ts";

Deno.serve(() => reply({ shape: "relative", version: VERSION, sibling: helper() }));
