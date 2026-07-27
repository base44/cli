import { secrets, waitUntil } from "base44:runtime";

export default async function (req: Request): Promise<Response> {
  waitUntil(Promise.resolve("post-response work"));

  let missing: string | null = null;
  try {
    secrets.get("DEFINITELY_NOT_SET");
  } catch (error) {
    missing = (error as Error).message;
  }

  return Response.json({
    method: req.method,
    secret: secrets.get("RUNTIME_API_TEST_SECRET"),
    missing,
  });
}
