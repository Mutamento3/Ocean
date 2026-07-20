const baseUrl = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** Resolve public assets inside both root-hosted previews and sub-path PWAs. */
export function assetPath(path: string) {
  return `${baseUrl}${path.replace(/^\/+/, "")}`;
}
