import { theme } from "@/cli/utils/index.js";
import type { StreamEvent } from "@/core/resources/imported/stream.js";

/** One styled terminal line per stream event, editor-transcript style. */
export function renderStreamEvent(event: StreamEvent): string {
  switch (event.kind) {
    case "thinking":
      return theme.styles.dim(`✻ ${event.text}`);
    case "text":
      return event.text;
    case "tool_start": {
      const name = theme.styles.info(event.name);
      return event.summary
        ? `${theme.styles.dim("●")} ${name}  ${theme.styles.dim(event.summary)}`
        : `${theme.styles.dim("●")} ${name}`;
    }
    case "tool_end": {
      const mark = event.ok
        ? theme.styles.dim("  ↳ ok")
        : theme.styles.error("  ↳ failed");
      return event.result ? `${mark} ${theme.styles.dim(event.result)}` : mark;
    }
  }
}
