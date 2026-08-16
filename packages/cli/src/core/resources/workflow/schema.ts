import { z } from "zod";

export const WorkflowRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

const WorkflowListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    status_reason: z.string().nullable().optional(),
    total_runs: z.number().default(0),
    consecutive_failures: z.number().default(0),
    last_run_at: z.string().nullable().optional(),
    last_run_status: z.string().nullable().optional(),
  })
  .transform((data) => ({
    id: data.id,
    name: data.name,
    description: data.description ?? null,
    status: data.status,
    statusReason: data.status_reason ?? null,
    totalRuns: data.total_runs,
    consecutiveFailures: data.consecutive_failures,
    lastRunAt: data.last_run_at ?? null,
    lastRunStatus: data.last_run_status ?? null,
  }));

export const ListWorkflowsResponseSchema = z.array(WorkflowListItemSchema);

export type WorkflowListItem = z.infer<typeof WorkflowListItemSchema>;
export type ListWorkflowsResponse = z.infer<typeof ListWorkflowsResponseSchema>;

const WorkflowRunSchema = z
  .object({
    run_id: z.string(),
    workflow_id: z.string(),
    workflow_name: z.string().default(""),
    trigger_type: z.string().default(""),
    status: z.string(),
    started_at: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    duration_ms: z.number().default(0),
    steps_count: z.number().default(0),
    error_message: z.string().nullable().optional(),
    is_test_run: z.boolean().default(false),
    status_reason: z.string().default(""),
  })
  .transform((data) => ({
    runId: data.run_id,
    workflowId: data.workflow_id,
    workflowName: data.workflow_name,
    triggerType: data.trigger_type,
    status: data.status,
    startedAt: data.started_at ?? null,
    completedAt: data.completed_at ?? null,
    durationMs: data.duration_ms,
    stepsCount: data.steps_count,
    errorMessage: data.error_message ?? null,
    isTestRun: data.is_test_run,
    statusReason: data.status_reason,
  }));

export const ListWorkflowRunsResponseSchema = z.array(WorkflowRunSchema);

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
export type ListWorkflowRunsResponse = z.infer<
  typeof ListWorkflowRunsResponseSchema
>;

export interface WorkflowRunFilters {
  status?: WorkflowRunStatus;
  since?: string;
  limit?: number;
}
