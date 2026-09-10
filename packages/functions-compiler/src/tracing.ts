// The compiler emits spans through whatever tracer the host registers. Apper's
// bundler service registers its dd-trace adapter at worker startup; a CLI-local
// build leaves the no-op in place. Keeps dd-trace and its initialization out of
// the compiler's own dependencies.

export interface CompilerTracer {
  withSpan<T>(name: string, fn: () => Promise<T>): Promise<T>;
  setSpanTags(tags: Record<string, string | number | undefined>): Promise<void>;
}

const noopTracer: CompilerTracer = {
  withSpan: (_name, fn) => fn(),
  setSpanTags: async () => {},
};

let tracer: CompilerTracer = noopTracer;

/** Register the host's tracer; `null` restores the no-op. Must be called in the
 *  same thread that runs the compile — spans are process-local. */
export function setCompilerTracer(next: CompilerTracer | null): void {
  tracer = next ?? noopTracer;
}

export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.withSpan(name, fn);
}

export function setSpanTags(
  tags: Record<string, string | number | undefined>,
): Promise<void> {
  return tracer.setSpanTags(tags);
}
