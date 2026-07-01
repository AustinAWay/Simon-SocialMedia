/**
 * Step 2 — Chunk: split the inflected script into TTS/lip-sync chunks.
 *
 * Rules (from the ap-forge chunker, simplified):
 *  - Blank lines are HARD boundaries (never glue across a paragraph break).
 *  - Within a paragraph, pack sentences toward CHUNK.targetSec, splitting when adding the
 *    next sentence would exceed CHUNK.maxSec.
 *  - Estimate duration by wordCount / wordsPerSec.
 *  - Chunks are verbatim slices — concatenating them reproduces the script.
 */
import { CHUNK } from "../config.js";
import type { RunContext } from "../lib/run.js";
import type { Chunk } from "../lib/types.js";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const estSec = (s: string) => words(s) / CHUNK.wordsPerSec;

function splitSentences(paragraph: string): string[] {
  // Split on sentence enders while keeping them; keep ellipses/em-dashes intact.
  const parts = paragraph.match(/[^.!?…]+(?:[.!?…]+(?:["')\]]+)?|$)/g) ?? [paragraph];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function chunkText(script: string): Chunk[] {
  const paragraphs = script.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const raw: string[] = [];

  for (const para of paragraphs) {
    const sentences = splitSentences(para);
    let cur = "";
    for (const sent of sentences) {
      const candidate = cur ? `${cur} ${sent}` : sent;
      if (cur && estSec(candidate) > CHUNK.maxSec) {
        raw.push(cur);
        cur = sent;
      } else {
        cur = candidate;
      }
      // A single very long sentence: hard-split by words to stay under maxSec.
      while (estSec(cur) > CHUNK.maxSec) {
        const w = cur.split(/\s+/);
        const take = Math.max(1, Math.floor(CHUNK.maxSec * CHUNK.wordsPerSec));
        raw.push(w.slice(0, take).join(" "));
        cur = w.slice(take).join(" ");
      }
    }
    if (cur.trim()) raw.push(cur.trim());
  }

  // Merge tiny trailing chunks forward/backward to respect minSec where possible.
  const merged: string[] = [];
  for (const c of raw) {
    if (merged.length > 0 && estSec(c) < CHUNK.minSec) {
      const prev = merged[merged.length - 1]!;
      if (estSec(`${prev} ${c}`) <= CHUNK.maxSec) {
        merged[merged.length - 1] = `${prev} ${c}`;
        continue;
      }
    }
    merged.push(c);
  }

  return merged.map((text, index) => ({ index, text, estSec: +estSec(text).toFixed(2) }));
}

export async function chunk(ctx: RunContext, script: string): Promise<Chunk[]> {
  const existing = ctx.readJson<Chunk[]>("02-chunks.json");
  if (existing && !ctx.force.has("chunk") && !ctx.force.has("all")) {
    ctx.log(`  ↳ [chunk] cached: ${existing.length} chunks`);
    return existing;
  }
  ctx.log("② Chunk — splitting script…");
  const chunks = chunkText(script);
  ctx.writeJson("02-chunks.json", chunks);
  ctx.log(`   ${chunks.length} chunks (est ${chunks.reduce((a, c) => a + c.estSec, 0).toFixed(1)}s total)`);
  return chunks;
}
