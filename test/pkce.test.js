import assert from "node:assert/strict";
import { createPkcePair, createState, sha256Base64Url } from "../extension/lib/pkce.js";
import { REQUIRED_SCOPES, STANDARD_FIELDS } from "../extension/lib/feishu-config.js";

async function main() {
  const pair = await createPkcePair();
  assert.match(pair.verifier, /^[A-Za-z0-9\-._~]{64}$/);
  assert.match(pair.challenge, /^[A-Za-z0-9\-_]+$/);
  assert.equal(pair.method, "S256");
  assert.equal(pair.challenge, await sha256Base64Url(pair.verifier));

  const state = createState();
  assert.match(state, /^[A-Za-z0-9\-._~]{32}$/);

  assert(REQUIRED_SCOPES.includes("offline_access"));
  assert(REQUIRED_SCOPES.includes("wiki:node:read"));
  assert(REQUIRED_SCOPES.includes("bitable:app"));
  assert(REQUIRED_SCOPES.includes("base:field:read"));
  assert(REQUIRED_SCOPES.includes("base:record:create"));
  assert.deepEqual(
    STANDARD_FIELDS.map((field) => field.key),
    ["title", "prompt", "sourceUrl", "pageTitle", "author", "images", "capturedAt", "site", "rawJson"]
  );

  console.log("pkce/config unit test passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
