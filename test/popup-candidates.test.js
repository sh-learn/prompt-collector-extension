import assert from "node:assert/strict";
import {
  createDefaultSelection,
  selectedCapture,
  selectedCandidateImages,
  selectedCandidatePrompt
} from "../extension/lib/candidate-selection.js";

const candidates = [
  {
    id: "main",
    kind: "main",
    author: "Main Author @main",
    promptCandidates: [{ id: "main-prompt", text: "Main prompt body.", reason: "marker" }],
    images: [{ id: "main-image", url: "main.png" }]
  },
  {
    id: "reply",
    kind: "reply",
    author: "Reply Author @reply",
    promptCandidates: [{ id: "reply-prompt", text: "Reply prompt body.", reason: "marker" }],
    images: [{ id: "reply-image", url: "reply.png" }]
  }
];

const defaultSelection = createDefaultSelection(candidates);
assert.equal(defaultSelection.prompts["main-prompt"], true);
assert.equal(defaultSelection.images["main-image"], true);
assert.equal(defaultSelection.prompts["reply-prompt"], false);
assert.equal(defaultSelection.images["reply-image"], false);

const selection = {
  prompts: {
    "main-prompt": true,
    "reply-prompt": true
  },
  images: {
    "main-image": true,
    "reply-image": true
  }
};

const prompt = selectedCandidatePrompt(candidates, selection);
assert.match(prompt, /\[主帖 Main Author @main\]/);
assert.match(prompt, /Main prompt body\./);
assert.match(prompt, /\[评论 Reply Author @reply\]/);
assert.match(prompt, /Reply prompt body\./);
assert.deepEqual(selectedCandidateImages(candidates, selection).map((image) => image.url), ["main.png", "reply.png"]);

const capture = {
  title: "Original title",
  prompt: "Original prompt",
  images: [{ id: "unselected-image", url: "unselected.png" }],
  videos: [],
  candidates
};

const payload = selectedCapture(capture, selection);
assert.match(payload.prompt, /Main prompt body/);
assert.match(payload.prompt, /Reply prompt body/);
assert.deepEqual(payload.images.map((image) => image.url), ["main.png", "reply.png"]);
assert.equal(payload.videos.length, 0);
assert.deepEqual(payload.rawSelection.selectedCandidateIds, ["main", "reply"]);

console.log("popup candidate helper test passed");
