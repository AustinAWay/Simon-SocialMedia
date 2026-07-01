/**
 * Direct ElevenLabs TTS — Simon's exact pipeline voice (Brooks / eleven_v3 / Heimler settings).
 * Used when ELEVENLABS_API_KEY is set; otherwise the caller falls back to Higgsfield's Brooks.
 */
import fs from "node:fs";
import path from "node:path";
import { SIMON_VOICE } from "../character/simonVoice.js";

export function hasElevenLabsKey(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/** Synthesize `text` in Simon's voice and write the mp3 to outPath. */
export async function ttsElevenLabs(text: string, outPath: string): Promise<void> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${SIMON_VOICE.voiceId}?output_format=${SIMON_VOICE.outputFormat}`;
  const body = {
    text,
    model_id: SIMON_VOICE.modelId,
    language_code: SIMON_VOICE.languageCode,
    seed: SIMON_VOICE.seed,
    voice_settings: SIMON_VOICE.voiceSettings,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${detail.slice(0, 400)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
}
