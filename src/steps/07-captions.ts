/**
 * Step 7 — Captions: burned-in, word-by-word karaoke captions (Shorts retention driver).
 *
 * We already know the exact words per chunk and each chunk's rendered [start,end] on the
 * final timeline, so we derive word timings by PROPORTIONAL allocation (weight by word
 * length + punctuation pause). This is more reliable than STT for known text and needs no
 * extra AI call. Output is an ASS file that highlights the active word in the accent color.
 */
import fs from "node:fs";
import { CAPTIONS, VIDEO } from "../config.js";
import type { RunContext } from "../lib/run.js";
import type { AvatarChunk } from "../lib/types.js";

interface Word { text: string; start: number; end: number }

/** RRGGBB -> ASS &HAABBGGRR (alpha 00 = opaque). */
function assColor(rrggbb: string, alpha = "00"): string {
  const r = rrggbb.slice(0, 2), g = rrggbb.slice(2, 4), b = rrggbb.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function alnumLen(w: string): number {
  return (w.match(/[\p{L}\p{N}]/gu) ?? []).length;
}
function punctPause(w: string): number {
  if (/[.!?…]$/.test(w)) return 3;
  if (/[,;:—-]$/.test(w)) return 1.5;
  return 0;
}

/** Distribute a chunk's words across [t0,t1] proportionally by weight. */
function timeChunk(text: string, t0: number, t1: number): Word[] {
  const raw = text.split(/\s+/).filter(Boolean);
  if (raw.length === 0) return [];
  const weights = raw.map((w) => Math.max(1, alnumLen(w)) + punctPause(w));
  const total = weights.reduce((a, b) => a + b, 0);
  const D = Math.max(0.001, t1 - t0);
  const out: Word[] = [];
  let cursor = t0;
  raw.forEach((w, i) => {
    const dur = (D * weights[i]!) / total;
    out.push({ text: w, start: cursor, end: cursor + dur });
    cursor += dur;
  });
  return out;
}

function toAssTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

/** Group consecutive words into cues (<= maxWordsPerCue), never crossing chunk boundaries. */
function groupCues(words: Word[][]): Word[][] {
  const cues: Word[][] = [];
  for (const chunkWords of words) {
    for (let i = 0; i < chunkWords.length; i += CAPTIONS.maxWordsPerCue) {
      cues.push(chunkWords.slice(i, i + CAPTIONS.maxWordsPerCue));
    }
  }
  return cues;
}

export function buildAss(clips: AvatarChunk[]): string {
  const marginV = Math.round(VIDEO.height * (1 - CAPTIONS.yFrac));
  const primary = assColor(CAPTIONS.primaryColor);
  const highlight = assColor(CAPTIONS.highlightColor);
  const outline = assColor(CAPTIONS.outlineColor);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${VIDEO.width}
PlayResY: ${VIDEO.height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${CAPTIONS.font},${CAPTIONS.fontSizePx},${primary},${primary},${outline},&H00000000,1,0,0,0,100,100,1,0,1,${CAPTIONS.outlinePx},${CAPTIONS.shadowPx},2,80,80,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const perChunkWords = clips.map((c) => timeChunk(c.text, c.startSec, c.startSec + c.videoSec));
  const cues = groupCues(perChunkWords);

  const lines: string[] = [];
  for (const cue of cues) {
    // One Dialogue event per word so the active word pops in the accent color.
    cue.forEach((active) => {
      const text = cue
        .map((w) => {
          const shown = CAPTIONS.allCaps ? w.text.toUpperCase() : w.text;
          return w === active ? `{\\c${highlight}\\fscx112\\fscy112}${shown}{\\c${primary}\\fscx100\\fscy100}` : shown;
        })
        .join(" ");
      lines.push(`Dialogue: 0,${toAssTime(active.start)},${toAssTime(active.end)},Cap,,0,0,0,,${text}`);
    });
  }
  return header + lines.join("\n") + "\n";
}

export async function captions(ctx: RunContext, clips: AvatarChunk[]): Promise<string | null> {
  if (!CAPTIONS.enabled) return null;
  const outName = "07-captions.ass";
  await ctx.cached("captions", outName, async () => {
    ctx.log("⑦ Captions — building karaoke word captions…");
    fs.writeFileSync(ctx.file(outName), buildAss(clips));
  });
  return outName;
}
