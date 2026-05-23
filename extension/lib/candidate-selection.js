export function candidateLabel(candidate = {}) {
  const role = candidate.kind === "main" ? "主帖" : "评论";
  return `${role} ${candidate.author || ""}`.trim();
}

export function createDefaultSelection(candidates = []) {
  const prompts = {};
  const images = {};
  for (const candidate of candidates) {
    const selected = candidate.kind === "main";
    for (const prompt of candidate.promptCandidates || []) {
      prompts[prompt.id] = selected;
    }
    for (const image of candidate.images || []) {
      images[image.id] = selected;
    }
  }
  return { prompts, images };
}

export function selectedCandidatePrompt(candidates = [], selection = {}) {
  const selectedPrompts = selection.prompts || {};
  return candidates.flatMap((candidate) => {
    const prompts = (candidate.promptCandidates || []).filter((item) => selectedPrompts[item.id]);
    return prompts.map((item) => `[${candidateLabel(candidate)}]\n${item.text}`);
  }).join("\n\n");
}

export function selectedCandidateImages(candidates = [], selection = {}) {
  const selectedImages = selection.images || {};
  return candidates.flatMap((candidate) => (candidate.images || []).filter((image) => selectedImages[image.id]));
}

export function selectedCapture(capture = {}, selection = {}) {
  if (!capture.candidates?.length) return capture;
  const prompt = selectedCandidatePrompt(capture.candidates, selection);
  const images = selectedCandidateImages(capture.candidates, selection);
  return {
    ...capture,
    prompt: prompt || capture.prompt || "",
    images,
    rawSelection: {
      selectedCandidateIds: capture.candidates
        .filter((candidate) =>
          (candidate.promptCandidates || []).some((item) => selection.prompts?.[item.id]) ||
          (candidate.images || []).some((image) => selection.images?.[image.id])
        )
        .map((candidate) => candidate.id)
    }
  };
}
