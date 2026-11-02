// Starts the solver (FastAPI on :8000) and the web app (Next.js on :3000) together.
import { spawn } from "node:child_process";
import path from "node:path";
import { hasVenv, root, solverDir, venvPython } from "./py.mjs";

if (!hasVenv()) {
  console.error("Solver environment missing. Run `npm run setup` first.");
  process.exit(1);
}
const procs = [
  ["solver", venvPython, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"], solverDir],
  ["web", "npm", ["run", "dev"], path.join(root, "web")],
].map(([name, cmd, args, cwd]) => {
  const p = spawn(cmd, args, { cwd, shell: process.platform === "win32" && cmd === "npm", env: process.env });
  const tag = name === "solver" ? "\x1b[35m[solver]\x1b[0m " : "\x1b[36m[web]\x1b[0m    ";
  for (const s of [p.stdout, p.stderr]) s.on("data", (b) => process.stdout.write(b.toString().replace(/^(?=.)/gm, tag)));
  p.on("exit", (code) => {
    console.log(`${tag}exited (${code})`);
    shutdown();
  });
  return p;
});
let done = false;
function shutdown() {
  if (done) return;
  done = true;
  for (const p of procs) if (!p.killed) p.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
console.log("Rota Agent demo starting: open http://localhost:3000 (Ctrl+C to stop)");
