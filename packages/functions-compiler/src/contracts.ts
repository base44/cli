import { z } from "zod";

const fileMapSchema = z
  .record(z.string().min(1), z.string())
  .refine((files) => Object.keys(files).length > 0, {
    message: "must contain at least one file",
  });

export const bundleRequestSchema = z
  .object({
    entry: z.string().min(1),
    files: fileMapSchema,
    // Backend-evaluated post-response-telemetry flag: bake the
    // detached-work telemetry prelude into the generated Worker entry.
    postResponseTelemetry: z.boolean().optional(),
    // Backend-evaluated runtime-secrets flag: bake the encrypted activation
    // handshake into the generated Worker entry (secrets arrive per isolate
    // instead of as secret_text bindings).
    runtimeSecrets: z.boolean().optional(),
  })
  .refine((body) => body.entry in body.files, {
    message: "`entry` must be a key in `files`",
  });

export const appFunctionSchema = z
  .object({
    name: z.string().min(1),
    entry: z.string().min(1),
    files: fileMapSchema,
  })
  .refine((fn) => fn.entry in fn.files, {
    message: "`entry` must be a key in `files`",
  });

export const bundleAppRequestSchema = z
  .object({
    functions: z.array(appFunctionSchema).min(1),
    postResponseTelemetry: z.boolean().optional(),
    runtimeSecrets: z.boolean().optional(),
  })
  .refine(
    (body) =>
      new Set(body.functions.map((fn) => fn.name)).size ===
      body.functions.length,
    { message: "function names must be unique" },
  );

export type BundleRequest = z.infer<typeof bundleRequestSchema>;
export type AppFunctionInput = z.infer<typeof appFunctionSchema>;
export type BundleAppRequest = z.infer<typeof bundleAppRequestSchema>;
