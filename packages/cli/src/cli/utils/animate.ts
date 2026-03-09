import { theme } from "@/cli/utils/theme.js";

/**
 * Sleep for a specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Animate a single line with a left-to-right color reveal.
 */
async function animateLineReveal(
  line: string,
  duration: number,
): Promise<void> {
  const steps = 8;
  const stepDuration = duration / steps;

  for (let step = 0; step <= steps; step++) {
    const progress = step / steps;
    const revealIndex = Math.floor(progress * line.length);

    // Build the line with gradient reveal
    let output = "";
    for (let i = 0; i < line.length; i++) {
      if (i < revealIndex) {
        output += theme.colors.base44Orange(line[i]);
      } else if (i === revealIndex) {
        output += theme.colors.shinyOrange(line[i]);
      } else {
        output += theme.styles.dim(line[i]);
      }
    }

    process.stdout.write(`\r${output}`);
    await sleep(stepDuration);
  }

  // Final state
  process.stdout.write(`\r${theme.colors.base44Orange(line)}\n`);
}

/**
 * Quick shimmer pass over the entire banner.
 */
async function shimmerPass(lines: string[], duration: number): Promise<void> {
  const moveUp = `\x1b[${lines.length}A`;
  const steps = 12;
  const stepDuration = duration / steps;
  const maxWidth = Math.max(...lines.map((l) => l.length));

  for (let step = 0; step <= steps; step++) {
    const shimmerPos = Math.floor((step / steps) * (maxWidth + 6));

    process.stdout.write(moveUp);

    for (const line of lines) {
      let output = "";
      for (let i = 0; i < line.length; i++) {
        const dist = Math.abs(i - shimmerPos);
        if (dist < 3) {
          output +=
            dist === 0
              ? theme.colors.white(line[i])
              : theme.colors.shinyOrange(line[i]);
        } else {
          output += theme.colors.base44Orange(line[i]);
        }
      }
      console.log(output);
    }

    await sleep(stepDuration);
  }

  // Final clean render
  process.stdout.write(moveUp);
  for (const line of lines) {
    console.log(theme.colors.base44Orange(line));
  }
}

/**
 * Animate the output with a smooth line-by-line reveal.
 * Each line fades in with a gradient sweep effect.
 *
 * Total duration: ~1.5 seconds for a magical but not slow feel.
 */
export async function printAnimatedLines(lines: string[]): Promise<void> {
  const totalDuration = 1000; // 1 second total
  const lineDelay = totalDuration / lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Animate this line with a gradient sweep
    await animateLineReveal(line, 100);

    // Small pause between lines for staggered effect
    if (i < lines.length - 1) {
      await sleep(lineDelay - 100);
    }
  }

  // Final shimmer pass
  await shimmerPass(lines, 200);
}
