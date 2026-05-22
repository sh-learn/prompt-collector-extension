export const FEISHU_ACCOUNTS_ORIGIN = "https://accounts.feishu.cn";
export const FEISHU_API_ORIGIN = "https://open.feishu.cn";

export const REQUIRED_SCOPES = [
  "offline_access",
  "wiki:wiki",
  "wiki:wiki:readonly",
  "wiki:node:read",
  "wiki:node:create",
  "bitable:app",
  "bitable:app:readonly",
  "base:table:read",
  "base:table:create",
  "base:field:read",
  "base:field:create",
  "base:record:create",
  "base:record:retrieve",
  "drive:drive"
];

export const STORAGE_KEYS = {
  SETTINGS: "settings",
  TOKENS: "tokens",
  OAUTH: "oauthState",
  SECRET_VAULT: "secretVault",
  LAST_SYNC_DEBUG: "lastSyncDebug"
};

export const STANDARD_FIELDS = [
  { key: "title", name: "标题", type: "text" },
  { key: "prompt", name: "Prompt", type: "text" },
  { key: "sourceUrl", name: "来源链接", type: "text", style: { type: "url" } },
  { key: "pageTitle", name: "页面标题", type: "text" },
  { key: "author", name: "作者", type: "text" },
  { key: "images", name: "图片", type: "attachment" },
  { key: "capturedAt", name: "采集时间", type: "datetime" },
  { key: "site", name: "站点", type: "text" },
  { key: "rawJson", name: "原始数据", type: "text" }
];

export function defaultSettings() {
  return {
    feishuAppId: "",
    redirectUri: "",
    authStatus: "disconnected",
    targetInput: "",
    wikiNodeToken: "",
    targetBaseToken: "",
    targetTableId: "",
    targetTables: [],
    fieldMap: {},
    tableFieldMaps: {},
    tableSchemas: {},
    createdByExtensionVersion: "0.1.0"
  };
}
