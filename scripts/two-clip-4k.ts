#!/usr/bin/env -S npx tsx
/**
 * Focused one-off: a 2-beat script -> ElevenLabs (Simon/Brooks) audio -> two 15s 4K
 * seedance lip-sync clips -> stitched 30s vertical video. No captions / b-roll / metadata.
 *
 *   tsx scripts/two-clip-4k.ts examples/valeriepieris.md [--slug name] [--duration 15]
 *
 * The script file must contain exactly two blank-line-separated paragraphs (the two beats).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tts, uploadMedia, lipsyncCreate, waitJob, download } from "../src/lib/higgsfield.js";
import { ttsElevenLabs, hasElevenLabsKey } from "../src/lib/elevenlabs.js";
import { ffmpeg, probeDuration, probeSize } from "../src/lib/ffmpeg.js";
import { simonReferencePaths, buildSimonPrompt } from "../src/character/simon.js";
import { PATHS } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(): void {
  const p = path.join(PATHS.repoRoot, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const scriptArg = argv.find((a) => !a.startsWith("--"));
  const slug = (argv[argv.indexOf("--slug") + 1] && argv.includes("--slug")) ? argv[argv.indexOf("--slug") + 1]! : "twoclip-4k";
  const clipDuration = argv.includes("--duration") ? Number(argv[argv.indexOf("--duration") + 1]) : 15;
  const resolution = argv.includes("--resolution") ? argv[argv.indexOf("--resolution") + 1]! : "4k";
  if (!scriptArg) throw new Error("usage: tsx scripts/two-clip-4k.ts <script.md> [--slug x] [--duration 15] [--resolution 4k]");

  const scriptPath = path.resolve(scriptArg);
  const beats = fs.readFileSync(scriptPath, "utf8").split(/\n\s*\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (beats.length !== 2) throw new Error(`expected exactly 2 beats (blank-line separated), got ${beats.length}`);

  const dir = path.join(PATHS.runs, slug);
  fs.mkdirSync(path.join(dir, "audio"), { recursive: true });
  fs.mkdirSync(path.join(dir, "clips"), { recursive: true });
  const log = (m: string) => { console.log(m); fs.appendFileSync(path.join(dir, "run.log"), m + "\n"); };

  log(`\n=== two-clip 4K · ${slug} · ${resolution} · ${clipDuration}s x2 ===`);
  beats.forEach((b, i) => log(`beat ${i}: "${b}"`));

  // 1) TTS per beat — direct ElevenLabs (Simon's exact voice) if a key is set, else Higgsfield Brooks
  const useEl = hasElevenLabsKey();
  log(`\n① TTS (${useEl ? "ElevenLabs direct — Brooks / eleven_v3 / Heimler settings" : "Higgsfield Brooks preset"})…`);
  const audio: { file: string; sec: number }[] = [];
  for (let i = 0; i < beats.length; i++) {
    const file = path.join(dir, "audio", `beat-${i}.mp3`);
    if (!fs.existsSync(file)) await (useEl ? ttsElevenLabs(beats[i]!, file) : tts(beats[i]!, file));
    const sec = await probeDuration(file);
    audio.push({ file, sec });
    log(`   beat ${i}: ${sec.toFixed(2)}s`);
    if (sec > clipDuration + 0.4) log(`   ⚠ beat ${i} audio (${sec.toFixed(2)}s) is longer than the ${clipDuration}s clip — the tail may be cut. Consider trimming the script.`);
  }

  // 2) Upload refs (cached) + audios
  log("\n② Uploading Simon references + audio…");
  const refIds: string[] = [];
  for (const p of simonReferencePaths()) refIds.push((await uploadMedia(p, { cache: true })).id);
  const audioIds: string[] = [];
  for (let i = 0; i < audio.length; i++) audioIds.push((await uploadMedia(audio[i]!.file, { cache: false })).id);

  // 3) Two 4K seedance lip-sync clips, submitted together then awaited concurrently
  log(`\n③ Seedance ${resolution} lip-sync x${beats.length} (concurrent; a few min each)…`);
  const prompt = buildSimonPrompt();
  const clipPaths: string[] = [];
  const jobs: { i: number; id: string; out: string }[] = [];
  for (let i = 0; i < beats.length; i++) {
    const out = path.join(dir, "clips", `clip-${i}.mp4`);
    clipPaths.push(out);
    if (fs.existsSync(out)) { log(`   clip ${i} cached`); continue; }
    const id = await lipsyncCreate({ prompt, imageIds: refIds, audioId: audioIds[i]!, durationSec: clipDuration, resolution });
    jobs.push({ i, id, out });
    log(`   clip ${i}: submitted ${id.slice(0, 8)}`);
  }
  await Promise.all(jobs.map(async (j) => {
    const done = await waitJob(j.id, { timeoutMs: 25 * 60_000, intervalMs: 10_000 });
    await download(done.result_url!, j.out);
    log(`   clip ${j.i}: rendered ✓`);
  }));

  // 4) Stitch at native 4K (concat, re-encoded to clip 0's dimensions/fps)
  log("\n④ Stitching…");
  const { width, height } = await probeSize(clipPaths[0]!);
  for (let i = 0; i < clipPaths.length; i++) log(`   clip ${i}: ${await probeDuration(clipPaths[i]!)}s @ ${width}x${height}`);
  const finalOut = path.join(dir, "final.mp4");
  const inputs: string[] = [];
  const parts: string[] = [];
  const labels: string[] = [];
  clipPaths.forEach((c, i) => {
    inputs.push("-i", c);
    parts.push(`[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30[v${i}]`);
    parts.push(`[${i}:a:0]aresample=48000,asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[v${i}][a${i}]`);
  });
  const filter = `${parts.join(";")};${labels.join("")}concat=n=${clipPaths.length}:v=1:a=1[outv][outa]`;
  await ffmpeg([
    "-y", ...inputs, "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", finalOut,
  ], 20 * 60_000);

  const total = await probeDuration(finalOut);
  log(`\n=== DONE ===`);
  log(`🎬 ${finalOut}  (${total.toFixed(1)}s @ ${width}x${height})`);
}

main().catch((e) => { console.error("\n✗ failed:", e); process.exit(1); });
