import { randomUUID } from "node:crypto";
import { createVersion, deployVersion } from "@/core/version/api.js";
import type {
  ArtifactSet,
  CreateVersionProgress,
} from "@/core/version/schema.js";

/**
 * Which of the three steps a publish broke in.
 *
 * A user's build failing, an artifact set the platform refused and a lost
 * publication race are three different incidents with three different
 * responses. Collapsing them into one exit code is how a sandbox log stops
 * being diagnostic, so the step travels with the failure and out through the
 * `--json` envelope.
 */
export type PublishStep = "build" | "create_version" | "deploy";

const STEP = Symbol.for("base44.publishStep");

/** Tag an error with the step it broke in, without wrapping it — the original
 * type, message, status and request id all still reach the envelope. */
export async function tagStep<T>(
  step: PublishStep,
  run: () => Promise<T>,
): Promise<T> {
  try {
    // Awaited inside the try so a callback that throws SYNCHRONOUSLY is tagged
    // too — `run().catch(...)` would let that one escape untagged.
    return await run();
  } catch (error) {
    if (error !== null && typeof error === "object" && !(STEP in error)) {
      Object.defineProperty(error, STEP, { value: step, enumerable: false });
    }
    throw error;
  }
}

export function stepOf(error: unknown): PublishStep | undefined {
  return error !== null && typeof error === "object" && STEP in error
    ? (error as Record<symbol, PublishStep>)[STEP]
    : undefined;
}

export interface PublishResult {
  versionId: string;
  manifestHash: string;
  deduplicated: boolean;
  deploymentId: string;
  revision: number;
}

/**
 * Record the artifact set as a version and serve it.
 *
 * The deploy carries a key generated once here, so a lost response is resolved
 * by reading back the deployment this call already made rather than preparing a
 * second candidate.
 */
export async function publishVersion(
  artifacts: ArtifactSet,
  options: {
    sourceCommit?: string;
    target?: string;
    concurrency?: number;
    progress?: CreateVersionProgress;
  } = {},
): Promise<PublishResult> {
  const version = await tagStep("create_version", () =>
    createVersion(artifacts, {
      sourceCommit: options.sourceCommit,
      concurrency: options.concurrency,
      progress: options.progress,
    }),
  );
  const deployment = await tagStep("deploy", () =>
    deployVersion(version.versionId, {
      target: options.target,
      idempotencyKey: randomUUID(),
    }),
  );
  return { ...version, ...deployment };
}
