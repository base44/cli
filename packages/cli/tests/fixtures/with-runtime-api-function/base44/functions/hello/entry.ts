import { secrets, waitUntil } from "base44:runtime";

export default async function (req: Request): Promise<Response> {
  // `waitUntil` returns the same promise so it composes.
  const composed = await waitUntil(Promise.resolve("post-response work"));

  return Response.json({
    method: req.method,
    secret: secrets.get("RUNTIME_API_TEST_SECRET"),
    // An unset secret reads as undefined rather than throwing, matching the
    // deployed signature. JSON drops undefined, so report it as a string.
    missing: secrets.get("DEFINITELY_NOT_SET") === undefined
      ? "undefined"
      : "unexpected value",
    composed,
  });
}
