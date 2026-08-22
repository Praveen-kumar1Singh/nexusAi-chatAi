import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Join class names, letting later Tailwind classes win over earlier ones.
 * Lets a caller pass `className` to override a component's own styling.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Words a plain capitalize would mangle when building a tool label. */
const TOOL_WORDS: Record<string, string> = {
  api: "API",
  db: "DB",
  id: "ID",
  pdf: "PDF",
  sql: "SQL",
  url: "URL",
};

/**
 * Turn a registry tool name into something readable: `web_search` -> "Web Search".
 * The raw name still shows wherever the UI is describing the registry itself.
 */
export function toolLabel(name: string): string {
  return name
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => TOOL_WORDS[word.toLowerCase()] ?? word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
