import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const contentScriptPath = path.join(root, "extension", "content-script.js");

function startFixtureServer() {
  const promptHtml = `<!doctype html>
    <html>
      <head><title>Prompt Fixture</title></head>
      <body>
        <main>
          <article>
            <h1>Prompt fixture page</h1>
            <p>Prompt:</p>
            <p>Create a cozy editorial photo of a writing desk with warm side light.</p>
            <img src="/image.svg" alt="generated desk image">
            <video controls><source src="/clip.mp4" type="video/mp4"></video>
            <a href="https://example.com/source">source</a>
          </article>
        </main>
      </body>
    </html>`;
  const plainHtml = `<!doctype html>
    <html>
      <head><title>Plain Fixture</title></head>
      <body>
        <main>
          <article>
            <p>太疯狂了！</p>
            <p>商业 · 金融 趋势 Bitcoin</p>
          </article>
        </main>
      </body>
    </html>`;

  const server = http.createServer((req, res) => {
    if (req.url === "/image.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
        <rect width="320" height="240" fill="#f2d9b3"/>
      </svg>`);
      return;
    }
    if (req.url === "/clip.mp4") {
      res.writeHead(200, { "content-type": "video/mp4" });
      res.end("");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(req.url === "/plain" ? plainHtml : promptHtml);
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/post` });
    });
  });
}

async function main() {
  const fixture = await startFixtureServer();
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage();
    await page.goto(fixture.url);
    await page.waitForLoadState("networkidle");

    const source = await readFile(contentScriptPath, "utf8");
    const capture = await page.evaluate((script) => eval(script), source);

    assert.match(capture.title, /Create a cozy editorial photo/);
    assert.equal(capture.pageTitle, "Prompt Fixture");
    assert.equal(capture.sourceUrl, fixture.url);
    assert.equal(capture.site, "generic");
    assert.match(capture.prompt, /cozy editorial photo/);
    assert.equal(capture.images.length, 1);
    assert.match(capture.images[0].url, /\/image\.svg$/);
    assert.equal(capture.images[0].alt, "generated desk image");
    assert.equal(capture.videos.length, 1);
    assert.match(capture.videos[0].url, /\/clip\.mp4$/);
    assert(capture.links.includes("https://example.com/source"));
    assert.match(capture.rawText, /Prompt fixture page/);

    await page.goto(fixture.url.replace("/post", "/plain"));
    await page.waitForLoadState("networkidle");
    const plainCapture = await page.evaluate((script) => eval(script), source);
    assert.equal(plainCapture.prompt, "");
    assert.match(plainCapture.title, /太疯狂了/);

    console.log("content script browser extraction test passed");
  } finally {
    await browser.close();
    fixture.server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
