/** A user-code problem the bundler can't translate; `file` is attached to the
 *  diagnostic when known. Surfaced to the caller as an `ok:false` compile error. */
export class DenoCompatError extends Error {
  readonly file?: string;
  constructor(message: string, file?: string) {
    super(message);
    this.name = "DenoCompatError";
    this.file = file;
  }
}

/** One flattened compile diagnostic. Shape is part of the HTTP contract — the
 *  Python `BundlerClient` and the builder agent read these fields. */
export interface BundleErrorItem {
  message: string;
  file?: string;
  line?: number;
  column?: number;
  lineText?: string;
  suggestion?: string;
}
