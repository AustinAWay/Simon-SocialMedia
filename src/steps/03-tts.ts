/** Step 3 — TTS: synthesize each chunk in Simon's voice (Higgsfield "Brooks" preset). */
import fs from "node:fs";
import { tts } from "../lib/higgsfield.js";
import { ttsElevenLabs, hasElevenLabsKey } from "../lib/elevenlabs.js";
import { probeDuration } from "../lib/ffmpeg.js";
import type { RunContext } from "../lib/run.js";
import type { Chunk, TtsChunk } from "../lib/types.js";
import { HF } from "../config.js";

export async function synthesize(ctx: RunContext, chunks: Chunk[]): Promise<TtsChunk[]> {
  const cachePath = "03-tts.json";
  const cached = ctx.readJson<TtsChunk[]>(cachePath);
  const forced = ctx.force.has("tts") || ctx.force.has("all");
  if (cached && !forced && cached.length === chunks.length && cached.every((c) => ctx.exists(c.audioFile))) {
    ctx.log(`  ↳ [tts] cached: ${cached.length} audio chunks`);
    return cached;
  }

  const useEl = hasElevenLabsKey();
  ctx.log(`③ TTS — synthesizing ${chunks.length} chunks in Simon's voice (${useEl ? "ElevenLabs direct" : "Higgsfield Brooks"})…`);
  const out: TtsChunk[] = [];
  for (const c of chunks) {
    const audioFile = `audio/chunk-${String(c.index).padStart(2, "0")}.mp3`;
    const abs = ctx.file(audioFile);
    if (!forced && fs.existsSync(abs)) {
      const audioSec = await probeDuration(abs);
      out.push({ ...c, audioFile, audioSec: +audioSec.toFixed(3) });
      ctx.log(`   [${c.index}] cached (${audioSec.toFixed(2)}s)`);
      continue;
    }
    await (useEl ? ttsElevenLabs(c.text, abs) : tts(c.text, abs));
    const audioSec = await probeDuration(abs);
    if (audioSec > HF.avatarMaxDurationSec + 1) {
      ctx.log(`   ⚠ chunk ${c.index} audio ${audioSec.toFixed(2)}s exceeds avatar max ${HF.avatarMaxDurationSec}s — consider shorter paragraphs.`);
    }
    out.push({ ...c, audioFile, audioSec: +audioSec.toFixed(3) });
    ctx.log(`   [${c.index}] ${audioSec.toFixed(2)}s  "${c.text.slice(0, 48)}…"`);
  }
  ctx.writeJson(cachePath, out);
  return out;
}
