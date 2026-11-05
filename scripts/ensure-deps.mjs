// Runs before `npm run dev` and `npm run build` (and so before `tauri dev`
// and `tauri build`). If package-lock.json has changed since the last install,
// for example after a pull that added a dependency, install first instead of
// failing with "Failed to resolve import".
import { existsSync, statSync, utimesSync } from "node:fs";
import { spawnSync } from "node:child_process";

const lock = "package-lock.json";
// npm writes this copy of the lockfile into node_modules on every install.
const installed = "node_modules/.package-lock.json";

const stale = !existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs;
if (stale) {
  console.log("Dependencies changed since the last install. Running npm install…");
  const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  // npm may leave the copy untouched when nothing needed installing; mark it
  // current so the next run doesn't install again.
  if (existsSync(installed)) {
    const now = new Date();
    utimesSync(installed, now, now);
  }
}
