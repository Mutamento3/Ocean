export function registerOceanServiceWorker() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  document.documentElement.classList.toggle("ocean-pwa-standalone", standalone);

  const localPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";

  if (localPreview) {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
    }
    if ("caches" in window) {
      void window.caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("ocean-")).map((key) => window.caches.delete(key))),
      );
    }
    return;
  }

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    const baseUrl = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register(`${baseUrl}sw.js`, { scope: baseUrl, updateViaCache: "none" }).then((registration) => {
        const checkForUpdate = () => { void registration.update().catch(() => undefined); };
        checkForUpdate();
        window.addEventListener("focus", checkForUpdate);
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });
      });
    });
  }
}
