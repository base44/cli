import { z } from "zod";

// ─── REQUEST PAYLOADS ───────────────────────────────────────
// Sent to the backend as-is (snake_case). The `app_id` is carried in the URL
// path by getSandboxClient(), so it is never part of these payloads.

export interface ListDirectoryParams {
  path?: string;
  recursive?: boolean;
  max_depth?: number;
  include_hidden?: boolean;
}

export interface ReadFileParams {
  paths: string[];
  offset?: number;
  limit?: number;
}

export interface WriteFileParams {
  path: string;
  content: string;
  overwrite?: boolean;
}

export interface EditSpec {
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}

export interface EditFileParams {
  path: string;
  edits: EditSpec[];
  dry_run?: boolean;
}

export interface GrepParams {
  pattern: string;
  path?: string;
  is_regex?: boolean;
  case_sensitive?: boolean;
  glob?: string;
  max_results?: number;
}

export interface RunCommandParams {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

export interface CreateCheckpointParams {
  name?: string;
}

// ─── RESPONSE SCHEMAS ───────────────────────────────────────
// snake_case → camelCase via .transform(), matching the function/agent resources.

const FileErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const ReadFileEntrySchema = z
  .object({
    path: z.string(),
    content: z.string().optional(),
    start_line: z.number().optional(),
    end_line: z.number().optional(),
    total_lines: z.number().optional(),
    truncated: z.boolean().optional(),
    error: FileErrorSchema.optional(),
  })
  .transform((data) => ({
    path: data.path,
    content: data.content,
    startLine: data.start_line,
    endLine: data.end_line,
    totalLines: data.total_lines,
    truncated: data.truncated,
    error: data.error,
  }));

export const ReadFileResponseSchema = z.object({
  files: z.array(ReadFileEntrySchema),
});
export type ReadFileResponse = z.infer<typeof ReadFileResponseSchema>;

export const WriteFileResponseSchema = z
  .object({
    path: z.string(),
    bytes_written: z.number(),
    created: z.boolean(),
    overwritten: z.boolean(),
  })
  .transform((data) => ({
    path: data.path,
    bytesWritten: data.bytes_written,
    created: data.created,
    overwritten: data.overwritten,
  }));
export type WriteFileResponse = z.infer<typeof WriteFileResponseSchema>;

export const EditFileResponseSchema = z.object({
  path: z.string(),
  diff: z.string(),
  applied: z.boolean(),
});
export type EditFileResponse = z.infer<typeof EditFileResponseSchema>;

const GrepMatchSchema = z.object({
  path: z.string().nullable(),
  line: z.number().nullable(),
  text: z.string(),
});

export const GrepResponseSchema = z
  .object({
    matches: z.array(GrepMatchSchema),
    truncated: z.boolean(),
    returned_matches: z.number(),
  })
  .transform((data) => ({
    matches: data.matches,
    truncated: data.truncated,
    returnedMatches: data.returned_matches,
  }));
export type GrepResponse = z.infer<typeof GrepResponseSchema>;

const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number().optional(),
});

export const ListDirectoryResponseSchema = z.object({
  entries: z.array(DirectoryEntrySchema),
  truncated: z.boolean(),
});
export type ListDirectoryResponse = z.infer<typeof ListDirectoryResponseSchema>;

export const RunCommandResponseSchema = z
  .object({
    stdout: z.string(),
    stderr: z.string(),
    exit_code: z.number(),
    truncated: z.boolean(),
    duration_ms: z.number(),
  })
  .transform((data) => ({
    stdout: data.stdout,
    stderr: data.stderr,
    exitCode: data.exit_code,
    truncated: data.truncated,
    durationMs: data.duration_ms,
  }));
export type RunCommandResponse = z.infer<typeof RunCommandResponseSchema>;

export const CreateCheckpointResponseSchema = z
  .object({
    checkpoint_id: z.string(),
    name: z.string().nullable(),
    git_commit_hash: z.string().nullable(),
  })
  .transform((data) => ({
    checkpointId: data.checkpoint_id,
    name: data.name,
    gitCommitHash: data.git_commit_hash,
  }));
export type CreateCheckpointResponse = z.infer<
  typeof CreateCheckpointResponseSchema
>;
