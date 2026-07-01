/**
 * Central config for the Simon vertical-video pipeline.
 *
 * Everything an iteration is likely to touch lives here or in src/character/simon.ts
 * and src/prompts/*. Keep provider/model choices and tunable numbers in one place so a
 * run is reproducible and a tweak is one edit.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

export const PATHS = {
  repoRoot: REPO_ROOT,
  assets: path.join(REPO_ROOT, "assets"),
  simonRefs: path.join(REPO_ROOT, "assets", "simon", "refs"),
  fonts: path.join(REPO_ROOT, "assets", "fonts"),
  prompts: path.join(REPO_ROOT, "src", "prompts"),
  research: path.join(REPO_ROOT, "research"),
  runs: path.join(REPO_ROOT, "runs"),
};

/** Final delivery canvas — vertical 9:16 for Shorts / Reels / TikTok. */
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  aspectRatio: "9:16" as const,
};

/**
 * Higgsfield model + generation choices. All AI generation is routed through the
 * Higgsfield CLI (see src/lib/higgsfield.ts).
 */
export const HF = {
  // ---- Talking-head (lip-sync) video ----
  avatarModel: "seedance_2_0",
  /** "720p" for cheap iteration, "1080p" for final delivery. Overridable via --quality. */
  avatarResolution: "720p" as "720p" | "1080p" | "480p" | "4k",
  /** Seedance hard limits: ~3–15s per clip. We chunk audio to sit inside this. */
  avatarMinDurationSec: 4,
  avatarMaxDurationSec: 15,

  // ---- Text-to-speech (Simon's voice) ----
  ttsModel: "text2speech_v2",
  ttsBackend: "elevenlabs", // model= arg inside text2speech_v2
  ttsVoiceType: "preset" as "preset" | "element",
  /** Higgsfield "Brooks" preset — the same voice Simon uses in the source pipeline. */
  ttsVoiceId: "c2acff45-84b2-4974-892d-89fa2d4e5598",

  // ---- Speech-to-text (caption timing) ----
  sttModel: "speech2text",

  // ---- Image generation (b-roll cutaways / concept cards) ----
  imageModel: "nano_banana_2",
  imageResolution: "2k" as "1k" | "2k" | "4k",
} as const;

/** Anthropic (text-only steps: inflection, b-roll spotting, metadata). */
export const CLAUDE = {
  model: "claude-sonnet-5",
  smartModel: "claude-opus-4-8",
  maxTokens: 8000,
};

/**
 * Audio chunking bounds. A "chunk" becomes one Seedance clip, so it must fit the
 * avatar duration window with headroom. Blank lines in the script are hard cuts.
 */
export const CHUNK = {
  // Measured Brooks/ElevenLabs rate is ~2.2 wps (slower than the 2.6 estimate); tuned so
  // chunks land ~7-10s of actual audio, comfortably inside the seedance clip window.
  wordsPerSec: 2.2,
  targetSec: 7,
  minSec: 4,
  maxSec: 10,
};

/** Caption styling (burned-in, karaoke word highlight). Tunable per iteration. */
export const CAPTIONS = {
  enabled: true,
  font: "Anton", // family name inside assets/fonts/Anton-Regular.ttf
  fontFile: path.join(PATHS.fonts, "Anton-Regular.ttf"),
  fontSizePx: 96,
  maxWordsPerCue: 3,
  primaryColor: "FFFFFF", // base word color (ASS is &HBBGGRR)
  highlightColor: "27E0B0", // active-word color (mint/green brand accent)
  outlineColor: "000000",
  outlinePx: 6,
  shadowPx: 3,
  /** Vertical position of caption baseline as a fraction of height (0=top,1=bottom). */
  yFrac: 0.72,
  allCaps: true,
};

/** B-roll / concept overlays. */
export const BROLL = {
  enabled: true,
  /** Max number of generated concept images per video. */
  maxOverlays: 6,
  /** Minimum on-screen seconds for one overlay. */
  minSec: 2.2,
  /** How overlays sit in frame. "card" = upper card over Simon; "full" = full-frame cutaway. */
  defaultMode: "card" as "card" | "full",
};

export const METADATA = {
  /** Platform we optimize the title/description for. */
  platform: "youtube-shorts",
};
