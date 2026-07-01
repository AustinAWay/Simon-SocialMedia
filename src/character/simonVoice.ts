/**
 * Simon's voice — the exact config from the ap-forge voice pipeline (simon.voice.json):
 * ElevenLabs "Brooks" (Voice Library) under Heimler-tuned settings on eleven_v3.
 *
 * Used by the direct-ElevenLabs path (src/lib/elevenlabs.ts) when ELEVENLABS_API_KEY is set.
 * Without a key, the pipeline falls back to Higgsfield's "Brooks" preset (same voice, but
 * default settings — no custom stability/style/speed).
 */
export const SIMON_VOICE = {
  voiceId: "sUzXYdokj3o9QQ91yPRF", // ElevenLabs Voice Library "Brooks"
  modelId: "eleven_v3",
  languageCode: "en",
  seed: 12345,
  outputFormat: "mp3_44100_128",
  voiceSettings: {
    stability: 0.25,
    similarity_boost: 0.8,
    style: 0.4,
    use_speaker_boost: true,
    speed: 1.18,
  },
} as const;
