import assert from "node:assert/strict";
// These modules exist: the harness first imports the same React/feature probes
// with peer poison disabled. Missing dependencies cannot pass this control.
await assert.rejects(import("react"), /PURE_IMPORTED_PEER/);
await assert.rejects(import("react-dom"), /PURE_IMPORTED_PEER/);
await assert.rejects(import("./control/node_modules/@foss-earth/engine/probe.mjs"), /PURE_IMPORTED_PEER/);
process.stdout.write("Pure-root guard rejected installed React and supplied feature-shaped fixture.\n");
