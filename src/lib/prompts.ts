import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.js";

export function loadPrompt(name: string): string {
  return fs.readFileSync(path.join(PATHS.prompts, `${name}.md`), "utf8");
}
