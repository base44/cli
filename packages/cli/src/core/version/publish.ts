import { randomUUID } from "node:crypto";
import { createVersion, setEnvironmentVersion } from "@/core/version/api.js";
import type {
  ArtifactSet,
  CreateVersionProgress,
} from "@/core/version/schema.js";

/**
 * Which of the three steps a publish broke in. A failed build, a rejected
 * artifact set and a lost publication race need three different responses, so
 * the step travels with the failure and out through the `--json` envelope.
 */
type PublishStep = "build" | "create_version" | "deploy";

const STEP = Symbol.for("base44.publishStep");

/** The environment a publish points at unless told otherwise. */
export const DEFAULT_ENVIRONMENT = "production";

/** Tag an error with its step without wrapping it, so the original type,
 * status and request id still reach the envelope. */
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

interface PublishResult {
  environment: string;
  versionId: string;
  manifestHash: string;
  deploymentId: string;
}

/**
 * Record the artifact set as a version and serve it. The deploy key is generated
 * once here, so a lost response reads back the deployment this call already made.
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
  const environment = await tagStep("deploy", () =>
    setEnvironmentVersion(
      options.target ?? DEFAULT_ENVIRONMENT,
      version.versionId,
      {
        idempotencyKey: randomUUID(),
      },
    ),
  );
  return {
    environment: environment.name,
    versionId: environment.versionId,
    manifestHash: environment.manifestHash,
    deploymentId: environment.deploymentId,
  };
}
