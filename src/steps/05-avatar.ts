/**
 * Step 5 — Avatar: render Simon lip-syncing each chunk via Higgsfield seedance_2_0 (9:16).
 * References (role:image) + chunk audio (role:audio) + canonical prompt + performance cues.
 * Simon's reference images upload once and are reused across chunks.
 */
import fs from "node:fs";
import { uploadMedia, lipsync } from "../lib/higgsfield.js";
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
  ctx.log(`⑤ Avatar — rendering ${chunks.length} Simon clips at ${resolution} (this takes a few min/clip)…`);

  ctx.log("   uploading Simon reference set…");
  const refIds: string[] = [];
  for (const p of simonReferencePaths()) {
    const up = await uploadMedia(p, { cache: true });
    refIds.push(up.id);
  }

  const cueByIndex = new Map(cues.map((c) => [c.index, c]));
  const out: AvatarChunk[] = [];
  let startSec = 0;
  for (const c of chunks) {
    const videoFile = `avatar/chunk-${String(c.index).padStart(2, "0")}.mp4`;
    const abs = ctx.file(videoFile);
    if (!forced && fs.existsSync(abs)) {
      const videoSec = await probeDuration(abs);
      out.push({ ...c, videoFile, videoSec: +videoSec.toFixed(3), startSec: +startSec.toFixed(3) });
      startSec += videoSec;
      ctx.log(`   [${c.index}] cached (${videoSec.toFixed(2)}s)`);
      continue;
    }
    const audioUp = await uploadMedia(ctx.file(c.audioFile), { cache: false });
    const prompt = buildSimonPrompt(cueByIndex.get(c.index)?.cues);
    const duration = clampDuration(c.audioSec);
    ctx.log(`   [${c.index}] rendering ${duration}s clip…`);
    await lipsync({
      prompt,
      imageIds: refIds,
      audioId: audioUp.id,
      durationSec: duration,
      resolution,
      outPath: abs,
      onTick: (s) => {
        if (s.status && s.status !== "completed") process.stdout.write("");
      },
    });
    const videoSec = await probeDuration(abs);
    out.push({ ...c, videoFile, videoSec: +videoSec.toFixed(3), startSec: +startSec.toFixed(3) });
    startSec += videoSec;
    ctx.log(`   [${c.index}] done (${videoSec.toFixed(2)}s)`);
    // Persist progressively so an interrupted long run keeps finished clips.
    ctx.writeJson(cachePath, out);
  }
  ctx.writeJson(cachePath, out);
  ctx.log(`   avatar total: ${startSec.toFixed(1)}s`);
  return out;
}
