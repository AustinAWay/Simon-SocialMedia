/** Shared artifact shapes passed between pipeline steps (each persisted as JSON in the run dir). */

export interface Chunk {
  index: number;
  /** Verbatim text spoken in this chunk (speech-normalized, words immutable from source). */
  text: string;
  estSec: number;
}

export interface TtsChunk extends Chunk {
  audioFile: string; // relative to run dir
  audioSec: number;
}

/** Per-chunk visual acting direction (movement planning). Never contains spoken words. */
export interface PerformanceCue {
  index: number;
  cues: string; // short visual-only acting notes appended to the avatar prompt
  energy: "calm" | "warm" | "animated" | "punchy";
}

export interface AvatarChunk extends TtsChunk {
  videoFile: string; // relative to run dir
  videoSec: number; // actual rendered duration
  startSec: number; // cumulative offset on the final timeline
}

export interface Overlay {
  conceptName: string;
  startSec: number;
  endSec: number;
  mode: "card" | "full";
  imageFile: string; // relative to run dir
  imagePrompt: string;
}

export interface VideoMetadata {
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  altTitles: string[];
}
