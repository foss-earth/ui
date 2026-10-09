import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as diagnostics from "./index.js";

/**
 * The packages a module loads with everything it imports statically, each with the chain of
 * modules that reaches it first. `import type` and `export type` load nothing; an import that
 * names only types still loads its module, as `verbatimModuleSyntax` keeps it. A dynamic
 * `import()` loads later, and an import with a query brings a string or a chunk of its own, so
 * both are left out.
 */
function packagesLoadedBy(entry: string): Map<string, string[]> {
  const reachedFrom = new Map<string, string | null>([[entry, null]]);
  const packages = new Map<string, string[]>();
  const chain = (file: string): string[] => {
    const files: string[] = [];
    for (let at: string | null | undefined = file; at; at = reachedFrom.get(at)) files.unshift(relative(".", at));
    return files;
  };
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of source.statements) {
      const specifier = ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly ? statement.moduleSpecifier
        : ts.isExportDeclaration(statement) && !statement.isTypeOnly ? statement.moduleSpecifier : undefined;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const name = specifier.text;
      if (name.includes("?")) continue; // `?raw`, `?url` and `?worker` give a string or a chunk of its own
      if (!name.startsWith(".")) {
        const packageName = name.split("/").slice(0, name.startsWith("@") ? 2 : 1).join("/");
        if (!packages.has(packageName)) packages.set(packageName, chain(file));
        continue;
      }
      const base = join(dirname(file), name).replace(/\.js$/, "");
      const target = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ending) => base + ending)
        .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      if (!target) throw new Error(`${file} imports ${name}, which is not a file`);
      if (/\.tsx?$/.test(target) && !reachedFrom.has(target)) {
        reachedFrom.set(target, file);
        queue.push(target);
      }
    }
  }
  return packages;
}

// Original heavy-drawing positive control belongs to Renderer; this owner
// retains the no-globe diagnostic boundary with its actual public factory.
const ENGINE = ["@babylonjs/core", "@babylonjs/loaders", "3d-tiles-renderer"];

describe("@foss-earth/ui/diagnostics", () => {
  it("does not load the engine, so a page that shows no globe can import it", () => {
    expect(Object.keys(diagnostics)).toContain("createDiagnostics");
    const loaded = packagesLoadedBy(join("src", "diagnostics", "index.ts"));
    expect(Object.fromEntries([...loaded].filter(([name]) => ENGINE.includes(name)))).toEqual({});
  });

});
