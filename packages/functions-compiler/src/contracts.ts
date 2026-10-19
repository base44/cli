import { z } from "zod";

const fileMapSchema = z
  .record(z.string().min(1), z.string())
  .refine((files) => Object.keys(files).length > 0, {
    message: "must contain at least one file",
  });

// The function's real stored path, for when `entry` is the name it was
// submitted under (a flat function sent as `main.ts`). Only the source map
// reads it; compilation still uses `entry`.
const entryPathSchema = z.string().min(1).max(200);

export const bundleRequestSchema = z
  .object({
    entry: z.string().min(1),
    files: fileMapSchema,
    entryPath: entryPathSchema.optional(),
    // Backend-evaluated post-response-telemetry flag: bake the
    // detached-work telemetry prelude into the generated Worker entry.
    postResponseTelemetry: z.boolean().optional(),
    // Backend-evaluated runtime-secrets flag: bake the encrypted activation
    // handshake into the generated Worker entry (secrets arrive per isolate
    // instead of as secret_text bindings).
    runtimeSecrets: z.boolean().optional(),
    // Return an external source map whose sources name the app's own files.
    // Off by default; only Base44's bundler service sets it.
    sourceMap: z.boolean().optional(),
    // Bake the handled-5xx `_b44_error` log line into the generated Worker
    // entry (src/error-records.ts). Off by default; only Base44's bundler
    // service sets it.
    errorRecords: z.boolean().optional(),
  })
  .refine((body) => body.entry in body.files, {
    message: "`entry` must be a key in `files`",
  });

export const appFunctionSchema = z
  .object({
    name: z.string().min(1),
    entry: z.string().min(1),
    files: fileMapSchema,
    entryPath: entryPathSchema.optional(),
  })
  .refine((fn) => fn.entry in fn.files, {
    message: "`entry` must be a key in `files`",
  });

export const bundleAppRequestSchema = z
  .object({
    functions: z.array(appFunctionSchema).min(1),
    postResponseTelemetry: z.boolean().optional(),
    runtimeSecrets: z.boolean().optional(),
    sourceMap: z.boolean().optional(),
    errorRecords: z.boolean().optional(),
  })
  .refine(
    (body) =>
      new Set(body.functions.map((fn) => fn.name)).size ===
      body.functions.length,
    { message: "function names must be unique" },
  );

// How a runtime-secrets bundle obtains its data key at runtime. Reported on
// every successful runtime-secrets bundle so the backend knows which shim the
// script it deploys carries; absent for binding-mode bundles.
export const ACTIVATION_MODE = "pull" as const;
export type ActivationMode = typeof ACTIVATION_MODE;

export type BundleRequest = z.infer<typeof bundleRequestSchema>;
export type AppFunctionInput = z.infer<typeof appFunctionSchema>;
export type BundleAppRequest = z.infer<typeof bundleAppRequestSchema>;
