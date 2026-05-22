export const FEISHU_ACCOUNTS_ORIGIN = "https://accounts.feishu.cn";
export const FEISHU_API_ORIGIN = "https://open.feishu.cn";

export const REQUIRED_SCOPES = [
  "offline_access",
  "wiki:wiki",
  "wiki:wiki:readonly",
  "wiki:node:read",
  "bitable:app",
  "bitable:app:readonly",
  "base:table:read",
  "base:field:read",
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
