import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "build"], {
  env: { ...process.env, VITE_OCEAN_BASE_PATH: "/ocean/", VITE_OCEAN_GATEWAY_URL: "/ocean-api" },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
