export function installPreviewCalibration() {
  const requested = new URLSearchParams(window.location.search).get("preview");
  const localPreview = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  const phonePreview = localPreview && requested !== "responsive";
  document.documentElement.dataset.oceanPreview = phonePreview ? "phone" : "responsive";
  document.documentElement.style.setProperty("--ocean-preview-scale", "1");
}
