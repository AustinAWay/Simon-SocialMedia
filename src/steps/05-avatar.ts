/**
 * Step 5 — Avatar: render Simon lip-syncing each chunk via Higgsfield seedance_2_0 (9:16).
 * References (role:image) + chunk audio (role:audio) + canonical prompt + performance cues.
 *
 * All chunk jobs are SUBMITTED first, then awaited concurrently — Seedance renders take
 * minutes each, so parallel submission cuts wall-clock from sum-of-clips to ~one clip.
 * Simon's reference images upload once and are reused across chunks.
 */
import fs from "node:fs";
import { uploadMedia, lipsyncCreate, waitJob, download } from "../lib/higgsfield.js";
import { probeDuration } from "../lib/ffmpeg.js";
import { simonReferencePaths, buildSimonPrompt } from "../character/simon.js";
import type { RunContext } from "../lib/run.js";
import type { TtsChunk, PerformanceCue, AvatarChunk } from "../lib/types.js";
import { HF } from "../config.js";

const clampDuration = (audioSec: number) =>
  Math.min(HF.avatarMaxDurationSec, Math.max(HF.avatarMinDurationSec, Math.ceil(audioSec)));

export async function renderAvatar(
  ctx: RunContext,
  chunks: TtsChunk[],
  cues: PerformanceCue[],
): Promise<AvatarChunk[]> {
  const cachePath = "05-avatar.json";
  const forced = ctx.force.has("avatar") || ctx.force.has("all");
  const cached = ctx.readJson<AvatarChunk[]>(cachePath);
  if (cached && !forced && cached.length === chunks.length && cached.every((c) => ctx.exists(c.videoFile))) {
    ctx.log(`  ↳ [avatar] cached: ${cached.length} clips`);
    return cached;
  }

  const resolution = ctx.quality; // "720p" (iteration) or "1080p" (final)
  ctx.log(`⑤ Avatar — rendering ${chunks.length} Simon clips at ${resolution} (concurrent; a few min each)…`);

  ctx.log("   uploading Simon reference set…");
  const refIds: string[] = [];
  for (const p of simonReferencePaths()) refIds.push((await uploadMedia(p, { cache: true })).id);

  const cueByIndex = new Map(cues.map((c) => [c.index, c]));

  // Phase 1 — figure out which chunks need rendering; submit their jobs.
  const pending = chunks.filter((c) => {
    const vf = `avatar/chunk-${String(c.index).padStart(2, "0")}.mp4`;
    return forced || !fs.existsSync(ctx.file(vf));
  });
  const jobByIndex = new Map<number, string>();
  for (const c of pending) {
    const audioUp = await uploadMedia(ctx.file(c.audioFile), { cache: false });
    const jobId = await lipsyncCreate({
      prompt: buildSimonPrompt(cueByIndex.get(c.index)?.cues),
      imageIds: refIds,
      audioId: audioUp.id,
      durationSec: clampDuration(c.audioSec),
      resolution,
    });
    jobByIndex.set(c.index, jobId);
    ctx.log(`   [${c.index}] submitted job ${jobId.slice(0, 8)} (${clampDuration(c.audioSec)}s)`);
  }

  // Phase 2 — await + download all concurrently.
  await Promise.all(
    [...jobByIndex.entries()].map(async ([index, jobId]) => {
      const vf = `avatar/chunk-${String(index).padStart(2, "0")}.mp4`;
      const done = await waitJob(jobId, { timeoutMs: 20 * 60_000, intervalMs: 8000 });
      await download(done.result_url!, ctx.file(vf));
      ctx.log(`   [${index}] rendered ✓`);
    }),
  );

  // Phase 3 — probe durations, compute cumulative timeline offsets in chunk order.
  const out: AvatarChunk[] = [];
  let startSec = 0;
  for (const c of chunks) {
    const videoFile = `avatar/chunk-${String(c.index).padStart(2, "0")}.mp4`;
    const videoSec = await probeDuration(ctx.file(videoFile));
    out.push({ ...c, videoFile, videoSec: +videoSec.toFixed(3), startSec: +startSec.toFixed(3) });
    startSec += videoSec;
  }
  ctx.writeJson(cachePath, out);
  ctx.log(`   avatar total: ${startSec.toFixed(1)}s`);
  return out;
}
