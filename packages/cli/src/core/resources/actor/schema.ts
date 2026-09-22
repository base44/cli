import { z } from "zod";
import { SchemaValidationError } from "@/core/errors.js";

// Actor names become strict-mode class bindings.
const RESERVED_NAMES = new Set(
  (
    "await break case catch class const continue debugger default delete do else " +
    "enum export extends false finally for function if import in instanceof let " +
    "new null return static super switch this throw true try typeof var void " +
    "while with yield implements interface package private protected public " +
    "eval arguments"
  ).split(" "),
);

export const ActorNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]{0,127}$(?![\s\S])/,
    "Actor names must be JavaScript identifiers of at most 128 characters (letters, digits, and underscores)",
  )
  .refine((name) => !RESERVED_NAMES.has(name), {
    message: "Actor names cannot be JavaScript reserved words",
  });

export function validateActorName(name: string): void {
  const result = ActorNameSchema.safeParse(name);
  if (!result.success) {
    throw new SchemaValidationError(
      `Invalid actor name '${name}'`,
      result.error,
    );
  }
}

const ActorDefinitionSchema = z.object({
  name: ActorNameSchema,
  entry: z.enum(["entry.ts", "entry.js"]),
  entryPath: z.string().min(1),
  filePaths: z.array(z.string()).min(1),
  source: z.object({ type: z.literal("project") }),
});

export const ActorDeployPayloadSchema = z.object({
  entry: z.enum(["entry.ts", "entry.js"]),
  files: z
    .array(z.object({ path: z.string().min(1), content: z.string() }))
    .min(1),
});

export const DeployActorResponseSchema = z.object({
  status: z.enum(["deployed", "unchanged"]),
  warnings: z.array(z.string()).optional().default([]),
});

export const DeleteActorResponseSchema = z
  .object({ status: z.literal("deleted"), handler_name: ActorNameSchema })
  .transform((data) => ({
    status: data.status,
    handlerName: data.handler_name,
  }));

export type ActorDefinition = z.infer<typeof ActorDefinitionSchema>;
export type ActorDeployPayload = z.infer<typeof ActorDeployPayloadSchema>;
export type DeployActorResponse = z.infer<typeof DeployActorResponseSchema>;
export type DeleteActorResponse = z.infer<typeof DeleteActorResponseSchema>;

export interface ActorOperationError {
  name: string;
  status: "error";
  error: string;
  statusCode?: number;
  requestId?: string;
}

export type SingleActorDeployResult =
  | ActorOperationError
  | (DeployActorResponse & { name: string; durationMs: number });

export type SingleActorDeleteResult =
  | ActorOperationError
  | { name: string; status: "deleted" | "not_found" };
