/** Step 1 — Inflect: speech-normalize the raw script for TTS. Words stay verbatim. */
import fs from "node:fs";
import { ask } from "../lib/anthropic.js";
import { loadPrompt } from "../lib/prompts.js";
import type { RunContext } from "../lib/run.js";
import { CLAUDE } from "../config.js";

export async function inflect(ctx: RunContext): Promise<string> {
  const outName = "01-inflected.txt";
  await ctx.cached("inflect", outName, async () => {
    ctx.log("① Inflect — speech-normalizing script…");
    const raw = fs.readFileSync(ctx.scriptPath, "utf8").trim();
    const cleaned = await ask({
      system: loadPrompt("inflect"),
      user: raw,
      model: CLAUDE.model,
      temperature: 0.2,
    });
    // Defensive: never let the model return empty; fall back to raw.
    fs.writeFileSync(ctx.file(outName), (cleaned || raw).trim() + "\n");
  });
  return fs.readFileSync(ctx.file(outName), "utf8").trim();
}
