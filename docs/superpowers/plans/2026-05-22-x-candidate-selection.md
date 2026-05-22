# X Candidate Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user choose prompt and image candidates from an X main post and currently loaded replies before saving one merged Feishu record.

**Architecture:** Extend the page extractor so X captures include grouped post candidates while preserving the existing flat capture fallback. Render X candidate cards in the existing popup, derive a selected flat capture from checkbox state, and keep the background Feishu sync path unchanged by sending only selected prompt text and media in the final capture payload.

**Tech Stack:** Chrome MV3 extension JavaScript, DOM extraction script, popup HTML/CSS/JS, Playwright browser extraction tests, Node test scripts.

---

## File Structure

- Modify `extension/content-script.js` to identify the X main status article, build per-post prompt and image candidate groups, and keep flat capture fields compatible with the current popup and sync pipeline.
- Modify `test/content-script.test.js` to cover scrolled main-post selection, loaded reply candidates, X media filtering, and generic fallback behavior.
- Modify `extension/popup.html` to add a candidate-selection region above the existing dynamic Feishu field form.
- Modify `extension/popup.css` to style compact post candidate cards, selectable prompt rows, and thumbnail checkbox states inside the right-side panel.
- Create `extension/lib/candidate-selection.js` for pure selection defaults, selected prompt merging, and selected-media flattening shared by popup code and unit tests.
- Modify `extension/popup.js` to render candidates, maintain selection state, merge selected prompt text, update attachment previews, and save only selected images.
- Modify `README.md` only if final user-facing collection behavior needs a note after the code is verified.

### Task 1: Build X Post Candidate Extraction

**Files:**
- Modify: `extension/content-script.js`
- Test: `test/content-script.test.js`

- [ ] **Step 1: Write failing candidate extraction assertions**

Extend the X fixture in `test/content-script.test.js` so it includes:

```html
<article id="main-post" data-testid="tweet">
  <div data-testid="User-Name">Main Author<br>@main</div>
  <div data-testid="tweetText">Prompt: Keep the main post when its top is above the viewport.</div>
  <a href="/main/status/123456"><time datetime="2026-05-22T10:00:00.000Z"></time></a>
  <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/main-post.svg?format=svg&name=medium" alt="main result"></div>
</article>
<article id="reply" data-testid="tweet">
  <div data-testid="User-Name">Reply Author<br>@reply</div>
  <div data-testid="tweetText">完整提示词：Reply prompt body.</div>
  <a href="/reply/status/789"><time datetime="2026-05-22T10:03:00.000Z"></time></a>
  <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/reply-post.svg?format=svg&name=small" alt="reply result"></div>
  <img src="https://abs.twimg.com/emoji/v2/svg/1f4d2.svg" alt="emoji">
</article>
```

Assert:

```js
assert.equal(scrolledXCapture.candidates.length, 2);
assert.equal(scrolledXCapture.candidates[0].kind, "main");
assert.equal(scrolledXCapture.candidates[1].kind, "reply");
assert.match(scrolledXCapture.candidates[0].promptCandidates[0].text, /Keep the main post/);
assert.match(scrolledXCapture.candidates[1].promptCandidates[0].text, /Reply prompt body/);
assert.equal(scrolledXCapture.candidates[1].images.length, 1);
assert.match(scrolledXCapture.candidates[1].postUrl, /\/reply\/status\/789/);
```

- [ ] **Step 2: Run the extraction test and verify it fails**

Run:

```bash
npm run test:content
```

Expected: FAIL because `candidates` does not exist or replies are not grouped.

- [ ] **Step 3: Implement candidate extraction in `content-script.js`**

Add focused helpers:

```js
function tweetPostUrl(article) {
  const timeLink = article.querySelector("time")?.closest("a[href]");
  return timeLink ? new URL(timeLink.href, location.href).href : location.href;
}

function promptCandidates(rawText, idPrefix) {
  const marked = extractPromptFromText(rawText);
  const text = marked || rawText.trim();
  return text ? [{ id: `${idPrefix}-prompt-1`, text, reason: marked ? "marker" : "post_text" }] : [];
}

function xArticleImages(article) {
  return extractImages(article)
    .filter((image) => image.url.includes("pbs.twimg.com/media/"));
}
```

