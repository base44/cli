import chalk from "chalk";

/**
 * The Base44 mark, rendered the way `circle.py -d 6 --gap 3.5r --gap-height=0.8r`
 * draws it: an anti-aliased disc built from sub-cell block glyphs, corrected
 * for ~2:1 terminal cells, with one thin slot cut across it. Terminals known to
 * rasterise the Unicode 16 octants get the 2x4 grid; everything else gets the
 * 2x2 quadrant blocks every font has. Fully covered cells are painted as
 * background rather than a block glyph, so fonts whose blocks stop short of the
 * line height don't stripe the fill.
 */
const ROWS = 6;
const ASPECT = 0.44; // cell width / cell height
const SAMPLES = 4; // supersamples per axis on edge pixels
const FILL = 0.6; // coverage that turns a pixel on
// `--gap 3.5r` names row 3.5 and aims at its middle; `--gap-height 0.8r`.
const GAP_ROW = 3.5 + 0.5;
const GAP_HEIGHT_ROWS = 0.8;
export const LOGO_COLS = Math.max(2, Math.floor(ROWS / ASPECT + 0.5));

interface Tier {
  rx: number;
  ry: number;
  /** Sub-cell mask → glyph; bit i = row i / rx, column i % rx. */
  table: string[];
}

// The octant tier as circle.py fits it: the sixteen "quarter" glyphs are not
// in the tier, so their masks are replaced by the nearest drawable shape,
// preferring to drop a pixel over adding one.
const OCTANT: Tier = {
  rx: 2,
  ry: 4,
  table: Array.from(
    "   \u{1FB82}\u{1CD00}\u{2598}\u{1CD01}\u{1CD02}\u{1CD03}\u{1CD04}\u{259D}\u{1CD05}\u{1CD06}\u{1CD07}\u{1CD08}\u{2580}\u{1CD09}\u{1CD0A}\u{1CD0B}\u{1CD0C}\u{1CD00}\u{1CD0D}\u{1CD0E}\u{1CD0F}\u{1CD10}\u{1CD11}\u{1CD12}\u{1CD13}\u{1CD14}\u{1CD15}\u{1CD16}\u{1CD17}\u{1CD18}\u{1CD19}\u{1CD1A}\u{1CD1B}\u{1CD1C}\u{1CD1D}\u{1CD1E}\u{1CD1F}\u{1CD03}\u{1CD20}\u{1CD21}\u{1CD22}\u{1CD23}\u{1CD24}\u{1CD25}\u{1CD26}\u{1CD27}\u{1CD28}\u{1CD29}\u{1CD2A}\u{1CD2B}\u{1CD2C}\u{1CD2D}\u{1CD2E}\u{1CD2F}\u{1CD30}\u{1CD31}\u{1CD32}\u{1CD33}\u{1CD34}\u{1CD35}\u{1FB85} \u{1CD36}\u{1CD37}\u{1CD38}\u{1CD39}\u{1CD3A}\u{1CD3B}\u{1CD3C}\u{1CD3D}\u{1CD3E}\u{1CD3F}\u{1CD40}\u{1CD41}\u{1CD42}\u{1CD43}\u{1CD44}\u{2596}\u{1CD45}\u{1CD46}\u{1CD47}\u{1CD48}\u{258C}\u{1CD49}\u{1CD4A}\u{1CD4B}\u{1CD4C}\u{259E}\u{1CD4D}\u{1CD4E}\u{1CD4F}\u{1CD50}\u{259B}\u{1CD51}\u{1CD52}\u{1CD53}\u{1CD54}\u{1CD55}\u{1CD56}\u{1CD57}\u{1CD58}\u{1CD59}\u{1CD5A}\u{1CD5B}\u{1CD5C}\u{1CD5D}\u{1CD5E}\u{1CD5F}\u{1CD60}\u{1CD61}\u{1CD62}\u{1CD63}\u{1CD64}\u{1CD65}\u{1CD66}\u{1CD67}\u{1CD68}\u{1CD69}\u{1CD6A}\u{1CD6B}\u{1CD6C}\u{1CD6D}\u{1CD6E}\u{1CD6F}\u{1CD70} \u{1CD71}\u{1CD72}\u{1CD73}\u{1CD74}\u{1CD75}\u{1CD76}\u{1CD77}\u{1CD78}\u{1CD79}\u{1CD7A}\u{1CD7B}\u{1CD7C}\u{1CD7D}\u{1CD7E}\u{1CD7F}\u{1CD80}\u{1CD81}\u{1CD82}\u{1CD83}\u{1CD84}\u{1CD85}\u{1CD86}\u{1CD87}\u{1CD88}\u{1CD89}\u{1CD8A}\u{1CD8B}\u{1CD8C}\u{1CD8D}\u{1CD8E}\u{1CD8F}\u{2597}\u{1CD90}\u{1CD91}\u{1CD92}\u{1CD93}\u{259A}\u{1CD94}\u{1CD95}\u{1CD96}\u{1CD97}\u{2590}\u{1CD98}\u{1CD99}\u{1CD9A}\u{1CD9B}\u{259C}\u{1CD9C}\u{1CD9D}\u{1CD9E}\u{1CD9F}\u{1CDA0}\u{1CDA1}\u{1CDA2}\u{1CDA3}\u{1CDA4}\u{1CDA5}\u{1CDA6}\u{1CDA7}\u{1CDA8}\u{1CDA9}\u{1CDAA}\u{1CDAB}\u{2582}\u{1CDAC}\u{1CDAD}\u{1CDAE}\u{1CDAF}\u{1CDB0}\u{1CDB1}\u{1CDB2}\u{1CDB3}\u{1CDB4}\u{1CDB5}\u{1CDB6}\u{1CDB7}\u{1CDB8}\u{1CDB9}\u{1CDBA}\u{1CDBB}\u{1CDBC}\u{1CDBD}\u{1CDBE}\u{1CDBF}\u{1CDC0}\u{1CDC1}\u{1CDC2}\u{1CDC3}\u{1CDC4}\u{1CDC5}\u{1CDC6}\u{1CDC7}\u{1CDC8}\u{1CDC9}\u{1CDCA}\u{1CDCB}\u{1CDCC}\u{1CDCD}\u{1CDCE}\u{1CDCF}\u{1CDD0}\u{1CDD1}\u{1CDD2}\u{1CDD3}\u{1CDD4}\u{1CDD5}\u{1CDD6}\u{1CDD7}\u{1CDD8}\u{1CDD9}\u{1CDDA}\u{2584}\u{1CDDB}\u{1CDDC}\u{1CDDD}\u{1CDDE}\u{2599}\u{1CDDF}\u{1CDE0}\u{1CDE1}\u{1CDE2}\u{259F}\u{1CDE3}\u{2586}\u{1CDE4}\u{1CDE5}\u{2588}",
  ),
};
const QUAD: Tier = {
  rx: 2,
  ry: 2,
  table: Array.from(
    " \u{2598}\u{259D}\u{2580}\u{2596}\u{258C}\u{259E}\u{259B}\u{2597}\u{259A}\u{2590}\u{259C}\u{2584}\u{2599}\u{259F}\u{2588}",
  ),
};

