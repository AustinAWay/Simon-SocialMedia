/** Step 6 — Concat: normalize + join all Simon clips into one vertical video (video+audio). */
import { concatClips, probeDuration } from "../lib/ffmpeg.js";
import type { RunContext } from "../lib/run.js";
import type { AvatarChunk } from "../lib/types.js";

export async function concat(ctx: RunContext, clips: AvatarChunk[]): Promise<{ rawFile: string; totalSec: number }> {
  const outName = "06-simon-raw.mp4";
  await ctx.cached("concat", outName, async () => {
    ctx.log(`⑥ Concat — joining ${clips.length} clips…`);
    await concatClips(clips.map((c) => ctx.file(c.videoFile)), ctx.file(outName));
  });
  const totalSec = await probeDuration(ctx.file(outName));
  ctx.log(`   raw video: ${totalSec.toFixed(1)}s`);
  return { rawFile: outName, totalSec };
}
