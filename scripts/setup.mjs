// One-time install: Python venv for the solver + npm packages for the web app.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { hasVenv, root, solverDir, systemPython, venvPython } from "./py.mjs";

const run = (cmd, args, cwd) => {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!hasVenv()) run(systemPython, ["-m", "venv", ".venv"], solverDir);
run(venvPython, ["-m", "pip", "install", "-q", "-r", "requirements-dev.txt"], solverDir);
run("npm", ["install"], path.join(root, "web"));
console.log("\nDone. Start the demo with:  npm run demo");
