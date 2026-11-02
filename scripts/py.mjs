import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const solverDir = path.join(root, "solver");
export const venvPython = process.platform === "win32" ? path.join(solverDir, ".venv", "Scripts", "python.exe") : path.join(solverDir, ".venv", "bin", "python");
export const systemPython = process.platform === "win32" ? "python" : "python3";
export const hasVenv = () => existsSync(venvPython);
