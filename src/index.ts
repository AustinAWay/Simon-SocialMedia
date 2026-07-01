#!/usr/bin/env -S npx tsx
/**
 * Simon vertical-video pipeline — CLI entry.
 *
 *   tsx src/index.ts generate <script.md> [options]
 *
 * Options:
 *   --quality 720p|1080p   render resolution (default 720p; use 1080p for final delivery)
 *   --slug <name>          label appended to the run id
 *   --reuse <runId>        reuse an existing run dir (re-run with cached artifacts)
 *   --force <a,b,...>      recompute these steps (or "all"): inflect,chunk,tts,movement,
 *                          avatar,concat,captions,broll,stitch-overlay,stitch-captions,metadata
 *   --no-broll             skip image overlays
 *   --no-captions          skip burned captions
 *
 * script in -> fully edited vertical video out (+ title & description).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRun } from "./lib/run.js";
import { BROLL, CAPTIONS, PATHS } from "./config.js";
import { inflect } from "./steps/01-inflect.js";
import { chunk } from "./steps/02-chunk.js";
import { synthesize } from "./steps/03-tts.js";
import { planMovement } from "./steps/04-movement.js";
import { renderAvatar } from "./steps/05-avatar.js";
import { concat } from "./steps/06-concat.js";
import { captions } from "./steps/07-captions.js";
import { broll } from "./steps/08-broll.js";
import { stitch } from "./steps/09-stitch.js";
import { metadata } from "./steps/10-metadata.js";

function loadDotEnv(): void {
  const p = path.join(PATHS.repoRoot, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

interface Args {
  script: string;
  quality: "720p" | "1080p";
  slug?: string;
  reuse?: string;
  force: string[];
  noBroll: boolean;
  noCaptions: boolean;
}

function parseArgs(argv: string[]): Args {
  const [cmd, ...rest] = argv;
  if (cmd !== "generate") {
    console.error("usage: tsx src/index.ts generate <script.md> [--quality 720p|1080p] [--slug x] [--reuse runId] [--force a,b] [--no-broll] [--no-captions]");
    process.exit(1);
  }
  const args: Args = { script: "", quality: "720p", force: [], noBroll: false, noCaptions: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--quality") args.quality = rest[++i] as "720p" | "1080p";
    else if (a === "--slug") args.slug = rest[++i];
    else if (a === "--reuse") args.reuse = rest[++i];
    else if (a === "--force") args.force = (rest[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--no-broll") args.noBroll = true;
    else if (a === "--no-captions") args.noCaptions = true;
    else if (!a.startsWith("--")) args.script = a;
  }
  if (!args.script) {
    console.error("error: no script file given");
    process.exit(1);
  }
  return args;
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const scriptPath = path.resolve(args.script);
  if (!fs.existsSync(scriptPath)) {
    console.error(`error: script not found: ${scriptPath}`);
    process.exit(1);
  }

  if (args.noBroll) (BROLL as { enabled: boolean }).enabled = false;
  if (args.noCaptions) (CAPTIONS as { enabled: boolean }).enabled = false;

  const reuseDir = args.reuse ? path.join(PATHS.runs, args.reuse) : undefined;
  const ctx = createRun({ scriptPath, quality: args.quality, force: args.force, slug: args.slug, reuseDir });

  const t0 = Date.now();
  ctx.log(`\n=== Simon vertical pipeline · run ${ctx.id} · ${args.quality} ===`);
  ctx.log(`script: ${scriptPath}\n`);

  const script = await inflect(ctx);
  const chunks = await chunk(ctx, script);
  const tts = await synthesize(ctx, chunks);
  const cues = await planMovement(ctx, chunks);
  const clips = await renderAvatar(ctx, tts, cues);
  const { rawFile, totalSec } = await concat(ctx, clips);
  const ass = await captions(ctx, clips);
  const overlays = await broll(ctx, clips, totalSec);
  const finalName = await stitch(ctx, rawFile, overlays, ass);
  const meta = await metadata(ctx, clips);

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  ctx.log(`\n=== DONE in ${secs}s ===`);
  ctx.log(`🎬 Video:       ${ctx.file(finalName)}`);
  ctx.log(`📝 Title:       ${meta.title}`);
  ctx.log(`📄 Description: ${ctx.file("description.txt")}`);
  ctx.log(`🖼  Thumbnail:   ${ctx.file("thumbnail.png")}`);
}

main().catch((err) => {
  console.error("\n✗ pipeline failed:", err);
  process.exit(1);
});
