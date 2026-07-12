import { ok } from "../../shared/response.ts";

export function greet(name: string): Response {
  return ok(`Hello, ${name}!`);
}
