import type { Attachment } from "@/lib/types";

/**
 * Text-ish files the model can actually read. Anything binary (images, PDFs,
 * archives) is rejected rather than pasted in as mojibake.
 */
export const ACCEPTED_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
  ".xml", ".html", ".css", ".log", ".ini", ".toml", ".sql",
  ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".h", ".cpp",
  ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".swift", ".kt",
];

export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",") + ",text/*";

/** Keep a file from swallowing the whole context window. */
export const MAX_CHARS = 20_000;

const MAX_BYTES = 2 * 1024 * 1024;

function hasTextExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && ACCEPTED_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}

/**
 * Control characters that never appear in real text give away a binary file
 * whose extension says otherwise. Tab, newline and carriage return are fine.
 */
function looksBinary(sample: string): boolean {
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) return true;
  }
  return false;
}

/** Read one file as text, or throw a message worth showing the user. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_BYTES) {
    throw new Error(`${file.name} is larger than 2 MB.`);
  }
  if (!file.type.startsWith("text/") && !hasTextExtension(file.name)) {
    throw new Error(`${file.name} is not a text file.`);
  }

  const raw = await file.text();

  if (looksBinary(raw.slice(0, 4000))) {
    throw new Error(`${file.name} looks binary, not text.`);
  }

  const truncated = raw.length > MAX_CHARS;
  return {
    name: file.name,
    text: truncated ? raw.slice(0, MAX_CHARS) : raw,
    truncated,
  };
}

/**
 * Fold attachments into the message text. The model reads the file straight
 * from here -- there is no separate parsing step.
 */
export function buildMessage(text: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return text;

  const blocks = attachments.map(
    (a) =>
      `===ATTACHMENT_START:${a.name}${a.truncated ? " (truncated)" : ""}===\n` +
      a.text +
      `\n===ATTACHMENT_END===`,
  );

  return [text.trim(), ...blocks].filter(Boolean).join("\n\n");
}

const NEW_FILE_BLOCK = /(?:\n\n)?===ATTACHMENT_START:(.+?)===\n[\s\S]*?\n===ATTACHMENT_END===/g;
const LEGACY_FILE_HEADER = /(?:\n\n)?--- file: (.+?) ---\n```/g;

/**
 * Split a stored user message back into what they typed and which files they
 * attached. The file bodies stay in the stored message for the model; the UI
 * shows a chip instead of pasting the whole thing back at the user.
 */
export function splitMessage(content: string): { text: string; files: string[] } {
  const files: string[] = [];

  // Match new robust boundary tags
  let text = content.replace(NEW_FILE_BLOCK, (_match, header: string) => {
    const fileName = header.replace(/\s*\(truncated\)$/, "").trim();
    files.push(fileName);
    return "";
  });

  // Handle legacy messages or files attached with legacy headers
  if (text.includes("--- file: ")) {
    const headerMatch = LEGACY_FILE_HEADER.exec(text);
    if (headerMatch) {
      const fileName = headerMatch[1].replace(/\s*\(truncated\)$/, "").trim();
      files.push(fileName);
      text = text.slice(0, headerMatch.index);
    }
  }

  return { text: text.trim(), files };
}
