// Single place for the Claude model id + response parsing helpers, so a model
// change never has to be hunted down across routes (a stale hardcoded id is
// what produced the 404 not_found_error on upload).
export const MODEL = "claude-opus-5";

// Newer models return thinking blocks alongside text, so content[0] is not
// necessarily the answer — pick the first text block instead of assuming.
export function firstText(content: any[]): string {
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}