Build `candidates` from loaded X articles with main candidate first:

```js
function xCandidates(mainArticle) {
  const articles = [...document.querySelectorAll("article[data-testid='tweet']")];
  return uniqBy([mainArticle, ...articles].filter(Boolean), (article) => article)
    .map((article, index) => {
      const tweet = extractTweet(article);
      const rawText = tweet?.prompt || textOf(article);
      const kind = index === 0 ? "main" : "reply";
      return {
        id: `x-post-${index + 1}`,
        kind,
        author: tweet?.author || "",
        postUrl: tweetPostUrl(article),
        rawText,
        promptCandidates: promptCandidates(rawText, `x-post-${index + 1}`),
        images: xArticleImages(article)
      };
    })
    .filter((candidate) => candidate.rawText || candidate.images.length);
}
```

Return `candidates` only for X captures and continue returning existing `images`, `prompt`, `author`, and generic capture fields.

- [ ] **Step 4: Run the extraction test and verify it passes**

Run:

```bash
npm run test:content
```

Expected: PASS.

- [ ] **Step 5: Commit extraction work**

```bash
git add extension/content-script.js test/content-script.test.js
git commit -m "Add X post capture candidates"
```

### Task 2: Add Candidate Selection Markup and State

**Files:**
- Create: `extension/lib/candidate-selection.js`
- Modify: `extension/popup.html`
- Modify: `extension/popup.css`
- Modify: `extension/popup.js`
- Test: `test/popup-candidates.test.js`

- [ ] **Step 1: Add failing candidate-selection helper coverage**

Add a Node test file `test/popup-candidates.test.js` that imports wished-for pure helpers:

```js
import { selectedCandidateImages, selectedCandidatePrompt } from "../extension/lib/candidate-selection.js";
```

Assert:

```js
assert.match(selectedCandidatePrompt(candidates, selection), /\[主帖 Main Author @main\]/);
assert.match(selectedCandidatePrompt(candidates, selection), /\[评论 Reply Author @reply\]/);
assert.deepEqual(selectedCandidateImages(candidates, selection).map((image) => image.url), ["main.png", "reply.png"]);
```

Update `package.json`:

```json
"test:unit": "node test/pkce.test.js && node test/popup-candidates.test.js"
```

- [ ] **Step 2: Run unit tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `extension/lib/candidate-selection.js` does not exist yet.

- [ ] **Step 3: Add popup candidate region**

Insert in `extension/popup.html` before `#fieldForm`:

```html
<section id="candidatePicker" class="candidate-picker" hidden>
  <div class="candidate-heading">从帖子中选择</div>
  <div id="candidateList" class="candidate-list"></div>
</section>
```

Add `candidatePicker` and `candidateList` element bindings in `popup.js`.

- [ ] **Step 4: Implement pure selection helpers and render functions**

Create `extension/lib/candidate-selection.js`:

```js
export function candidateLabel(candidate) {
  return `${candidate.kind === "main" ? "主帖" : "评论"} ${candidate.author || ""}`.trim();
}

export function selectedCandidatePrompt(candidates, selection) {
  return candidates.flatMap((candidate) => {
    const prompts = candidate.promptCandidates.filter((item) => selection.prompts[item.id]);
    return prompts.map((item) => `[${candidateLabel(candidate)}]\n${item.text}`);
  }).join("\n\n");
}

export function selectedCandidateImages(candidates, selection) {
  return candidates.flatMap((candidate) => candidate.images.filter((image) => selection.images[image.id]));
}
```

Import these helpers in `popup.js`. Add popup selection state:

```js
selection: { prompts: {}, images: {} }
```

