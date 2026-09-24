import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { LOGO_COLS, logoRows } from "@/cli/commands/code/logo.js";

// The exact rows `circle.py -d 6 --gap 3.5r --gap-height=0.8r --no-color` prints
// on an octant-capable terminal (--style octant) …
const OCTANT = [
  "  \u{2582}\u{2584}\u{2586}\u{2588}\u{2588}\u{2588}\u{2588}\u{2586}\u{2584}\u{2582}  ",
  " \u{259F}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2599} ",
  "\u{1CDD5}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{1CDC0}",
  "\u{1CD05}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{1CD02}",
  " \u{1CD99}\u{2586}\u{2586}\u{2586}\u{2586}\u{2586}\u{2586}\u{2586}\u{2586}\u{2586}\u{2586}\u{1CD4E} ",
  "  \u{1FB82}\u{2580}\u{1FB85}\u{2588}\u{2588}\u{2588}\u{2588}\u{1FB85}\u{2580}\u{1FB82}  ",
];

// … and everywhere else (--style quad).
const QUAD = [
  "  \u{2597}\u{2584}\u{259F}\u{2588}\u{2588}\u{2588}\u{2588}\u{2599}\u{2584}\u{2596}  ",
  " \u{259F}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2599} ",
  "\u{2590}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{2588}\u{258C}",
  "\u{259D}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2580}\u{2598}",
  " \u{2597}\u{2584}\u{2584}\u{2584}\u{2584}\u{2584}\u{2584}\u{2584}\u{2584}\u{2584}\u{2584}\u{2596} ",
  "  \u{259D}\u{2580}\u{259C}\u{2588}\u{2588}\u{2588}\u{2588}\u{259B}\u{2580}\u{2598}  ",
];

describe("logo", () => {
  it("renders the circle.py mark glyph for glyph (octant tier)", () => {
    expect(logoRows(undefined, "octant")).toEqual(OCTANT);
  });

  it("renders the circle.py mark glyph for glyph (quad tier)", () => {
    expect(logoRows(undefined, "quad")).toEqual(QUAD);
  });

  it("keeps every coloured row LOGO_COLS cells wide", () => {
    for (const row of logoRows("#E86B3C")) {
      const visible = Array.from(stripAnsi(row));
      expect(visible).toHaveLength(LOGO_COLS);
    }
  });
});
