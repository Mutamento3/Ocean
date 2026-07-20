function measureCssLength(value: string) {
  const probe = document.createElement("div");
  probe.style.cssText = `height:${value};position:fixed;left:-9999px;top:0;visibility:hidden;width:1px;`;
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.round(height * 100) / 100;
}

function measureSafeInset(edge: "top" | "bottom") {
  const probe = document.createElement("div");
  probe.style.cssText = `padding-${edge}:env(safe-area-inset-${edge}, 0px);position:fixed;left:-9999px;top:0;visibility:hidden;`;
  document.body.appendChild(probe);
  const value = Number.parseFloat(getComputedStyle(probe)[edge === "top" ? "paddingTop" : "paddingBottom"]) || 0;
  probe.remove();
  return Math.round(value * 100) / 100;
}

function roundedRect(element: Element | null) {
  if (!element) return "missing";
  const rect = element.getBoundingClientRect();
  return `${Math.round(rect.top)}..${Math.round(rect.bottom)} (${Math.round(rect.height)})`;
}

export function installSafeAreaDiagnostics() {
  if (new URLSearchParams(window.location.search).get("debug") !== "safearea") return;

  const panel = document.createElement("pre");
  panel.setAttribute("aria-label", "iOS safe-area diagnostics");
  panel.style.cssText = [
    "background:rgba(24,29,43,.9)",
    "border-radius:10px",
    "color:white",
    "font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
    "left:8px",
    "margin:0",
    "max-width:270px",
    "padding:9px 10px",
    "pointer-events:none",
    "position:fixed",
    "top:8px",
    "white-space:pre-wrap",
    "z-index:9999",
  ].join(";");
  document.body.appendChild(panel);

  const render = () => {
    const viewport = window.visualViewport;
    panel.textContent = [
      `standalone media=${window.matchMedia("(display-mode: standalone)").matches} nav=${Boolean((navigator as Navigator & { standalone?: boolean }).standalone)}`,
      `screen ${window.screen.width}x${window.screen.height}`,
      `inner ${window.innerWidth}x${window.innerHeight}`,
      `client ${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
      `visual ${Math.round(viewport?.width ?? 0)}x${Math.round(viewport?.height ?? 0)} top=${Math.round(viewport?.offsetTop ?? 0)}`,
      `100vh=${measureCssLength("100vh")} dvh=${measureCssLength("100dvh")}`,
      `svh=${measureCssLength("100svh")} lvh=${measureCssLength("100lvh")}`,
      `safe top=${measureSafeInset("top")} bottom=${measureSafeInset("bottom")}`,
      `shell ${roundedRect(document.querySelector(".ocean-shell"))}`,
      `nav ${roundedRect(document.querySelector(".room-nav"))}`,
    ].join("\n");
  };

  window.setTimeout(render, 250);
  window.addEventListener("resize", render);
  window.visualViewport?.addEventListener("resize", render);
}