Default main candidate prompts and images to `true`, replies to `false`. Render each candidate as a card with prompt checkboxes and image thumbnail checkboxes. On checkbox change, update state and rerender selected field defaults.

- [ ] **Step 5: Style compact candidate cards**

Use stable panel sizing in `popup.css`:

```css
.candidate-list { display:grid; gap:8px; margin-top:8px; }
.candidate-card { display:grid; gap:8px; padding:10px; border:1px solid #e4e7ec; border-radius:8px; background:#f8fafc; }
.candidate-images { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; }
.candidate-image img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:6px; }
```

Keep all card radii at `8px` or less.

- [ ] **Step 6: Verify popup helper unit tests pass**

Run:

```bash
npm run test:unit
```

Expected: PASS.

- [ ] **Step 7: Commit popup selection surface**

```bash
git add extension/lib/candidate-selection.js extension/popup.html extension/popup.css extension/popup.js test/popup-candidates.test.js package.json
git commit -m "Render X candidate selector in popup"
```

### Task 3: Feed Selected Candidates into Fields and Save Payload

**Files:**
- Modify: `extension/lib/candidate-selection.js`
- Modify: `extension/popup.js`
- Test: `test/popup-candidates.test.js`

- [ ] **Step 1: Write failing selected capture test**

Add:

```js
const payload = selectedCapture(capture, selection);
assert.match(payload.prompt, /Reply prompt body/);
assert.equal(payload.images.length, 2);
assert.equal(payload.rawSelection.selectedCandidateIds.length, 2);
assert.equal(payload.videos.length, 0);
```

- [ ] **Step 2: Run unit tests and verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL because save payload does not derive selected candidate material.

- [ ] **Step 3: Implement selected capture transformation**

Implement in `extension/lib/candidate-selection.js`:

```js
export function selectedCapture(capture, selection) {
  if (!capture.candidates?.length) return capture;
  const selectedImages = selectedCandidateImages(capture.candidates, selection);
  const prompt = selectedCandidatePrompt(capture.candidates, selection);
  return {
    ...capture,
    prompt,
    images: selectedImages,
    rawSelection: {
      selectedCandidateIds: capture.candidates
        .filter((candidate) =>
          candidate.promptCandidates.some((item) => selection.prompts[item.id]) ||
          candidate.images.some((image) => selection.images[image.id])
        )
        .map((candidate) => candidate.id)
    }
  };
}
```

Call it when rendering field defaults and when building the save payload:

```js
const payload = {
  ...selectedCapture(state.capture, state.selection),
  targetTableId: els.tableSelect.value,
  fieldValues: collectFieldValues()
};
```

If selection changes after field render, preserve explicitly edited field values but refresh inferred prompt and attachment counts when those fields have not been edited.

- [ ] **Step 4: Run unit and browser extraction tests**

Run:

```bash
npm run test:unit
npm run test:content
```

Expected: PASS.

- [ ] **Step 5: Commit selected save payload**

```bash
git add extension/lib/candidate-selection.js extension/popup.js test/popup-candidates.test.js
git commit -m "Save selected X candidates"
```

### Task 4: Verify Extension Behavior and Document Limits

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README collection behavior**

Add a limitation or usage note:

```md
- 在 X 帖子页，插件会展示当前 DOM 中已加载主帖与评论的提示词和图片候选；评论不会自动展开或自动滚动加载。
- 勾选多个候选时，它们会合并保存到一条飞书记录。
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
```

Expected: syntax, unit, and content tests pass.

- [ ] **Step 3: Manually verify in Chrome**

Load the unpacked extension, open an X status with an image-bearing main post and a loaded prompt reply, and verify:

1. Candidate cards appear in page order with main post first.
2. Main prompt and main images start selected.
3. Reply prompt and reply images start unselected.
4. Selecting reply material updates the form payload and attachment preview count.
5. Saving sends only selected images to the existing Feishu sync path.

- [ ] **Step 4: Commit docs and verification-ready code**

```bash
git add README.md
git commit -m "Document X candidate selection limits"
```
