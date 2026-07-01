/**
 * Higgsfield CLI wrapper — ALL AI generation (voice, talking-head video, images, STT)
 * routes through here. Verified call shapes:
 *   higgsfield upload create <file> --json            -> { id, type, url }
 *   higgsfield generate create <model> --p v --json   -> ["<job_id>"]
 *   higgsfield generate get <id> --json               -> { status, result_url, ... }
 * Lip-sync (seedance_2_0) takes references + audio via a --medias JSON array:
 *   [{role:"image",data:{id,type:"media_input"}}, {role:"audio",data:{id,type:"audio_input"}}]
 *
 * Renders take minutes, so we create-without-wait then poll get() ourselves. The whole
 * pipeline is meant to run as one long Node process (launched in the background), so long
 * polls are fine here.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HF, VIDEO } from "../config.js";

const HF_BIN_CANDIDATES = [
  path.join(os.homedir(), ".local/node-v22.11.0-darwin-arm64/bin/higgsfield"),
  "higgsfield",
];

let cachedBin: string | null = null;
function hfBin(): string {
  if (cachedBin) return cachedBin;
  for (const c of HF_BIN_CANDIDATES) {
    if (c === "higgsfield" || fs.existsSync(c)) {
      cachedBin = c;
      return c;
    }
  }
  cachedBin = "higgsfield";
  return cachedBin;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(hfBin(), args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`higgsfield ${args.slice(0, 3).join(" ")} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.toString());
    });
  });
}

function parseJson<T>(s: string): T {
  // The CLI sometimes prints a leading progress line before JSON; grab the JSON body.
  const start = s.search(/[[{]/);
  const body = start >= 0 ? s.slice(start) : s;
  return JSON.parse(body) as T;
}

async function runJson<T>(args: string[], timeoutMs?: number): Promise<T> {
  const out = await run([...args, "--json"], timeoutMs);
  return parseJson<T>(out);
}

// ---------------------------------------------------------------------------
// Uploads (with a persistent cache so Simon's 5 refs upload once per machine)
// ---------------------------------------------------------------------------
export interface UploadResult {
  id: string;
  type: string;
  url: string;
}

const uploadCacheFile = path.join(os.tmpdir(), "simon-hf-upload-cache.json");
function loadUploadCache(): Record<string, UploadResult> {
  try {
    return JSON.parse(fs.readFileSync(uploadCacheFile, "utf8"));
  } catch {
    return {};
  }
}
function saveUploadCache(c: Record<string, UploadResult>): void {
  try {
    fs.writeFileSync(uploadCacheFile, JSON.stringify(c));
  } catch {
    /* best-effort */
  }
}

