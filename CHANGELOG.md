# Changelog

## 0.2.0 - 2026-05-23

- Added X/Twitter GraphQL observation for video MP4 direct links and long tweet/comment text.
- Added video candidates alongside prompt and image candidates, with selected videos uploaded to Feishu attachments.
- Added X video poster fallback as an image candidate when the video file URL is not captured.
- Improved X candidate extraction for loaded replies and merged selected candidates into a single Feishu record.
- Added Seedance/video prompt and storyboard prompt detection, including safer marker parsing to avoid false positives such as "故事板提示词，拆解在评论区".
- Improved Feishu field autofill for `Seedance` / `视频提示词` and `分镜` / `故事板` fields.
- Improved candidate selection UX so toggling checkboxes refreshes selected fields and media without jumping back to the top.
- Documented current X extraction limitations and testing expectations.

## 0.1.0 - 2026-05-21

- Initial Chrome MV3 extension for collecting prompts, images, source links, and metadata into a Feishu Base.
- Added Feishu OAuth, App Secret local storage, Base binding, table selection, schema loading, and attachment upload.
- Added page-side collector panel with editable field preview and save-to-Feishu flow.
