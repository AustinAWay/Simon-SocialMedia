/**
 * Anthropic wrapper for the TEXT steps only: inflection, b-roll spotting, title/description.
 * (Image/video/audio generation goes through Higgsfield.)
 *
 * baseURL is pinned to the direct API so an ambient ANTHROPIC_BASE_URL proxy in the shell
 * doesn't hijack the user-provided sk-ant key.
 */
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE } from "../config.js";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  client = new Anthropic({
    apiKey,
    baseURL: process.env.SIMON_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
  });
  return client;
}

/** Plain text completion. */
export async function ask(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const res = await getClient().messages.create({
    model: opts.model ?? CLAUDE.model,
    max_tokens: opts.maxTokens ?? CLAUDE.maxTokens,
    temperature: opts.temperature ?? 0.6,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Structured completion via a forced tool call. Returns the tool input as T. */
export async function askTool<T>(opts: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  images?: { mediaType: string; dataBase64: string }[];
}): Promise<T> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const img of opts.images ?? []) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: img.mediaType as "image/png", data: img.dataBase64 },
    });
  }
  content.push({ type: "text", text: opts.user });

  const res = await getClient().messages.create({
    model: opts.model ?? CLAUDE.model,
    max_tokens: opts.maxTokens ?? CLAUDE.maxTokens,
    temperature: opts.temperature ?? 0.4,
    system: opts.system,
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: opts.schema as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content }],
  });
  const toolBlock = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolBlock) throw new Error(`askTool(${opts.toolName}): model did not call the tool`);
  return toolBlock.input as T;
}
