import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const root = realpathSync(path.dirname(fileURLToPath(import.meta.url))) + path.sep;
const configFile = process.argv[2];
assert.ok(configFile);
const config = ts.readConfigFile(configFile, ts.sys.readFile);
assert.ok(!config.error);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
assert.equal(parsed.errors.length, 0);
const program = ts.createProgram(parsed.fileNames, parsed.options);
// Includes default compiler libs, ambient declarations, referenced files and
// transitive imports; there is no ancestor-library exception.
for (const file of program.getSourceFiles()) assert.ok(realpathSync(file.fileName).startsWith(root), `DECLARATION_OUTSIDE_WORKSPACE: ${file.fileName}`);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n" }));
process.stdout.write("Every public compiler/declaration source remains in the installed pinned workspace.\n");
