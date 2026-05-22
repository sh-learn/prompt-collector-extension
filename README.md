# Prompt Collector to Feishu

Chrome MV3 插件：在 X/Twitter 或普通网页中提取提示词、来源链接和素材，编辑后保存到飞书知识库里的多维表格。

## 功能

- 点击插件图标，在当前网页右侧打开固定采集面板。
- 绑定一个已有的飞书知识库多维表格，读取 Base 下的数据表和字段。
- 切换数据表后按该表字段重新采集并渲染表单，适配文生图、文生视频等不同表结构。
- 自动提取 X 帖子的标题、作者、时间、提示词、多图和来源链接；普通网页支持选中文本和提示词标记提取。
- 上传图片附件；普通网页中有直链的 `<video src>` / `<source src>` 视频也会作为附件上传。
- 保存后可直接打开对应飞书数据表。

## 目录

- `extension/`：Chrome 插件本体，包含页面侧边面板、设置页、OAuth 和飞书同步逻辑。
- `test/`：PKCE/config 和内容提取测试。

## 数据表约定

插件不会创建或修改飞书多维表格结构。请先在知识库中创建目标多维表格，并按用途准备不同数据表。

绑定 Base 后，插件按飞书接口返回的字段顺序渲染当前数据表字段，并根据字段名推断可自动填充的内容，例如：

| 内容 | 常见字段名 |
| --- | --- |
| 标题 | `标题`、`名称`、`title` |
| 提示词 | `提示词`、`Prompt`、`正文`、`内容` |
| 来源链接 | `来源链接`、`链接`、`URL` |
| 作者 | `作者`、`博主`、`发布者` |
| 图片 / 视频 | `图片`、`附件`、`视频附件`、`素材附件` |
| 采集时间 | `采集时间`、`保存时间`、`时间` |

字段名固定为 `风格分类` 时，采集面板会隐藏该字段且不会写入，方便交给飞书 AI 或自动化生成。

## 安装

1. 打开 Chrome `chrome://extensions`
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择本仓库的 `extension/` 目录

## 首次设置

1. 在飞书开放平台创建应用，准备 `App ID` 和 `App Secret`
2. 打开插件设置页，填写并保存应用信息
3. 复制设置页显示的 Chrome OAuth Redirect URL
4. 在飞书开放平台应用的重定向 URL 中加入该 Redirect URL
5. 回到插件设置页点击“连接飞书”
6. 粘贴知识库中目标多维表格的完整链接，链接必须包含 `table=...`
7. 点击“绑定多维表格”

`App Secret` 仅保存在本机 `chrome.storage.local`。这种方式适合个人自建飞书应用和本地自用插件；公开分发时建议把 token 换取与刷新迁移到后端 token broker。

## 使用

1. 打开 X 帖子或包含提示词的网页
2. 点击插件图标打开页面内侧边面板
3. 面板默认选择 Base 下第一个数据表并自动采集当前页面
4. 切换数据表或点击刷新按钮时，插件会重新采集当前页面
5. 检查并编辑字段内容
6. 点击底部“保存到飞书”

X/Twitter 页面会优先读取当前可见帖子，并尽量把图片 URL 升级为原图参数。普通网页优先使用选中文本，其次识别 `Prompt:`、`提示词:`、`完整提示词:` 等标记后的正文。

飞书同步会按字段类型转换值：URL 字段使用 `{ text, link }`，日期字段写入时间戳，附件字段先上传素材再写入 `file_token`。图片以 `bitable_image` 上传，文件和直链视频以 `bitable_file` 上传，并带当前 Base 的 `drive_route_token`。

## 飞书权限

飞书应用需要允许用户授权以下 scope：

- `offline_access`
- `wiki:wiki`
- `wiki:wiki:readonly`
- `wiki:node:read`
- `bitable:app`
- `bitable:app:readonly`
- `base:table:read`
- `base:field:read`
- `base:record:create`
- `base:record:retrieve`
- `drive:drive`

如果飞书返回 `permission_violations`，以错误里列出的用户身份权限为准，在开放平台补开后重新连接。

## 测试

```bash
npm test
```

测试覆盖：

- MV3 JavaScript 语法和 manifest JSON
- PKCE/config 单元测试
- Chromium 中的内容提取测试

## 致谢

本插件项目受 [MindOS_Lisa](https://x.com/MindOS_Lisa) 启发，并根据其 [这条分享](https://x.com/MindOS_Lisa/status/2057632360875843626) 更新了飞书知识库数据表配置。

页面设计部分参考了 [Obsidian Web Clipper](https://obsidian.md/clipper) 插件。
