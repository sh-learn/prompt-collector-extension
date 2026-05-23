export function candidateLabel(candidate = {}) {
  const role = candidate.kind === "main" ? "主帖" : "评论";
  return `${role} ${candidate.author || ""}`.trim();
}

export function createDefaultSelection(candidates = []) {
  const prompts = {};
  const images = {};
  const videos = {};
  for (const candidate of candidates) {
    const selected = candidate.kind === "main";
    for (const prompt of candidate.promptCandidates || []) {
      prompts[prompt.id] = selected;
    }
    for (const image of candidate.images || []) {
      images[image.id] = selected;
    }
    for (const video of candidate.videos || []) {
      videos[video.id] = selected;
    }
  }
  return { prompts, images, videos };
}

export function selectedCandidatePrompt(candidates = [], selection = {}) {
  return selectedCandidatePromptSections(candidates, selection)
    .map((item) => `[${candidateLabel(item.candidate)}]\n${item.text}`)
    .join("\n\n");
}

export function selectedCandidatePromptSections(candidates = [], selection = {}) {
  const selectedPrompts = selection.prompts || {};
  return candidates.flatMap((candidate) => (candidate.promptCandidates || [])
    .filter((item) => selectedPrompts[item.id])
    .map((item) => ({
      candidateId: candidate.id,
      candidateKind: candidate.kind,
      candidate,
      id: item.id,
      label: item.label || "",
      type: item.type || "prompt",
      text: item.text || ""
    })));
}

export function selectedCandidateImages(candidates = [], selection = {}) {
  const selectedImages = selection.images || {};
  return candidates.flatMap((candidate) => (candidate.images || []).filter((image) => selectedImages[image.id]));
}

export function selectedCandidateVideos(candidates = [], selection = {}) {
  const selectedVideos = selection.videos || {};
  return candidates.flatMap((candidate) => (candidate.videos || []).filter((video) => selectedVideos[video.id]));
}

export function selectedCapture(capture = {}, selection = {}) {
  if (!capture.candidates?.length) return capture;
  const prompt = selectedCandidatePrompt(capture.candidates, selection);
  const promptSections = selectedCandidatePromptSections(capture.candidates, selection)
    .map(({ candidate, ...section }) => section);
  const images = selectedCandidateImages(capture.candidates, selection);
  const videos = selectedCandidateVideos(capture.candidates, selection);
  return {
    ...capture,
    prompt: prompt || capture.prompt || "",
    promptSections,
    images,
    videos,
    rawSelection: {
      selectedCandidateIds: capture.candidates
        .filter((candidate) =>
          (candidate.promptCandidates || []).some((item) => selection.prompts?.[item.id]) ||
          (candidate.images || []).some((image) => selection.images?.[image.id]) ||
          (candidate.videos || []).some((video) => selection.videos?.[video.id])
        )
        .map((candidate) => candidate.id)
    }
  };
}
