/**
 * Run directory + logging + artifact helpers.
 *
 * Every pipeline invocation gets a timestamped run dir under runs/. Steps write their
 * outputs there and record them in run.json. Because outputs are cached on disk, a
 * re-run reuses finished stages (e.g. tweak captions without re-rendering the avatar) —
 * central to fast iteration. Pass force:true to a stage to recompute it.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";

export interface RunContext {
  id: string;
  dir: string;
  scriptPath: string;
  quality: "720p" | "1080p";
  force: Set<string>;
  log: (msg: string) => void;
  file: (name: string) => string;
  readJson: <T>(name: string) => T | null;
  writeJson: (name: string, data: unknown) => string;
  exists: (name: string) => boolean;
  /** Run `fn` only if its primary output is missing (or step is forced). Returns output path. */
  cached: (step: string, outName: string, fn: () => Promise<void>) => Promise<string>;
}

function stamp(): string {
  // Avoid Date in a way that still gives a readable unique id.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function createRun(opts: {
  scriptPath: string;
  quality: "720p" | "1080p";
  force?: string[];
  slug?: string;
  reuseDir?: string;
}): RunContext {
  const id = opts.reuseDir ? path.basename(opts.reuseDir) : `${stamp()}${opts.slug ? "-" + opts.slug : ""}`;
  const dir = opts.reuseDir ?? path.join(PATHS.runs, id);
  fs.mkdirSync(dir, { recursive: true });
  const force = new Set(opts.force ?? []);
  const forceAll = force.has("all");

  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(msg);
    fs.appendFileSync(path.join(dir, "run.log"), line + "\n");
  };
  const file = (name: string) => path.join(dir, name);
  const exists = (name: string) => fs.existsSync(path.join(dir, name));
  const readJson = <T>(name: string): T | null => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  };
  const writeJson = (name: string, data: unknown) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return p;
  };
  const cached = async (step: string, outName: string, fn: () => Promise<void>) => {
    const out = path.join(dir, outName);
    if (!forceAll && !force.has(step) && fs.existsSync(out)) {
      log(`  ↳ [${step}] cached: ${outName}`);
      return out;
    }
    await fn();
    return out;
  };

  return { id, dir, scriptPath: opts.scriptPath, quality: opts.quality, force, log, file, readJson, writeJson, exists, cached };
}
