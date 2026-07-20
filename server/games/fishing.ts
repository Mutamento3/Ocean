import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PYTHON_RUNNER = [
  "import importlib.util, sys",
  "path, command = sys.argv[1], sys.argv[2]",
  "spec = importlib.util.spec_from_file_location('ocean_fishing', path)",
  "module = importlib.util.module_from_spec(spec)",
  "spec.loader.exec_module(module)",
  "print(module.cmd(command))",
].join("\n");

export class FishingGameConnector {
  private readonly scriptPath: string;

  constructor(scriptPath: string, private readonly pythonBin = "python") {
    this.scriptPath = resolve(scriptPath);
  }

  async play(command: string) {
    const normalized = command.trim();
    if (!normalized || normalized.length > 300) throw new Error("Fishing command must contain 1-300 characters");
    await access(this.scriptPath);
    const { stdout } = await execFileAsync(this.pythonBin, ["-c", PYTHON_RUNNER, this.scriptPath, normalized], {
      cwd: dirname(this.scriptPath),
      encoding: "utf8",
      env: { ...process.env, PYTHONUTF8: "1" },
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
    });
    return stdout.trim();
  }

  async health() {
    await access(this.scriptPath);
    return {
      status: "ok" as const,
      provider: "tutusagi-ai-fishing-game",
      mode: "external-noncommercial-engine" as const,
      commands: true,
      persistentSave: true,
    };
  }
}

export function createFishingGameConnectorFromEnv() {
  const scriptPath = process.env.FISHING_GAME_SCRIPT_PATH?.trim();
  if (!scriptPath) return null;
  return new FishingGameConnector(scriptPath, process.env.FISHING_PYTHON_BIN?.trim() || "python");
}
