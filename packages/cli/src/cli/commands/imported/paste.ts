import { PassThrough } from "node:stream";

const START = "\x1b[200~";
const END = "\x1b[201~";

/** Longest suffix of `s` that is a prefix of `marker` — a paste marker can
 * arrive split across stdin chunks. */
function partialSuffix(s: string, marker: string): string {
  for (let n = Math.min(marker.length - 1, s.length); n > 0; n--) {
    if (marker.startsWith(s.slice(-n))) return s.slice(-n);
  }
  return "";
}

/** Stateful chunk sanitizer for bracketed paste: strips the markers and
 * flattens pasted newlines/tabs to spaces so a multi-line paste lands in the
 * input as ONE line instead of a submit per line. Pure — unit-testable. */
export function makePasteSanitizer(): (chunk: string) => string {
  let inPaste = false;
  let carry = "";
  const clean = (t: string) =>
    t.replace(/\r\n|\r|\n/g, " ").replace(/\t/g, " ");
  return (chunk: string): string => {
    let s = carry + chunk;
    carry = "";
    let out = "";
    while (s.length > 0) {
      if (!inPaste) {
        const i = s.indexOf(START);
        if (i === -1) {
          const tail = partialSuffix(s, START);
          out += s.slice(0, s.length - tail.length);
          carry = tail;
          s = "";
        } else {
          out += s.slice(0, i);
          s = s.slice(i + START.length);
          inPaste = true;
        }
      } else {
        const j = s.indexOf(END);
        if (j === -1) {
          const tail = partialSuffix(s, END);
          out += clean(s.slice(0, s.length - tail.length));
          carry = tail;
          s = "";
        } else {
          out += clean(s.slice(0, j));
          s = s.slice(j + END.length);
          inPaste = false;
        }
      }
    }
    return out;
  };
}

interface PasteFriendlyStdin extends NodeJS.ReadStream {
  cleanup(): void;
}

/**
 * A stdin for Ink that understands bracketed paste. The caller enables mode
 * 2004 on the terminal (which also silences iTerm's multi-line paste warning);
 * this proxy strips the markers and flattens the pasted text before Ink or
 * ink-text-input ever see it.
 */
export function createPasteFriendlyStdin(
  real: NodeJS.ReadStream,
): PasteFriendlyStdin {
  const out = new PassThrough();
  const sanitize = makePasteSanitizer();
  const onData = (buf: Buffer) => {
    const text = sanitize(buf.toString("utf8"));
    if (text) out.write(text);
  };
  real.on("data", onData);

  // biome-ignore lint/suspicious/noExplicitAny: decorating a stream into Ink's expected stdin shape
  const proxy = out as any;
  proxy.isTTY = true;
  proxy.setRawMode = (mode: boolean) => {
    real.setRawMode?.(mode);
    return proxy;
  };
  proxy.ref = () => real.ref?.();
  proxy.unref = () => real.unref?.();
  proxy.cleanup = () => {
    real.off("data", onData);
    real.pause();
  };
  return proxy as PasteFriendlyStdin;
}
