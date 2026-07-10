interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() > entry.expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCached<T>(key: string, data: T, ttlMs = 5 * 60 * 1000): void {
  try {
    const entry: CacheEntry<T> = {
      data,
      expiry: Date.now() + ttlMs,
    };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch (e) {
    console.warn("Failed to set cache:", e);
  }
}
