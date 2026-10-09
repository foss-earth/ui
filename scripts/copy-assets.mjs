import { copyFileSync, mkdirSync } from "node:fs";

for (const path of ["styles/ui.css", "styles/cacheSection.css", "styles/meshInspector.css", "styles/dial.css", "styles/gameLog.css", "styles/status.css", "windowing/styles/windowing.css"]) {
  const target = new URL(`../dist/${path}`, import.meta.url);
  mkdirSync(new URL("./", target), { recursive: true });
  copyFileSync(new URL(`../src/${path}`, import.meta.url), target);
}
