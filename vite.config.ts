import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

/**
 * KaTeX's stylesheet offers every math font as woff2, woff and ttf. Every web
 * view Margin runs in (WebKit on macOS and Linux, WebView2 on Windows) loads
 * woff2, so the other two would only add about 800 kB to the app.
 */
function katexWoff2Only(): Plugin {
  return {
    name: "katex-woff2-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]katex[\\/]dist[\\/]katex(\.min)?\.css$/.test(id.split("?")[0])) return null;
      return code.replace(/,\s*url\([^)]*\.(woff|ttf)\)\s*format\(["'](woff|truetype)["']\)/g, "");
    },
  };
}

/**
 * pdf.js needs a few data files at run time: character maps for PDFs in
 * Chinese, Japanese and Korean, the 14 standard fonts for PDFs that don't
 * embed theirs, and decoders for scanned images. They are served from
 * /pdfjs/ in development and copied there in the build, so PDFs render
 * offline. The JavaScript engine for PDF scripts is left out: Margin doesn't
 * run them.
 */
function pdfjsData(): Plugin {
  const root = path.resolve("node_modules/pdfjs-dist");
  const dirs = ["cmaps", "standard_fonts", "wasm", "iccs"];
  const wanted = (dir: string, name: string) => dirs.includes(dir) && !name.startsWith("quickjs");
  return {
    name: "pdfjs-data",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]).replace(/^\/+/, "");
        const file = path.join(root, rel);
        const [dir, name] = rel.split("/");
        if (!name || !wanted(dir, name) || !file.startsWith(root + path.sep) || !fs.existsSync(file)) return next();
        res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const dir of dirs) {
        for (const name of fs.readdirSync(path.join(root, dir))) {
          if (!wanted(dir, name)) continue;
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${name}`, source: fs.readFileSync(path.join(root, dir, name)) });
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), katexWoff2Only(), pdfjsData()],
  // Vite options tailored for Tauri development.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
