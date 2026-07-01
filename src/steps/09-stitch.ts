/** Step 9 — Stitch: composite overlays, then burn captions → final vertical deliverable. */
import fs from "node:fs";
import { overlayImages, burnCaptions, extractFrame } from "../lib/ffmpeg.js";
import { PATHS } from "../config.js";
import type { RunContext } from "../lib/run.js";
import type { Overlay } from "../lib/types.js";

export async function stitch(
  ctx: RunContext,
  rawFile: string,
  overlays: Overlay[],
  assFile: string | null,
): Promise<string> {
  const finalName = "final.mp4";

  // 9a — overlays
  const overlaidName = "09-overlaid.mp4";
  await ctx.cached("stitch-overlay", overlaidName, async () => {
    ctx.log(`⑨ Stitch — compositing ${overlays.length} overlays…`);
    await overlayImages(
      ctx.file(rawFile),
      overlays.map((o) => ({ path: ctx.file(o.imageFile), startSec: o.startSec, endSec: o.endSec, mode: o.mode })),
      ctx.file(overlaidName),
    );
  });

  // 9b — captions
  await ctx.cached("stitch-captions", finalName, async () => {
    if (assFile && fs.existsSync(ctx.file(assFile))) {
      ctx.log("   burning captions…");
      await burnCaptions(ctx.file(overlaidName), ctx.file(assFile), PATHS.fonts, ctx.file(finalName));
    } else {
      fs.copyFileSync(ctx.file(overlaidName), ctx.file(finalName));
    }
  });

  // thumbnail / hook frame for quick QA
  try {
    await extractFrame(ctx.file(finalName), 0.4, ctx.file("thumbnail.png"));
  } catch { /* non-fatal */ }

  ctx.log(`   ✓ final video: ${ctx.file(finalName)}`);
  return finalName;
}
