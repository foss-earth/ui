import assert from "node:assert/strict";
await assert.rejects(import("../outside.mjs"), /escaped installed consumer/);
await assert.rejects(import("@foss-earth/forbidden-owner-fixture"), /escaped installed consumer/);
await assert.rejects(import("data:text/javascript,export const unexpected=true"), /UNSUPPORTED_CONSUMER_MODULE_PROTOCOL/);
process.stdout.write("Runtime guard rejected ancestor file and package resolution.\n");