type LogoTier = "octant" | "quad";

/** Same rule as circle.py: only terminals that draw octants themselves. */
function detectTier(env: NodeJS.ProcessEnv = process.env): LogoTier {
  const term = env.TERM ?? "";
  const prog = env.TERM_PROGRAM ?? "";
  if (prog === "ghostty" || term.includes("ghostty")) return "octant";
  if (env.KITTY_WINDOW_ID || term.includes("kitty")) return "octant";
  if (env.WEZTERM_PANE || env.WEZTERM_EXECUTABLE) return "octant";
  if (term.startsWith("foot") || prog === "contour") return "octant";
  return "quad";
}

/** Coverage in [0,1] per pixel. Pixels wholly inside or outside are settled by
 * two corner tests; only the outline is supersampled. */
function coverageGrid(
  rows: number,
  cols: number,
  aspect: number,
  pixelH: number,
): number[][] {
  const worldH = rows * pixelH;
  const worldW = cols * aspect;
  const radius = Math.min(worldH, worldW) / 2;
  const cx = worldW / 2;
  const cy = worldH / 2;
  const step = 1 / SAMPLES;
  const grid: number[][] = [];
  for (let py = 0; py < rows; py++) {
    const y0 = py * pixelH;
    const y1 = y0 + pixelH;
    const dyLo =
      y0 <= cy && cy <= y1 ? 0 : Math.min(Math.abs(y0 - cy), Math.abs(y1 - cy));
    const dyHi = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy));
    const line: number[] = [];
    for (let px = 0; px < cols; px++) {
      const x0 = px * aspect;
      const x1 = x0 + aspect;
      const dxLo =
        x0 <= cx && cx <= x1
          ? 0
          : Math.min(Math.abs(x0 - cx), Math.abs(x1 - cx));
      const dxHi = Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx));
      if (Math.hypot(dxLo, dyLo) >= radius) {
        line.push(0);
        continue;
      }
      if (Math.hypot(dxHi, dyHi) <= radius) {
        line.push(1);
        continue;
      }
      let hits = 0;
      for (let j = 0; j < SAMPLES; j++) {
        const dy = y0 + (j + 0.5) * step * pixelH - cy;
        for (let i = 0; i < SAMPLES; i++) {
          const dx = x0 + (i + 0.5) * step * aspect - cx;
          if (Math.hypot(dx, dy) <= radius) hits++;
        }
      }
      line.push(hits / (SAMPLES * SAMPLES));
    }
    grid.push(line);
  }
  return grid;
}

