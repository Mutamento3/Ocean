interface PortableOceanData {
  schemaVersion: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

const isSensitiveKey = (key: string) => /(api.?key|token|secret|credential)/i.test(key);

export function downloadOceanData() {
  const data: Record<string, unknown> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith("ocean:") || isSensitiveKey(key)) continue;
    try { data[key] = JSON.parse(window.localStorage.getItem(key) ?? "null"); }
    catch { data[key] = window.localStorage.getItem(key); }
  }
  const portable: PortableOceanData = { schemaVersion: 1, exportedAt: new Date().toISOString(), data };
  const url = URL.createObjectURL(new Blob([JSON.stringify(portable, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ocean-backup-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  return Object.keys(data).length;
}

export async function importOceanData(file: File) {
  const parsed = JSON.parse(await file.text()) as Partial<PortableOceanData>;
  if (parsed.schemaVersion !== 1 || !parsed.data || typeof parsed.data !== "object") throw new Error("invalid_backup");
  let imported = 0;
  for (const [key, value] of Object.entries(parsed.data)) {
    if (!key.startsWith("ocean:") || isSensitiveKey(key)) continue;
    window.localStorage.setItem(key, JSON.stringify(value));
    imported += 1;
  }
  return imported;
}

export async function clearLocalOceanData() {
  const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => Boolean(key?.startsWith("ocean:")));
  keys.forEach((key) => window.localStorage.removeItem(key));
  if ("caches" in window) {
    const cacheKeys = await window.caches.keys();
    await Promise.all(cacheKeys.filter((key) => key.startsWith("ocean-")).map((key) => window.caches.delete(key)));
  }
  return keys.length;
}
