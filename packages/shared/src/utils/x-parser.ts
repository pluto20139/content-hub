/**
 * X (Twitter) URL / Handle 解析工具
 */

export interface ParsedXUser {
  handle: string;
  originalUrl: string;
}

export function parseXUrl(input: string): ParsedXUser | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // 1. 形如 @username
  if (trimmed.startsWith('@')) {
    const handle = trimmed.slice(1).trim();
    if (/^[a-zA-Z0-9_]{1,15}$/.test(handle)) {
      return {
        handle,
        originalUrl: `https://x.com/${handle}`,
      };
    }
    return null;
  }

  // 2. 形如纯 username (长度 1-15，仅包含字母数字下划线)
  if (/^[a-zA-Z0-9_]{1,15}$/.test(trimmed)) {
    return {
      handle: trimmed,
      originalUrl: `https://x.com/${trimmed}`,
    };
  }

  // 3. 完整 URL (x.com 或 twitter.com)
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    const validHosts = ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'];
    if (validHosts.includes(host)) {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        const potentialHandle = parts[0];
        // 排除保留关键字
        const reserved = ['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i', 'tos', 'privacy'];
        if (!reserved.includes(potentialHandle.toLowerCase()) && /^[a-zA-Z0-9_]{1,15}$/.test(potentialHandle)) {
          return {
            handle: potentialHandle,
            originalUrl: `https://x.com/${potentialHandle}`,
          };
        }
      }
    }
  } catch (_e) {
    return null;
  }

  return null;
}
