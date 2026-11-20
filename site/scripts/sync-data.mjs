import {copyFileSync, mkdirSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const source = join(root, "data");
const destination = join(here, "..", "docs", "data");

mkdirSync(destination, {recursive: true});
let copied = 0;
for (const name of readdirSync(source)) {
  if (name.endsWith(".csv") || name.endsWith(".json")) {
    copyFileSync(join(source, name), join(destination, name));
    copied++;
  }
}
console.log(`copied ${copied} data files to ${destination}`);

// The Ask panel loads WebLLM in a worker; bundle it as a static file so the
// page itself stays small and the engine never runs on the main thread.
await build({
  entryPoints: [join(here, "..", "docs", "components", "llm-worker.js")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  outfile: join(destination, "llm-worker.worker")
});
console.log("built docs/data/llm-worker.worker");
