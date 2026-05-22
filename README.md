# Prompt Collector to Feishu

Chrome MV3 插件：在 X/Twitter 或普通网页中采集提示词、图片、直链视频和来源链接，预览后保存到飞书知识库里的多维表格。

## 当前架构

- `extension/`：纯插件主路径，包含 popup、options、MV3 background service worker。
- `server/`：旧本地 relay/lark-cli 实验路径，仅保留作回滚和对照，不再是 v1 默认使用方式。

个人本地模式会让用户输入 `App ID` 和 `App Secret`。`App Secret` 仅保存到本机 Chrome storage，不会上传到第三方服务。这个模式适合个人自建飞书应用和本地自用插件；公开分发场景仍建议改用 token broker。

## 数据表字段

推荐直接使用你在知识库里创建好的多维表格。插件绑定 Base 后会读取 Base 下的所有数据表；在 popup 里选择某张数据表后，会读取该表实际字段并渲染成可编辑表单。不同数据表可以有不同字段，例如“文生图”“文生视频”“角色设定”等。

如果使用“创建新表”的备用路径，插件会创建一张“Prompt 列表”并写入标准字段：

| 字段名 | 类型 |
| --- | --- |
| 标题 | 文本 |
| Prompt | 多行文本 |
| 来源链接 | URL 文本 |
| 页面标题 | 文本 |
| 作者 | 文本 |
| 图片 / 视频 | 附件 |
| 采集时间 | 日期 |
| 站点 | 文本 |
| 原始数据 | 多行文本 |

字段写入会优先使用字段 ID，减少后续字段改名带来的同步失败。已有表不会被插件自动改字段；插件只会按字段名做自动填充推断，用户保存前可手动修改。

固定字段 `风格分类` 会在采集面板中隐藏且不由插件写入，留给飞书 AI 或自动化生成。

## 安装插件

1. 打开 Chrome `chrome://extensions`
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择 `/Users/suheng/workspace/ai_projects/prompt-collector-extension/extension`

## 首次设置

1. 打开插件设置页
2. 填写飞书 `App ID` 和 `App Secret`
3. 点击“保存应用信息”
4. 复制设置页显示的 Chrome OAuth Redirect URL
5. 在飞书开放平台应用的安全设置中添加该 Redirect URL
6. 回到插件设置页，点击“连接飞书”
7. 粘贴知识库里的目标多维表格链接，链接里需要包含 `table=...`
8. 点击“绑定多维表格”
9. 插件会同步该 Base 下的数据表列表，后续在 popup 中选择保存到哪个数据表

推荐直接输入带 `?table=...` 的现有多维表格链接。插件会绑定整个 Base，读取其中所有数据表，在 popup 中提供数据表选择；选择数据表后会按该表字段渲染表单。保留空输入和 Wiki 父节点创建新表的能力仅作为备用路径。

## 使用

1. 打开 X/Twitter 帖子或任意包含提示词的网页
2. 点击插件图标，在当前网页右侧打开固定采集面板；面板不会因为切到其他区域而自动关闭
3. 面板打开时会默认选择第一个数据表并采集当前来源页；切换数据表或点击刷新按钮会重新采集
4. 在 popup 中选择要保存的数据表
5. 插件按该数据表字段渲染表单，并自动填入能识别的标题、Prompt、链接、作者、附件等内容
6. 可手动微调字段内容
7. 点击“保存到飞书”

X/Twitter 页面会优先使用专门规则：提取当前可见 tweet、作者、时间、多图，并尽量把图片 URL 升级为原图参数。URL 字段会按飞书超链接结构 `{ text, link }` 写入；图片会以 `bitable_image` 上传，文件/视频会以 `bitable_file` 上传，并带当前 Base 的 `drive_route_token`，再用 `file_token` 写入附件字段。普通网页会优先使用选中文本，其次识别 `Prompt:`、`提示词:`、`完整提示词:` 后的正文。普通网页里的 `<video src>` / `<source src>` 直链视频会上传到附件字段；X 如果只暴露 `blob:` 或分片视频流，会先跳过。

## 测试

```bash
cd /Users/suheng/workspace/ai_projects/prompt-collector-extension
npm test
```

测试覆盖：

- MV3 文件语法和 manifest JSON
- PKCE/config 单元测试
- 旧 relay 回归测试
- Chromium 中注入采集脚本的浏览器测试

## 飞书权限

飞书应用需要开通并允许用户授权以下能力：

- `offline_access`
- `wiki:wiki`
- `wiki:wiki:readonly`
- `wiki:node:read`
- `wiki:node:create`
- `bitable:app`
- `bitable:app:readonly`
- `base:field:read`
- `base:field:create`
- `base:record:create`
- `base:record:retrieve`
- `drive:drive`

如果飞书开放平台实际要求的 scope 名称有租户差异，以授权错误里的 `permission_violations` 为准，在开发者后台补开后重新连接。

## 本地密钥说明

- App Secret 保存在 `chrome.storage.local`，只用于当前浏览器本机调用飞书 token 接口。
- 插件不会把 App Secret 上传到第三方服务。
- 这适合个人本地使用；如果后续公开发布，建议把 token 换取/刷新迁移到后端 token broker。

## 致谢

本插件项目受 [MindOS_Lisa](https://x.com/MindOS_Lisa) 启发，并根据其 [这条分享](https://x.com/MindOS_Lisa/status/2057632360875843626) 更新了飞书知识库数据表配置。
