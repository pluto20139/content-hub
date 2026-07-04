/**
 * Sleep for the given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const lastCallMap = new Map<string, number>();

/**
 * Wrap a platform-specific async function, enforcing a minimum interval
 * between same-platform calls. B站 requires ≥ 1500ms; YouTube skips.
 */
export async function withPlatformThrottle<T>(
  platform: string,
  fn: () => Promise<T>,
): Promise<T> {
  const shouldThrottle = ["bilibili", "zhihu", "douyin", "xiaohongshu"].includes(platform);
  if (!shouldThrottle) {
    return fn();
  }

  const last = lastCallMap.get(platform) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < 1500) {
    await sleep(1500 - elapsed);
  }

  try {
    return await fn();
  } finally {
    lastCallMap.set(platform, Date.now());
  }
}
