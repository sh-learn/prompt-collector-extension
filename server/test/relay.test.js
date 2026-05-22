import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(import.meta.dirname, "..");
const fakeCli = path.join(root, "test", "fixtures", "fake-lark-cli");

async function waitForHealth(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Retry until the child server has bound its port.
    }
    await delay(100);
  }
  throw new Error("relay did not become healthy");
}

function startImageServer() {
  const server = http.createServer((req, res) => {
    if (req.url === "/image.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/image.jpg` });
    });
  });
}

async function main() {
  await chmod(fakeCli, 0o755);
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "prompt-relay-test-"));
  const logPath = path.join(tmpDir, "fake-cli.log");
  const relayPort = 18787;
  const image = await startImageServer();

  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(relayPort),
      STORAGE_BACKEND: "lark-cli",
      LARK_CLI_BIN: fakeCli,
      FAKE_LARK_CLI_LOG: logPath,
      LARK_WIKI_TOKEN: "wiki_fake_token",
      LARK_TABLE_ID: "tbl_fake",
      FIELD_TITLE: "标题",
      FIELD_PROMPT: "Prompt",
      FIELD_SOURCE_URL: "来源链接",
      FIELD_PAGE_TITLE: "页面标题",
      FIELD_AUTHOR: "作者",
      FIELD_IMAGES: "图片",
      FIELD_CAPTURED_AT: "采集时间",
      FIELD_RAW_JSON: "原始数据"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForHealth(relayPort);

    const capture = {
      title: "测试提示词",
      prompt: "Create a warm editorial image of a desk setup.",
      sourceUrl: "https://x.com/example/status/1",
      pageTitle: "Example Post",
      author: "Example Author",
      images: [{ url: image.url, alt: "fixture image" }],
      links: ["https://example.com"],
      capturedAt: "2026-05-21T08:30:00.000Z",
      extractor: "test"
    };

    const response = await fetch(`http://127.0.0.1:${relayPort}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(capture)
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.recordId, "rec_fake_prompt");

    const calls = (await readFile(logPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].slice(0, 3), ["wiki", "spaces", "get_node"]);
    assert.deepEqual(calls[1].slice(0, 2), ["base", "+record-upsert"]);
    assert.deepEqual(calls[2].slice(0, 2), ["base", "+record-upload-attachment"]);
    assert(calls[1].includes("--base-token"));
    assert(calls[1].includes("app_fake_base_token"));
    assert(calls[2].includes("--record-id"));
    assert(calls[2].includes("rec_fake_prompt"));

    console.log("relay lark-cli integration test passed");
  } finally {
    child.kill();
    image.server.close();
    await rm(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
