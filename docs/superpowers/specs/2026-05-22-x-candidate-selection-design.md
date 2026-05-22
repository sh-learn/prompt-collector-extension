# X Candidate Selection Design

## Goal

Improve X collection so a user can inspect prompt and image candidates from the main post and the currently loaded replies before saving one merged Feishu Base record.

This addresses the current single-post extraction limit. On X, example images may be in the main post while the complete prompt may appear in a reply. The extension should preserve that relationship long enough for the user to choose the useful material.

## Scope

Version 1 will:

- Scan the X main post and reply posts that are already loaded in the current page DOM.
- Group extracted candidates by post.
- Let the user select prompt candidates and images before writing to Feishu.
- Merge selected prompt text and media into one Feishu record.
- Keep the existing dynamic Feishu table field form and save flow.

Version 1 will not:

- Expand reply threads automatically.
- Scroll X to load additional replies.
- Save each selected candidate to a separate Feishu record.
- Use AI to rank, merge, summarize, or classify prompt candidates.
- Extract X video media beyond the plugin's existing limitations.

## User Flow

1. The user opens an X post and opens the Prompt Collector panel.
2. The user selects the target Feishu data table.
3. The extension scans the current X DOM and returns candidate post groups.
4. The panel shows the main post first and currently loaded replies after it.
5. Each candidate group shows its post role, author, text context, prompt candidates, image thumbnails, and post source.
6. Main-post prompt candidates and images start selected by default. Reply candidates start unselected.
7. The user selects or clears prompt candidates and images.
8. Selected prompt text is merged into the editable Feishu field form. Selected media is prepared for attachment upload.
9. The user edits fields if needed and saves one record to Feishu.

## Data Shapes

### X Thread Capture

```js
{
  sourceUrl: string,
  pageTitle: string,
  capturedAt: string,
  candidates: XPostCandidate[]
}
```

### X Post Candidate

```js
{
  id: string,
  kind: "main" | "reply",
  author: string,
  postUrl: string,
  rawText: string,
  promptCandidates: PromptCandidate[],
  images: ImageCandidate[]
}
```

### Prompt Candidate

```js
{
  id: string,
  text: string,
  reason: "marker" | "post_text"
}
```

### Image Candidate

```js
{
  id: string,
  url: string,
  alt: string,
  width: number,
  height: number
}
```

## Extraction Rules

The X extractor should identify the current main post separately from loaded replies instead of returning only one tweet article.

For each selected `article[data-testid="tweet"]`:

- Read author, tweet text, post time, post link, and X photo media.
- Include image media from X tweet photo containers and reject avatars, emoji images, and decorative assets.
- Upgrade X media URLs to original quality when possible.
- Create prompt candidates from explicit markers such as `Prompt:`, `提示词:`, and `完整提示词:`.
- When no marker candidate exists, expose the post text as a manual candidate if it is non-empty.

The main post must be chosen by the active status page context rather than by whichever visible article begins inside the viewport. A long main post may still intersect the viewport while a reply starts below it.

## UI Design

The panel keeps the existing right-side embedded experience.

Candidate selection uses grouped post cards:

- Card header: main-post or reply label, author, optional post source action.
- Body: text preview, prompt candidate checkboxes, and selectable image thumbnails.
- Main-post candidates default selected.
- Reply candidates default unselected.

The Feishu field form remains the final editable payload surface:

- Selecting or clearing prompt candidates updates the inferred prompt field value.
- Selected images are the only image candidates sent into upload logic.
- The user can still edit text fields after candidate selection.
- Hidden or unsupported Feishu fields keep their existing behavior.

If no X candidate groups can be built, the panel falls back to the existing single-capture form behavior.

## Save Behavior

The save request still creates one Feishu record.

Selected prompt candidates are merged into one field value using source labels so the user can see where text came from:

```text
[主帖 @author]
...

[评论 @author]
...
```

Selected image candidates are uploaded through the existing attachment pipeline and written to the selected attachment field.

The top-level source link remains the currently opened X status URL. When an `原始数据` field exists, the write payload should preserve selected candidate metadata so later debugging or future AI processing can recover the chosen post relationships.

## Error Handling

- A post with text but no images remains selectable.
- A post with images but no prompt candidate can still contribute images.
- A candidate whose image URL fails upload should follow the existing partial-media failure behavior.
- If the page has no usable X candidates, fallback extraction should keep the save panel useful.
- Missing comments are not treated as an error because only currently loaded replies are in scope.

## Testing

Add focused tests for:

- A long X main post remains the selected main candidate after scrolling into its body.
- Loaded reply posts become candidate groups after the main post.
- X tweet photo images enter the correct post group while avatars and emoji images do not.
- Main-post candidates default selected and reply candidates default unselected.
- Selected prompt candidates merge into one editable field value with source labels.
- Selected images across multiple post groups are the only media sent to sync.
- The single-capture fallback still works for generic pages and X pages with no usable candidates.

## Notes

This design intentionally keeps Feishu field mapping and record creation unchanged. The change is in the collection and pre-save selection layer so the extension can learn from X thread structure without widening the Feishu integration surface at the same time.