/** Clear a band of pixel rows; GAP_ROW (text rows) marks the slot's middle, so
 * the same numbers land in the same place whatever the tier's row density. */
function carveGap(grid: number[][], ry: number): void {
  const n = grid.length;
  const thick = Math.max(1, Math.round(GAP_HEIGHT_ROWS * ry));
  const centre = GAP_ROW >= 0 ? GAP_ROW * ry : n + GAP_ROW * ry;
  const start = Math.max(0, Math.min(n - thick, centre - thick / 2));
  for (let i = Math.trunc(start); i < Math.trunc(start + thick); i++) {
    grid[i].fill(0);
  }
}

/** The mark as LOGO_COLS-wide rows. With a colour, glyphs are painted in it and
 * full cells become background-coloured spaces; without, plain glyphs. */
export function logoRows(
  color?: string,
  tier: LogoTier = detectTier(),
): string[] {
  const { rx, ry, table } = tier === "octant" ? OCTANT : QUAD;
  const grid = coverageGrid(ROWS * ry, LOGO_COLS * rx, ASPECT / rx, 1 / ry);
  carveGap(grid, ry);
  const fg = color ? chalk.hex(color) : (s: string) => s;
  const bg = color ? chalk.bgHex(color) : (s: string) => s;
  const full = (1 << (rx * ry)) - 1;
  const out: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let row = "";
    for (let c = 0; c < LOGO_COLS; c++) {
      let mask = 0;
      for (let sr = 0; sr < ry; sr++) {
        for (let sc = 0; sc < rx; sc++) {
          if (grid[r * ry + sr][c * rx + sc] >= FILL)
            mask |= 1 << (sr * rx + sc);
        }
      }
      const glyph = table[mask];
      if (glyph === " ") row += " ";
      else if (mask === full && color) row += bg(" ");
      else row += fg(glyph);
    }
    out.push(row);
  }
  return out;
}
