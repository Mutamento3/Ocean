import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const projectDir = resolve(process.env.CO_READING_PROJECT_DIR || "../co-reading-mcp-main");
const entry = join(projectDir, "src", "http.js");

if (!existsSync(entry)) {
  throw new Error(`Co-Reading entry was not found: ${entry}`);
}

const child = spawn(process.execPath, [entry], {
  cwd: projectDir,
  env: {
    ...process.env,
    READING_HTTP_HOST: process.env.READING_HTTP_HOST || "127.0.0.1",
    READING_HTTP_PORT: process.env.READING_HTTP_PORT || "8788",
    READING_HTTP_STDIO: "0",
  },
  stdio: "inherit",
});

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}
