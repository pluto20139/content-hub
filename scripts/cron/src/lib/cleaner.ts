import type { RawContent } from "../adapters/types.js";

const MAX_TITLE_LENGTH = 300;
const MAX_CONTENT_SIZE_BYTES = 3 * 1024;

/**
 * Clean and normalize a batch of RawContent before UPSERT.
 * SPEC 6.1 applies.
 */
export function cleanContent(raw: RawContent): RawContent | null {
  // Strip HTML tags
  let title = raw.title.replace(/<[^>]+>/g, "").trim();

  // Truncate
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH);
  }

  // Ensure HTTPS
  let coverUrl: string | null = null;
  if (raw.cover_url) {
    try {
      const url = new URL(raw.cover_url.replace(/^http:/, "https:"));
      if (url.protocol !== "https:") {
        url.protocol = "https:";
      }
      coverUrl = url.toString();
    } catch {
      coverUrl = null;
    }
  }

  // Trim native_id
  const nativeId = raw.native_id.trim();

  // Size check
  const cleaned: RawContent = {
    platform: raw.platform,
    native_id: nativeId,
    content_type: raw.content_type,
    title,
    cover_url: coverUrl,
    original_url: raw.original_url,
    published_at: raw.published_at,
  };

  const size = new TextEncoder().encode(JSON.stringify(cleaned)).length;
  if (size > MAX_CONTENT_SIZE_BYTES) {
    console.warn(`Content ${nativeId} exceeds 3KB limit (${size} bytes), skipping`);
    return null;
  }

  return cleaned;
}

/**
 * Filter out pinned/old content: items whose published_at is before monitor.last_content_at
 * are considered old (pinned content that was already seen).
 */
export function filterNewContent(
  contents: RawContent[],
  lastContentAt: string,
): RawContent[] {
  return contents.filter((c) => {
    return new Date(c.published_at).getTime() > new Date(lastContentAt).getTime();
  });
}
