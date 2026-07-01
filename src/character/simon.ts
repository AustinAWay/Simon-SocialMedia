/**
 * Simon — the on-screen presenter.
 *
 * Identity comes ENTIRELY from the reference images (SIMON_REFERENCE_FILES). The text
 * prompt is character-agnostic: it describes framing, delivery, and the shot. This is the
 * single most important iteration lever ("changing the AI character prompt"), so it is
 * isolated here and versioned.
 *
 * Adapted from the ap-forge canonical-v2.2 prompt, but re-authored for VERTICAL short-form:
 *  - chest-up / medium framing that fills a 9:16 phone frame (not full-body head-to-toe)
 *  - a clean studio background baked directly into the render (no matte compositing)
 *  - gestures kept near the chest so hands stay inside the tall, narrow frame
 */
import path from "node:path";
import { PATHS } from "../config.js";

export const SIMON_PROMPT_VERSION = "simon-vertical-v1";

/** Locked reference set — order matters (identity anchor first). */
export const SIMON_REFERENCE_FILES = [
  "Simon - neutral upscaled.png", // identity anchor
  "Simon - Expressions.jpg", // expression range
  "Simon - Idle.jpg", // idle / breathing
  "Simon - Teaching 1.jpg", // teaching gestures
  "Simon - Teaching 2.jpg", // teaching gestures
];

export function simonReferencePaths(): string[] {
  return SIMON_REFERENCE_FILES.map((f) => path.join(PATHS.simonRefs, f));
}

/**
 * The base canonical prompt for every lip-sync chunk. The {{PERFORMANCE_CUES}} slot is
 * filled per chunk by the performance director (movement planning). If cues are empty the
 * slot collapses cleanly.
 */
export const SIMON_CANONICAL_PROMPT = `CRITICAL: Preserve the input audio voice exactly and have the avatar lip-sync perfectly to it. Do not substitute, restyle, or regenerate the voice. Same speaker identity, same vocal timbre, same pitch and cadence as the input audio.

Photorealistic young college teaching assistant speaking the exact words of the audio straight down the barrel of the camera, in a warm, sharp, genuinely enthusiastic conversational style — the way a great tutor explains something they love. He is framed from the mid-chest up, centered, close to camera, filling a tall vertical 9:16 phone frame with his head near the top third and clear headroom.

His face stays alive and tracks the meaning of every phrase: real eye contact, natural blinking, eyebrows and micro-expressions that shift beat to beat with the line. Tight, purposeful hand gestures rise into the lower part of the frame near his chest to punctuate key ideas, then settle — never flailing, never leaving frame. Engaged, breathing upper body with small natural weight shifts and head movement. He is not always smiling; expression follows meaning, with the occasional quick grin when a point lands.

Soft, flattering studio key light from camera right with gentle fill. Clean, simple, modern out-of-focus studio background in soft neutral tones with a subtle depth-of-field blur that keeps all attention on his face — no text, no logos, no clutter, no busy set dressing. Shot on a portrait lens, shallow depth of field, crisp focus on the eyes.

Keep the camera and framing completely static and locked. Keep him fully in character with a stable, consistent face and identity across the whole clip; avoid identity drift, rubber-faced mugging, or generic hyped-up influencer energy — let him be genuinely expressive, lively, and physically engaged rather than stiff, flat, or deadpan. Do not add any feature not present in the reference images — no glasses, jewelry, hats, or accessories — and add no objects or props.{{PERFORMANCE_CUES}}`;

/** Build the final per-chunk prompt, splicing in performance cues if present. */
export function buildSimonPrompt(performanceCues?: string): string {
  const cues = performanceCues?.trim();
  const slot = cues ? `\n\nPERFORMANCE (visual acting only — do NOT speak these words):\n${cues}` : "";
  return SIMON_CANONICAL_PROMPT.replace("{{PERFORMANCE_CUES}}", slot);
}
