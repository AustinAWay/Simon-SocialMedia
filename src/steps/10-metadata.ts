/** Step 10 — Metadata: research-backed title, description, hashtags, tags. */
import fs from "node:fs";
import path from "node:path";
import { askTool } from "../lib/anthropic.js";
import { loadPrompt } from "../lib/prompts.js";
import { PATHS, CLAUDE } from "../config.js";
import type { RunContext } from "../lib/run.js";
import type { AvatarChunk, VideoMetadata } from "../lib/types.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "altTitles", "description", "hashtags", "tags"],
  properties: {
    title: { type: "string" },
    altTitles: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
    description: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  },
} as const;

export async function metadata(ctx: RunContext, clips: AvatarChunk[]): Promise<VideoMetadata> {
  const cachePath = "metadata.json";
  const cached = ctx.readJson<VideoMetadata>(cachePath);
  if (cached && !ctx.force.has("metadata") && !ctx.force.has("all")) {
    ctx.log("  ↳ [metadata] cached");
    return cached;
  }
  ctx.log("⑩ Metadata — writing title & description…");

  const guidelinesPath = path.join(PATHS.research, "shorts-metadata-guidelines.md");
  const guidelines = fs.existsSync(guidelinesPath)
    ? fs.readFileSync(guidelinesPath, "utf8")
    : "Titles <= 50 chars, hook + keyword first. Description: keyword + promise in first 125 chars, then context, CTA, then 3-5 hashtags on their own line (#Shorts required). 5-8 tags.";

  const transcript = clips.map((c) => c.text).join(" ");
  const system = loadPrompt("metadata").replace("{{GUIDELINES}}", guidelines);

  const res = await askTool<VideoMetadata>({
    system,
    user: `VIDEO TRANSCRIPT:\n"""${transcript}"""`,
    toolName: "submit_metadata",
    toolDescription: "Submit the optimized packaging for this Short.",
    schema: SCHEMA,
    model: CLAUDE.smartModel,
    temperature: 0.8,
    maxTokens: 2000,
  });

  ctx.writeJson(cachePath, res);
  fs.writeFileSync(ctx.file("title.txt"), res.title + "\n");
  const descBlock = `${res.description}\n\n${res.hashtags.join(" ")}\n\n---\nAlt titles:\n${res.altTitles.map((t) => "• " + t).join("\n")}\n\nTags: ${res.tags.join(", ")}\n`;
  fs.writeFileSync(ctx.file("description.txt"), descBlock);
  ctx.log(`   Title: ${res.title}`);
  return res;
}
