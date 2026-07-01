/**
 * Step 8 — B-roll: spot high-impact overlay moments, generate concept images (Higgsfield
 * nano_banana), and return timed overlays. "card" overlays sit over Simon; "full" are
 * full-frame cutaways. This whole step is optional (BROLL.enabled) and a key iteration lever.
 */
import fs from "node:fs";
import { askTool } from "../lib/anthropic.js";
import { genImage } from "../lib/higgsfield.js";
import { loadPrompt } from "../lib/prompts.js";
import type { RunContext } from "../lib/run.js";
import type { AvatarChunk, Overlay } from "../lib/types.js";
import { BROLL, CLAUDE } from "../config.js";

interface SpotOut {
  overlays: {
    conceptName: string;
    startSec: number;
    endSec: number;
    mode: "card" | "full";
    imagePrompt: string;
  }[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overlays"],
  properties: {
    overlays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["conceptName", "startSec", "endSec", "mode", "imagePrompt"],
        properties: {
          conceptName: { type: "string" },
          startSec: { type: "number" },
          endSec: { type: "number" },
          mode: { type: "string", enum: ["card", "full"] },
          imagePrompt: { type: "string" },
        },
      },
    },
  },
} as const;

export async function broll(ctx: RunContext, clips: AvatarChunk[], totalSec: number): Promise<Overlay[]> {
  if (!BROLL.enabled) return [];
  const cachePath = "08-overlays.json";
  const forced = ctx.force.has("broll") || ctx.force.has("all");
  const cached = ctx.readJson<Overlay[]>(cachePath);
  if (cached && !forced && cached.every((o) => ctx.exists(o.imageFile))) {
    ctx.log(`  ↳ [broll] cached: ${cached.length} overlays`);
    return cached;
  }

  ctx.log("⑧ B-roll — spotting overlay moments…");
  const timeline = clips
    .map((c) => `[${c.startSec.toFixed(2)}–${(c.startSec + c.videoSec).toFixed(2)}s] "${c.text}"`)
    .join("\n");
  const fullScript = clips.map((c) => c.text).join(" ");

  const system = loadPrompt("broll-spotter")
    .replace("{{MAX_OVERLAYS}}", String(BROLL.maxOverlays))
    .replace("{{MIN_SEC}}", String(BROLL.minSec));

  let spots: SpotOut;
  try {
    spots = await askTool<SpotOut>({
      system,
      user: `TOTAL DURATION: ${totalSec.toFixed(2)}s\n\nCHUNK TIMELINE:\n${timeline}\n\nFULL NARRATION:\n${fullScript}`,
      toolName: "submit_overlays",
      toolDescription: "Submit the chosen image overlays for this video.",
      schema: SCHEMA,
      model: CLAUDE.model,
      temperature: 0.5,
      maxTokens: 3000,
    });
  } catch (err) {
    ctx.log(`   ⚠ b-roll spotter failed, skipping overlays: ${(err as Error).message}`);
    return [];
  }

  // Sanitize: clamp to timeline, enforce min length, cap count, drop overlaps.
  const clean = spots.overlays
    .map((o) => ({
      ...o,
      startSec: Math.max(0, Math.min(o.startSec, totalSec - BROLL.minSec)),
      endSec: Math.min(totalSec, Math.max(o.endSec, o.startSec + BROLL.minSec)),
    }))
    .sort((a, b) => a.startSec - b.startSec)
    .slice(0, BROLL.maxOverlays);

  const nonOverlapping: typeof clean = [];
  for (const o of clean) {
    const prev = nonOverlapping[nonOverlapping.length - 1];
    if (prev && o.startSec < prev.endSec) o.startSec = prev.endSec + 0.05;
    if (o.endSec - o.startSec >= BROLL.minSec) nonOverlapping.push(o);
  }

  ctx.log(`   generating ${nonOverlapping.length} overlay images…`);
  const out: Overlay[] = [];
  for (let i = 0; i < nonOverlapping.length; i++) {
    const o = nonOverlapping[i]!;
    const imageFile = `broll/overlay-${String(i).padStart(2, "0")}.png`;
    const abs = ctx.file(imageFile);
    const aspect = o.mode === "full" ? "9:16" : "4:5";
    try {
      await genImage({ prompt: o.imagePrompt, aspectRatio: aspect, outPath: abs });
      out.push({
        conceptName: o.conceptName,
        startSec: +o.startSec.toFixed(3),
        endSec: +o.endSec.toFixed(3),
        mode: o.mode,
        imageFile,
        imagePrompt: o.imagePrompt,
      });
      ctx.log(`   [${i}] ${o.mode} ${o.startSec.toFixed(1)}–${o.endSec.toFixed(1)}s "${o.conceptName}"`);
    } catch (err) {
      ctx.log(`   ⚠ overlay ${i} image failed, skipping: ${(err as Error).message}`);
    }
  }
  ctx.writeJson(cachePath, out);
  return out;
}
