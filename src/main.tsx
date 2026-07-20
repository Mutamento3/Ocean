import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/eb-garamond/latin-400.css";
import "@fontsource/eb-garamond/latin-700.css";
import App from "./App";
import "./styles.css";
import "./settings.css";
import "./rooms.css";
import "./home-data.css";
import "./typography.css";
import "./home-fidelity.css";
import "./living-room.css";
import "./study-room.css";
import "./leisure-room.css";
import "./palace-room.css";
import "./bottom-sheet.css";
import "./preview.css";
import "./access.css";
import { registerOceanServiceWorker } from "./pwa";
import { installPreviewCalibration } from "./preview";
import { installSafeAreaDiagnostics } from "./safe-area-diagnostics";
import { OceanAccessGate } from "./components/OceanAccessGate";

registerOceanServiceWorker();
installPreviewCalibration();
installSafeAreaDiagnostics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OceanAccessGate><App /></OceanAccessGate>
  </StrictMode>,
);