export async function uploadMedia(filePath: string, opts?: { cache?: boolean }): Promise<UploadResult> {
  const useCache = opts?.cache ?? true;
  const stat = fs.statSync(filePath);
  const key = `${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  const cache = loadUploadCache();
  if (useCache && cache[key]) return cache[key];
  const res = await runJson<UploadResult>(["upload", "create", filePath], 300_000);
  if (useCache) {
    cache[key] = res;
    saveUploadCache(cache);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Generation jobs
// ---------------------------------------------------------------------------
export interface JobStatus {
  id: string;
  status: string; // queued | in_progress | completed | failed | ...
  result_url?: string;
}

function paramArgs(params: Record<string, string | number | boolean | undefined>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    out.push(`--${k}`, String(v));
  }
  return out;
}

export async function createJob(
  model: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<string> {
  const res = await runJson<(string | { id: string })[]>(["generate", "create", model, ...paramArgs(params)], 180_000);
  const first = Array.isArray(res) ? res[0] : undefined;
  if (first !== undefined) {
    return typeof first === "string" ? first : first.id;
  }
  throw new Error(`createJob(${model}) returned no job id: ${JSON.stringify(res)}`);
}

export async function getJob(id: string): Promise<JobStatus> {
  const res = await runJson<JobStatus>(["generate", "get", id]);
  return res;
}

export async function waitJob(
  id: string,
  opts?: { timeoutMs?: number; intervalMs?: number; onTick?: (s: JobStatus) => void },
): Promise<JobStatus> {
  const timeoutMs = opts?.timeoutMs ?? 20 * 60_000;
  const intervalMs = opts?.intervalMs ?? 8000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await getJob(id);
    opts?.onTick?.(s);
    const status = s.status?.toLowerCase();
    if (status === "completed" && s.result_url) return s;
    if (status === "failed" || status === "canceled" || status === "error") {
      throw new Error(`job ${id} ${status}`);
    }
    if (Date.now() > deadline) throw new Error(`job ${id} timed out after ${Math.round(timeoutMs / 1000)}s (status=${s.status})`);
    await sleep(intervalMs);
  }
}

async function download(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}

/** Create a job, wait for it, download the result to outPath. Returns the job status. */
export async function generateToFile(
  model: string,
  params: Record<string, string | number | boolean | undefined>,
  outPath: string,
  waitOpts?: { timeoutMs?: number; intervalMs?: number; onTick?: (s: JobStatus) => void },
): Promise<JobStatus> {
  const id = await createJob(model, params);
  const done = await waitJob(id, waitOpts);
  await download(done.result_url!, outPath);
  return done;
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

/** Text-to-speech in Simon's voice (Higgsfield "Brooks" preset). Downloads mp3 to outPath. */
export async function tts(text: string, outPath: string): Promise<void> {
  await generateToFile(
    HF.ttsModel,
    { model: HF.ttsBackend, voice_type: HF.ttsVoiceType, voice_id: HF.ttsVoiceId, prompt: text },
    outPath,
    { timeoutMs: 5 * 60_000, intervalMs: 4000 },
  );
}

/** Talking-head lip-sync via seedance_2_0. imageIds = Simon refs, audioId = chunk voice. */
export async function lipsync(opts: {
  prompt: string;
  imageIds: string[];
  audioId: string;
  durationSec: number;
  resolution: string;
  outPath: string;
  onTick?: (s: JobStatus) => void;
}): Promise<void> {
  const medias = [
    ...opts.imageIds.map((id) => ({ role: "image", data: { id, type: "media_input" } })),
    { role: "audio", data: { id: opts.audioId, type: "audio_input" } },
  ];
  await generateToFile(
    HF.avatarModel,
    {
      prompt: opts.prompt,
      aspect_ratio: VIDEO.aspectRatio,
      resolution: opts.resolution,
      duration: Math.round(opts.durationSec),
      medias: JSON.stringify(medias),
    },
    opts.outPath,
    { timeoutMs: 20 * 60_000, intervalMs: 8000, onTick: opts.onTick },
  );
}

/** Generate a concept/b-roll image. Optional Simon (or other) reference image ids. */
export async function genImage(opts: {
  prompt: string;
  inputImageIds?: string[];
  aspectRatio: string;
  outPath: string;
}): Promise<void> {
  const params: Record<string, string | number | boolean | undefined> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio,
    resolution: HF.imageResolution,
  };
  if (opts.inputImageIds?.length) {
    params.input_images = JSON.stringify(opts.inputImageIds.map((id) => ({ id, type: "media_input" })));
  }
  await generateToFile(HF.imageModel, params, opts.outPath, { timeoutMs: 6 * 60_000, intervalMs: 5000 });
}

/** Speech-to-text. Returns the raw transcript job result (shape probed at build time). */
export async function stt(audioId: string): Promise<unknown> {
  const id = await createJob(HF.sttModel, { input_audio: audioId });
  const done = await waitJob(id, { timeoutMs: 8 * 60_000, intervalMs: 4000 });
  // Fetch the transcript payload (result_url is JSON).
  if (done.result_url) {
    const res = await fetch(done.result_url);
    if (res.ok) return await res.json();
  }
  return done;
}
