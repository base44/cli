import { reply } from "../../shared/reply.ts";
import { VERSION } from "../../shared/version.ts";
import { helper } from "./helper.ts";

Deno.serve(() => reply({ shape: "shared", version: VERSION, sibling: helper() }));
