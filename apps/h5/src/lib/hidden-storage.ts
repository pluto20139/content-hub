const STORAGE_KEY = "h5:hidden:ids";

function read(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((n) => typeof n === "number"));
  } catch {
    return new Set();
  }
}

function write(ids: Set<number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch (e) {
    console.warn("Failed to persist hidden ids:", e);
  }
}

export function getHiddenIds(): Set<number> {
  return read();
}

export function addHiddenId(id: number): void {
  const ids = read();
  if (ids.has(id)) return;
  ids.add(id);
  write(ids);
}

export function removeHiddenId(id: number): void {
  const ids = read();
  if (!ids.has(id)) return;
  ids.delete(id);
  write(ids);
}

export function asSupabaseIdList(ids: Set<number>): string {
  if (ids.size === 0) return "(0)";
  return `(${Array.from(ids).join(",")})`;
}
