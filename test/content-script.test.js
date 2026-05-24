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
                  <video poster="https://pbs.twimg.com/amplify_video_thumb/123456/img/thumb.jpg">
                    <source src="blob:https://x.com/main-video">
                  </video>
                </article>
                <article id="reply" data-testid="tweet">
                  <div data-testid="User-Name">Reply Author<br>@reply</div>
                  <div data-testid="tweetText">Seedance参考提示词<br>Short visible body.<br>显示更多</div>
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
    await page.evaluate(() => {
      window.__PROMPT_COLLECTOR_X_VIDEOS = [
        {
          url: "https://video.twimg.com/ext_tw_video/123456/pu/vid/720x1280/main.mp4",
          tweetId: "123456",
          poster: "https://pbs.twimg.com/amplify_video_thumb/123456/img/thumb.jpg",
          bitrate: 2176000,
          contentType: "video/mp4"
        }
      ];
      window.__PROMPT_COLLECTOR_X_TWEETS = [
        {
          tweetId: "789",
          author: "@reply",
          text: "Seedance提示词：\n使用 @image1 作为动作分镜参考。完整连续的电影画面。\n【整体风格】\n长评论里折叠后才出现的完整视频提示词。"
        }
      ];
    });
    const scrolledXCapture = await page.evaluate((script) => eval(script), source);

    assert.equal(scrolledXCapture.site, "x");
    assert.equal(scrolledXCapture.author, "Main Author @main");
    assert.match(scrolledXCapture.prompt, /Keep the main post/);
    assert.equal(scrolledXCapture.images.length, 1);
    assert.equal(scrolledXCapture.videos.length, 1);
    assert.match(scrolledXCapture.videos[0].url, /video\.twimg\.com\/ext_tw_video\/123456/);
    assert.match(scrolledXCapture.images[0].url, /pbs\.twimg\.com\/media\/main-post\.svg/);
    assert.equal(scrolledXCapture.candidates.length, 2);
    assert.equal(scrolledXCapture.candidates[0].kind, "main");
    assert.equal(scrolledXCapture.candidates[1].kind, "reply");
    assert.match(scrolledXCapture.candidates[0].promptCandidates[0].text, /Keep the main post/);
    assert.equal(scrolledXCapture.candidates[0].images.length, 2);
    assert.match(scrolledXCapture.candidates[0].images[1].url, /amplify_video_thumb\/123456/);
    assert.equal(scrolledXCapture.candidates[0].videos.length, 1);
    assert.equal(scrolledXCapture.candidates[1].promptCandidates[0].type, "video");
    assert.match(scrolledXCapture.candidates[1].rawText, /长评论里折叠后才出现/);
    assert.match(scrolledXCapture.candidates[1].promptCandidates[0].text, /完整连续的电影画面/);
    assert.equal(scrolledXCapture.candidates[1].images.length, 1);
    assert.match(scrolledXCapture.candidates[1].postUrl, /\/reply\/status\/789/);

    await page.evaluate(() => {
      window.__PROMPT_COLLECTOR_X_TWEETS = [
        {
          tweetId: "789",
          author: "@reply",
          text: "故事板提示词，拆解在评论区👇 https://t.co/example\n这行只是正文，不应该被当成分镜提示词。"
        }
      ];
    });
    const noFalseStoryboard = await page.evaluate((script) => eval(script), source);
    assert.equal(noFalseStoryboard.candidates[1].promptCandidates[0].type, "prompt");
    assert.match(noFalseStoryboard.candidates[1].promptCandidates[0].text, /故事板提示词，拆解在评论区/);

    await page.evaluate(() => {
      window.__PROMPT_COLLECTOR_X_TWEETS = [
        {
          tweetId: "789",
          author: "@reply",
          text: "《太极推手四两拨千斤》故事板提示词：\n01 | 醉步入场\n中远景 / 全身镜头，主角站在酒馆外石板地上。"
        }
      ];
    });
    const storyboardCapture = await page.evaluate((script) => eval(script), source);
    assert.equal(storyboardCapture.candidates[1].promptCandidates[0].type, "storyboard");
    assert.match(storyboardCapture.candidates[1].promptCandidates[0].text, /01 \\| 醉步入场/);

    await page.evaluate(() => {
      window.__PROMPT_COLLECTOR_X_VIDEOS = [];
      const originalGetEntriesByType = performance.getEntriesByType.bind(performance);
      performance.getEntriesByType = (type) => type === "resource"
        ? [{ name: "https://video.twimg.com/ext_tw_video/999999/pu/vid/720x1280/fallback.mp4?tag=12" }]
        : originalGetEntriesByType(type);
    });
    const performanceVideoCapture = await page.evaluate((script) => eval(script), source);
    assert.equal(performanceVideoCapture.videos.length, 1);
    assert.match(performanceVideoCapture.videos[0].url, /fallback\.mp4/);
    assert.equal(performanceVideoCapture.candidates[0].videos.length, 1);

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
