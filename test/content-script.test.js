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

    await page.route("https://x.com/**", async (route) => {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html>
          <html>
            <head>
              <title>Main X Post</title>
              <style>
                body { margin: 0; }
                article { padding: 24px; }
                #main-post { height: 1400px; }
                #main-post img { display: block; width: 320px; height: 240px; margin-top: 560px; }
                #reply { height: 180px; }
              </style>
            </head>
            <body>
              <main>
                <article id="main-post" data-testid="tweet">
                  <div data-testid="User-Name">Main Author<br>@main</div>
                  <div data-testid="tweetText">Prompt: Keep the main post when its top is above the viewport.</div>
                  <a href="/main/status/123456"><time datetime="2026-05-22T10:00:00.000Z"></time></a>
                  <div data-testid="tweetPhoto">
                    <img src="https://pbs.twimg.com/media/main-post.svg?format=svg&name=medium" alt="main result">
                  </div>
                </article>
                <article id="reply" data-testid="tweet">
                  <div data-testid="User-Name">Reply Author<br>@reply</div>
                  <div data-testid="tweetText">完整提示词：Reply prompt body.</div>
                  <a href="/reply/status/789"><time datetime="2026-05-22T10:03:00.000Z"></time></a>
                  <div data-testid="tweetPhoto">
                    <img src="https://pbs.twimg.com/media/reply-post.svg?format=svg&name=small" alt="reply result">
                  </div>
                  <img src="https://abs.twimg.com/emoji/v2/svg/1f4d2.svg" alt="emoji">
                </article>
              </main>
            </body>
          </html>`
      });
    });
    await page.route("https://pbs.twimg.com/media/**", async (route) => {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
          <rect width="320" height="240" fill="#ced7ee"/>
        </svg>`
      });
    });
    await page.goto("https://x.com/main/status/123456");
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 620));
    const scrolledXCapture = await page.evaluate((script) => eval(script), source);

    assert.equal(scrolledXCapture.site, "x");
    assert.equal(scrolledXCapture.author, "Main Author @main");
    assert.match(scrolledXCapture.prompt, /Keep the main post/);
    assert.equal(scrolledXCapture.images.length, 1);
    assert.match(scrolledXCapture.images[0].url, /pbs\.twimg\.com\/media\/main-post\.svg/);
    assert.equal(scrolledXCapture.candidates.length, 2);
    assert.equal(scrolledXCapture.candidates[0].kind, "main");
    assert.equal(scrolledXCapture.candidates[1].kind, "reply");
    assert.match(scrolledXCapture.candidates[0].promptCandidates[0].text, /Keep the main post/);
    assert.match(scrolledXCapture.candidates[1].promptCandidates[0].text, /Reply prompt body/);
    assert.equal(scrolledXCapture.candidates[1].images.length, 1);
    assert.match(scrolledXCapture.candidates[1].postUrl, /\/reply\/status\/789/);

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
