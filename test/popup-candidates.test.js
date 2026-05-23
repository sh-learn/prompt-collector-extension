import assert from "node:assert/strict";
import {
  createDefaultSelection,
  selectedCapture,
  selectedCandidateImages,
  selectedCandidatePrompt,
  selectedCandidateVideos
} from "../extension/lib/candidate-selection.js";

const candidates = [
  {
    id: "main",
    kind: "main",
    author: "Main Author @main",
    promptCandidates: [{ id: "main-prompt", text: "Main prompt body.", reason: "marker" }],
    images: [{ id: "main-image", url: "main.png" }],
    videos: [{ id: "main-video", url: "main.mp4" }]
  },
  {
    id: "reply",
    kind: "reply",
    author: "Reply Author @reply",
    promptCandidates: [{ id: "reply-prompt", text: "Reply prompt body.", type: "video", reason: "marker" }],
    images: [{ id: "reply-image", url: "reply.png" }],
    videos: [{ id: "reply-video", url: "reply.mp4" }]
  }
];

const defaultSelection = createDefaultSelection(candidates);
assert.equal(defaultSelection.prompts["main-prompt"], true);
assert.equal(defaultSelection.images["main-image"], true);
assert.equal(defaultSelection.videos["main-video"], true);
assert.equal(defaultSelection.prompts["reply-prompt"], false);
assert.equal(defaultSelection.images["reply-image"], false);
assert.equal(defaultSelection.videos["reply-video"], false);

const selection = {
  prompts: {
    "main-prompt": true,
    "reply-prompt": true
  },
  images: {
    "main-image": true,
    "reply-image": true
  },
  videos: {
    "main-video": true,
    "reply-video": true
  }
};

const prompt = selectedCandidatePrompt(candidates, selection);
assert.match(prompt, /\[主帖 Main Author @main\]/);
assert.match(prompt, /Main prompt body\./);
assert.match(prompt, /\[评论 Reply Author @reply\]/);
assert.match(prompt, /Reply prompt body\./);
assert.deepEqual(selectedCandidateImages(candidates, selection).map((image) => image.url), ["main.png", "reply.png"]);
assert.deepEqual(selectedCandidateVideos(candidates, selection).map((video) => video.url), ["main.mp4", "reply.mp4"]);

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
assert.equal(payload.promptSections.find((section) => section.id === "reply-prompt").type, "video");
assert.deepEqual(payload.images.map((image) => image.url), ["main.png", "reply.png"]);
assert.deepEqual(payload.videos.map((video) => video.url), ["main.mp4", "reply.mp4"]);
assert.deepEqual(payload.rawSelection.selectedCandidateIds, ["main", "reply"]);

console.log("popup candidate helper test passed");
