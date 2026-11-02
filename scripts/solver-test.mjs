import { spawnSync } from "node:child_process";
import { solverDir, venvPython } from "./py.mjs";
const r = spawnSync(venvPython, ["-m", "pytest", "-q"], { cwd: solverDir, stdio: "inherit" });
process.exit(r.status ?? 1);
