import { registerHooks } from "node:module";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = realpathSync(path.dirname(fileURLToPath(import.meta.url))) + path.sep;
const peerPath = /[/\\]node_modules[/\\](?:react(?:-dom)?|scheduler|@babylonjs[/\\][^/\\]+|@foss-earth[/\\](?!ui(?:[/\\]|$))[^/\\]+)(?:[/\\]|$)/;
registerHooks({ resolve(specifier, context, nextResolve) {
  const resolved = nextResolve(specifier, context);
  if (resolved.url.startsWith("node:")) return resolved;
  if (!resolved.url.startsWith("file:")) throw new Error("UNSUPPORTED_CONSUMER_MODULE_PROTOCOL: " + specifier);
  const filename = realpathSync(fileURLToPath(resolved.url));
  if (!filename.startsWith(root)) throw new Error("Dependency escaped installed consumer: " + specifier);
  if (process.env.CONSUMER_FORBID_PEERS === "1" && peerPath.test(filename)) throw new Error("Dependency escaped pure-root authority (PURE_IMPORTED_PEER): " + specifier);
  return resolved;
} });
