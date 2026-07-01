/**
 * ffmpeg / ffprobe wrappers (self-contained via ffmpeg-static + ffprobe-static — no system
 * install needed). ffmpeg-static ships with libass + freetype + fontconfig, so we can burn
 * ASS karaoke captions and drawtext.
 *
 * Filter recipes are adapted from the ap-forge stitch module (normalize-then-concat,
 * overlay with enable='between(t,a,b)').
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { VIDEO } from "../config.js";

const require = createRequire(import.meta.url);
const FFMPEG: string = require("ffmpeg-static");
const FFPROBE: string = require("ffprobe-static").path;

export function ffmpeg(args: string[], timeoutMs = 15 * 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(`ffmpeg failed:\n${String(stderr).slice(-2000)}`));
        return;
      }
      resolve();
    });
  });
}

function ffprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ffprobe failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}

export async function probeDuration(file: string): Promise<number> {
  const out = await ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
  const n = parseFloat(out);
  if (!isFinite(n)) throw new Error(`could not probe duration of ${file}`);
  return n;
}

export async function probeSize(file: string): Promise<{ width: number; height: number }> {
  const out = await ffprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0", file,
  ]);
  const [w, h] = out.split(",").map((s) => parseInt(s.trim(), 10));
  return { width: w ?? 0, height: h ?? 0 };
}

const CANVAS = `${VIDEO.width}:${VIDEO.height}`;
const scalePad = (label: string, out: string) =>
  `[${label}]scale=${CANVAS}:force_original_aspect_ratio=decrease,pad=${CANVAS}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${VIDEO.fps}[${out}]`;

/** Concat talking-head clips (video+audio) into one normalized vertical mp4. */
export async function concatClips(clips: string[], outPath: string): Promise<void> {
  if (clips.length === 0) throw new Error("concatClips: no clips");
  if (clips.length === 1) {
    // still normalize to canvas
    await ffmpeg([
      "-y", "-i", clips[0]!,
      "-vf", `scale=${CANVAS}:force_original_aspect_ratio=decrease,pad=${CANVAS}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${VIDEO.fps}`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
    ]);
    return;
  }
  const inputs: string[] = [];
  const parts: string[] = [];
  const concatLabels: string[] = [];
  clips.forEach((c, i) => {
    inputs.push("-i", c);
    parts.push(`[${i}:v:0]scale=${CANVAS}:force_original_aspect_ratio=decrease,pad=${CANVAS}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${VIDEO.fps}[v${i}]`);
    parts.push(`[${i}:a:0]aresample=44100,asetpts=PTS-STARTPTS[a${i}]`);
    concatLabels.push(`[v${i}][a${i}]`);
  });
  const filter = `${parts.join(";")};${concatLabels.join("")}concat=n=${clips.length}:v=1:a=1[outv][outa]`;
  await ffmpeg([
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
  ]);
}

export interface Overlay {
  path: string;
  startSec: number;
  endSec: number;
  mode: "card" | "full";
}

/**
 * Composite timed image overlays onto the base video.
 *  - "card": image scaled to ~86% width, placed in the upper area over Simon, with rounded feel via padding.
 *  - "full": image scaled to cover the full 9:16 frame (center-crop) as a cutaway.
 * Uses enable='between(t,a,b)' so each overlay only shows in its window; base shows through otherwise.
 */
export async function overlayImages(base: string, overlays: Overlay[], outPath: string): Promise<void> {
  if (overlays.length === 0) {
    fs.copyFileSync(base, outPath);
    return;
  }
  const inputs: string[] = ["-i", base];
  const pre: string[] = [];
  overlays.forEach((ov, i) => {
    inputs.push("-i", ov.path);
    const idx = i + 1;
    if (ov.mode === "full") {
      pre.push(
        `[${idx}:v]scale=${CANVAS}:force_original_aspect_ratio=increase,crop=${CANVAS},setsar=1[ov${i}]`,
      );
    } else {
      const cardW = Math.round(VIDEO.width * 0.86);
      pre.push(
        `[${idx}:v]scale=${cardW}:-1,setsar=1[ov${i}]`,
      );
    }
  });
  // chain overlays
  let cur = "0:v";
  const chain: string[] = [];
  overlays.forEach((ov, i) => {
    const outLabel = i === overlays.length - 1 ? "vout" : `tmp${i}`;
    const pos = ov.mode === "full"
      ? "0:0"
      : `(W-w)/2:${Math.round(VIDEO.height * 0.09)}`; // card: centered, upper area
    chain.push(`[${cur}][ov${i}]overlay=${pos}:enable='between(t,${ov.startSec.toFixed(3)},${ov.endSec.toFixed(3)})':eof_action=pass[${outLabel}]`);
    cur = outLabel;
  });
  const filter = `${pre.join(";")};${chain.join(";")}`;
  await ffmpeg([
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[vout]", "-map", "0:a:0",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outPath,
  ]);
}

/** Burn ASS captions onto a video. fontsDir lets libass find our bundled font by family name. */
export async function burnCaptions(video: string, assPath: string, fontsDir: string, outPath: string): Promise<void> {
  // Escape path for the subtitles filter.
  const esc = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const vf = `subtitles='${esc(assPath)}':fontsdir='${esc(fontsDir)}'`;
  await ffmpeg([
    "-y", "-i", video,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", outPath,
  ]);
}

/** Extract an image frame at t seconds (for QA / thumbnails). */
export async function extractFrame(video: string, atSec: number, outPath: string): Promise<void> {
  await ffmpeg(["-y", "-ss", atSec.toFixed(2), "-i", video, "-frames:v", "1", "-q:v", "2", outPath]);
}
