import {copyFileSync, mkdirSync, readdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

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
