# Simon — Vertical AP Explainer Pipeline

Script in → **fully edited vertical video out** (+ an optimized title & description) for YouTube Shorts / Reels / TikTok.

Simon is an AI talking-head presenter (rendered from the reference images in `assets/simon/refs/`) who explains AP (Advanced Placement) concepts in punchy short-form videos. **All AI generation — voice, talking-head video, and overlay images — runs through the Higgsfield CLI.** Text steps (script inflection, b-roll spotting, title/description) use the Anthropic API.

This pipeline extracts and re-purposes the audio-video generation core of [`ap-forge-script-generation`](https://github.com/superbuilders/ap-forge-script-generation) and rebuilds it for **vertical short-form**.

## What it does

1. **Inflect** — speech-normalize the script for TTS (words stay verbatim).
2. **Chunk** — split into lip-sync-sized beats (blank lines = hard cuts).
3. **TTS** — synthesize each beat in Simon's voice (Higgsfield "Brooks" preset / ElevenLabs).
4. **Movement** — per-beat visual performance direction (expression, gesture, energy).
5. **Avatar** — Higgsfield `seedance_2_0` lip-sync, 9:16, per beat (Simon refs + audio + prompt).
6. **Concat** — join beats into one normalized vertical video.
7. **Captions** — burned-in, word-by-word karaoke captions (deterministic timing from the known script + measured durations).
8. **B-roll** — spot high-impact moments, generate concept images (Higgsfield `nano_banana_2`), overlay them.
9. **Stitch** — composite overlays + burn captions → `final.mp4`.
10. **Metadata** — research-backed title, description, hashtags, tags (see `research/shorts-metadata-guidelines.md`).

## Usage

```bash
npm install
# put ANTHROPIC_API_KEY in .env (see .env.example); `higgsfield auth login` handles Higgsfield auth
npx tsx src/index.ts generate examples/columbian-exchange.md --quality 720p
```

Output lands in `runs/<timestamp>/`: `final.mp4`, `title.txt`, `description.txt`, `metadata.json`, `thumbnail.png`.

### Options

| Flag | Meaning |
|---|---|
| `--quality 720p\|1080p` | render resolution (720p for iteration, 1080p for delivery) |
| `--slug <name>` | label the run |
| `--reuse <runId>` | reuse a run dir (cached artifacts) |
| `--force <steps>` | recompute steps (e.g. `--force captions,broll` or `all`) |
| `--no-broll` / `--no-captions` | skip those layers |

Artifacts are cached per step in the run dir, so re-running only recomputes what changed (e.g. tweak captions without re-rendering the avatar).

## Tuning / iteration levers

- **Character look & delivery:** `src/character/simon.ts` (canonical vertical prompt) + `src/prompts/performance-director.md`.
- **Movement planning:** `src/steps/04-movement.ts` + its prompt.
- **Captions style:** `CAPTIONS` in `src/config.ts`.
- **B-roll behavior:** `BROLL` in `src/config.ts` + `src/prompts/broll-spotter.md`.
- **Models / voice / resolution:** `HF` in `src/config.ts`.

## Requirements

- Node 22+, the [`higgsfield` CLI](https://www.npmjs.com/package/@higgsfield/cli) authenticated (`higgsfield auth login`).
- `ffmpeg`/`ffprobe` are bundled via `ffmpeg-static` / `ffprobe-static` — no system install needed.
