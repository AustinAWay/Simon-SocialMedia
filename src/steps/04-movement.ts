/**
 * Step 4 — Movement planning (performance director).
 *
 * For each chunk, Claude writes short VISUAL-ONLY acting cues (expression, gesture, head,
 * energy) that get appended to Simon's base avatar prompt at render time. This is the
 * "how the movement planning works" lever — swap the prompt or the logic here to change
 * Simon's physicality. Cues never contain spoken words (that would corrupt lip-sync).
 */
import { askTool } from "../lib/anthropic.js";
import { loadPrompt } from "../lib/prompts.js";
import type { RunContext } from "../lib/run.js";
import type { Chunk, PerformanceCue } from "../lib/types.js";
import { CLAUDE } from "../config.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cues", "energy"],
  properties: {
    cues: { type: "string", description: "2-4 short visual-only acting sentences, <400 chars, no spoken words." },
    energy: { type: "string", enum: ["calm", "warm", "animated", "punchy"] },
  },
} as const;

export async function planMovement(ctx: RunContext, chunks: Chunk[]): Promise<PerformanceCue[]> {
  const cachePath = "04-performance.json";
  const cached = ctx.readJson<PerformanceCue[]>(cachePath);
  if (cached && !ctx.force.has("movement") && !ctx.force.has("all") && cached.length === chunks.length) {
    ctx.log(`  ↳ [movement] cached: ${cached.length} performance cues`);
    return cached;
  }
  ctx.log(`④ Movement — directing performance for ${chunks.length} beats…`);
  const system = loadPrompt("performance-director");
  const n = chunks.length;
  const out: PerformanceCue[] = [];
  for (const c of chunks) {
    const position = c.index === 0 ? "This is the OPENING HOOK (first beat) — brightest, most inviting." : c.index === n - 1 ? "This is the FINAL beat — land it with calm confidence." : "This is a middle explanation beat.";
    try {
      const res = await askTool<{ cues: string; energy: PerformanceCue["energy"] }>({
        system,
        user: `${position}\n\nNarration for this beat (verbatim):\n"""${c.text}"""`,
        toolName: "submit_performance",
        toolDescription: "Submit the visual-only performance direction for this beat.",
        schema: SCHEMA,
        model: CLAUDE.model,
        temperature: 0.7,
        maxTokens: 600,
      });
      out.push({ index: c.index, cues: res.cues.trim(), energy: res.energy });
    } catch (err) {
      ctx.log(`   ⚠ movement plan failed for chunk ${c.index}, using neutral: ${(err as Error).message}`);
      out.push({ index: c.index, cues: "", energy: "warm" });
    }
  }
  ctx.writeJson(cachePath, out);
  return out;
}
