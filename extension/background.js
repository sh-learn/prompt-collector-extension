import { createPkcePair, createState } from "./lib/pkce.js";
import {
  FEISHU_ACCOUNTS_ORIGIN,
  FEISHU_API_ORIGIN,
  REQUIRED_SCOPES,
  STORAGE_KEYS,
  defaultSettings
} from "./lib/feishu-config.js";

let sessionClientSecret = "";
let sourceTab = null;

function rememberSourceTab(tab = {}) {
  if (!tab.id || !tab.url || tab.url.startsWith("chrome-extension://")) return;
  sourceTab = {
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title || ""
  };
}

async function openCollectorOverlay(tab) {
  rememberSourceTab(tab);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["overlay.js"]
  });
}

function extensionVersion() {
  return chrome.runtime.getManifest().version;
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

async function getSettings() {
  const data = await storageGet([STORAGE_KEYS.SETTINGS]);
  return {
    ...defaultSettings(),
    ...(data[STORAGE_KEYS.SETTINGS] || {}),
    redirectUri: chrome.identity.getRedirectURL("feishu")
  };
}

async function setSettings(patch) {
  const settings = {
    ...(await getSettings()),
    ...patch,
    redirectUri: chrome.identity.getRedirectURL("feishu"),
    createdByExtensionVersion: extensionVersion()
  };
  await storageSet({ [STORAGE_KEYS.SETTINGS]: settings });
  return settings;
}

async function getTokens() {
  const data = await storageGet([STORAGE_KEYS.TOKENS]);
  return data[STORAGE_KEYS.TOKENS] || null;
}

async function getSecretVault() {
  const data = await storageGet([STORAGE_KEYS.SECRET_VAULT]);
  return data[STORAGE_KEYS.SECRET_VAULT] || null;
}

async function saveClientSecret({ secret }) {
  if (!secret) throw new Error("App Secret 不能为空");
  const vault = {
    mode: "plain",
    secret,
    savedAt: new Date().toISOString()
  };
  await storageSet({ [STORAGE_KEYS.SECRET_VAULT]: vault });
  sessionClientSecret = secret;
  return { savedAt: vault.savedAt };
}

async function clientSecret() {
  if (sessionClientSecret) return sessionClientSecret;
  const vault = await getSecretVault();
  if (vault?.mode === "plain" && vault.secret) {
    sessionClientSecret = vault.secret;
    return sessionClientSecret;
  }
  throw Object.assign(new Error("请先到设置页保存飞书 App Secret"), {
    code: "SECRET_LOCKED"
  });
}

async function setTokens(raw) {
  const now = Date.now();
  const tokenData = raw?.data || raw;
  const tokens = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type: tokenData.token_type || "Bearer",
    expires_at: now + Math.max(0, Number(tokenData.expires_in || 7200) - 120) * 1000,
    refresh_expires_at: tokenData.refresh_expires_in
      ? now + Math.max(0, Number(tokenData.refresh_expires_in) - 120) * 1000
      : 0,
    scope: tokenData.scope || ""
  };
  await storageSet({ [STORAGE_KEYS.TOKENS]: tokens });
  await setSettings({ authStatus: "connected" });
  return tokens;
}

function buildAuthorizeUrl({ clientId, redirectUri, scope, state, codeChallenge }) {
  const url = new URL("/open-apis/authen/v1/authorize", FEISHU_ACCOUNTS_ORIGIN);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scope.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.href;
}

function parseOAuthRedirect(redirectUrl, expectedState) {
  const url = new URL(redirectUrl);
  const params = url.searchParams;
  if (params.get("error")) {
    throw new Error(`飞书授权被拒绝：${params.get("error")}`);
  }
  if (!params.get("code")) {
    throw new Error("飞书授权回调中没有 code");
  }
  if (params.get("state") !== expectedState) {
    throw new Error("飞书授权 state 校验失败");
  }
  return params.get("code");
}

async function tokenRequest(body) {
  const response = await fetch(`${FEISHU_API_ORIGIN}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.code && data.code !== 0) || data.error) {
    throw new Error(data.msg || data.error_description || data.error || `飞书 token 请求失败：HTTP ${response.status}`);
  }
  return data.data || data;
}

async function startOAuth() {
  const settings = await getSettings();
  if (!settings.feishuAppId) throw new Error("请先填写飞书 App ID");
  const secret = await clientSecret();

  const pkce = await createPkcePair();
  const state = createState();
  await storageSet({
    [STORAGE_KEYS.OAUTH]: {
      state,
      verifier: pkce.verifier,
      createdAt: Date.now()
    }
  });

  const redirectUri = chrome.identity.getRedirectURL("feishu");
  const authorizeUrl = buildAuthorizeUrl({
    clientId: settings.feishuAppId,
    redirectUri,
    scope: REQUIRED_SCOPES,
    state,
    codeChallenge: pkce.challenge
  });

  const redirectedTo = await chrome.identity.launchWebAuthFlow({
    url: authorizeUrl,
    interactive: true
  });
  if (!redirectedTo) throw new Error("飞书授权流程没有返回回调 URL");

  const code = parseOAuthRedirect(redirectedTo, state);
  const tokenData = await tokenRequest({
    grant_type: "authorization_code",
    client_id: settings.feishuAppId,
    client_secret: secret,
    code,
    redirect_uri: redirectUri,
    code_verifier: pkce.verifier
  });
  await chrome.storage.local.remove(STORAGE_KEYS.OAUTH);
  return setTokens(tokenData);
}

async function refreshTokens(tokens) {
  const settings = await getSettings();
  if (!settings.feishuAppId || !tokens?.refresh_token) {
    throw new Error("飞书授权已失效，请重新连接");
  }
  const tokenData = await tokenRequest({
    grant_type: "refresh_token",
    client_id: settings.feishuAppId,
    client_secret: await clientSecret(),
    refresh_token: tokens.refresh_token
  });
  return setTokens(tokenData);
}

async function accessToken() {
  const tokens = await getTokens();
  if (!tokens?.access_token) throw new Error("请先在设置页连接飞书");
  if (tokens.refresh_expires_at && Date.now() > tokens.refresh_expires_at) {
    await chrome.storage.local.remove(STORAGE_KEYS.TOKENS);
    await setSettings({ authStatus: "expired" });
    throw new Error("飞书授权已过期，请重新连接");
  }
  if (Date.now() > tokens.expires_at) {
    return (await refreshTokens(tokens)).access_token;
  }
  return tokens.access_token;
}

async function feishu(path, options = {}, retry = true) {
  const token = await accessToken();
  const response = await fetch(`${FEISHU_API_ORIGIN}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { "content-type": "application/json; charset=utf-8" }),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text();

  if ((response.status === 401 || data?.code === 99991663 || data?.code === 99991668) && retry) {
    await refreshTokens(await getTokens());
    return feishu(path, options, false);
  }
  if (!response.ok || (data && typeof data === "object" && data.code && data.code !== 0)) {
    throw new Error(typeof data === "object" ? data.msg || JSON.stringify(data) : data);
  }
  return data;
}

function parseTargetInput(input = "") {
  const value = input.trim();
  if (!value) return { kind: "empty" };
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts.at(-1) || "";
    const tableId = url.searchParams.get("table") || "";
    const pathType = parts.at(-2) || "";
    return { kind: "url", value, token, tableId, pathType };
  } catch {
    return { kind: "token", value, token: value };
  }
}

function normalizeField(field, order = 0) {
  const type = field.type || field.field_type || field.ui_type || "";
  return {
    id: field.field_id || field.id,
    name: field.name || field.field_name,
    type,
    order,
    multiple: Boolean(field.multiple || field.property?.multiple || Number(type) === 4),
    options: field.options || field.property?.options || [],
    raw: field
  };
}

function normalizeTable(table) {
  const tableId = table.table_id || table.id;
  const name =
    table.table_name ||
    table.name ||
    table.default_view_name ||
    table.raw_name ||
    tableId;
  return {
    tableId,
    name,
    raw: table
  };
}

async function listBaseTables(baseToken) {
  const data = await feishu(`/open-apis/bitable/v1/apps/${encodeURIComponent(baseToken)}/tables?page_size=100`);
  const tables = data.data?.items || data.data?.tables || data.items || data.tables || [];
  return tables.map(normalizeTable).filter((table) => table.tableId);
}

function inferFieldMap(fields) {
  const fieldMap = {};
  const tests = {
    title: [/^标题$/, /title/i, /名称/, /主题/],
    prompt: [/prompt/i, /提示词/, /正文/, /^文本$/, /内容/, /描述/],
    sourceUrl: [/来源/, /链接/, /url/i, /原文/],
    pageTitle: [/页面标题/, /网页标题/],
    author: [/作者/, /博主/, /发布者/],
    images: [/^(图片|图像|附件|视频|素材)$/, /参考图/, /图片附件/, /视频文件/, /视频附件/, /视频素材/, /素材附件/],
    capturedAt: [/采集时间/, /保存时间/, /发布时间/, /^时间$/],
    site: [/站点/, /平台/, /来源平台/],
    rawJson: [/原始/, /json/i, /raw/i]
  };
  for (const field of fields) {
    for (const [key, patterns] of Object.entries(tests)) {
      if (!fieldMap[key] && patterns.some((pattern) => pattern.test(field.name || ""))) {
        fieldMap[key] = field.id || field.name;
      }
    }
  }
  return fieldMap;
}

async function loadTableSchema(baseToken, tableId) {
  const settings = await getSettings();
  const fieldsResult = await feishu(
    `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}/tables/${encodeURIComponent(tableId)}/fields`
  );
  const listedFields = fieldsResult?.data?.items || fieldsResult?.data?.fields || fieldsResult?.items || [];
  const fields = listedFields.map((field, index) => normalizeField(field, index)).filter((field) => field.id || field.name);
  const fieldMap = inferFieldMap(fields);

  const tableFieldMaps = {
    ...(settings.tableFieldMaps || {}),
    [tableId]: fieldMap
  };
  const tableSchemas = {
    ...(settings.tableSchemas || {}),
    [tableId]: { fields, loadedAt: new Date().toISOString() }
  };
  const patch = {
    tableFieldMaps,
    tableSchemas,
    ...(settings.targetTableId === tableId ? { fieldMap } : {})
  };
  await setSettings(patch);
  return { fields, fieldMap };
}

async function bindExistingBase(targetInput) {
  const parsed = parseTargetInput(targetInput);
  if (!parsed.token || !parsed.tableId) {
    throw new Error("现有多维表格链接需要包含 table 参数");
  }
  const node = await feishu(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(parsed.token)}`)
    .then((data) => data.data?.node || data.data || {})
    .catch(() => ({ obj_token: parsed.token, node_token: parsed.token, obj_type: "bitable" }));
  const baseToken = node.obj_token || parsed.token;
  const tables = await listBaseTables(baseToken).catch(() => []);
  const targetTable = tables.find((table) => table.tableId === parsed.tableId) || {
    tableId: parsed.tableId,
    name: parsed.tableId
  };
  const targetTables = tables.length ? tables : [targetTable];
  const { fields, fieldMap } = await loadTableSchema(baseToken, targetTable.tableId);

  const settings = await setSettings({
    targetInput,
    wikiNodeToken: node.node_token || parsed.token,
    targetBaseToken: baseToken,
    targetTableId: targetTable.tableId,
    targetTables,
    fieldMap,
    tableFieldMaps: {
      ...(await getSettings()).tableFieldMaps,
      [targetTable.tableId]: fieldMap
    },
    tableSchemas: {
      ...(await getSettings()).tableSchemas,
      [targetTable.tableId]: { fields, loadedAt: new Date().toISOString() }
    }
  });
  return {
    settings,
    node,
    baseToken,
    tableId: targetTable.tableId,
    targetTables,
    fields,
    fieldMap,
    boundExisting: true
  };
}

function cleanFilename(url, index, fallbackExt = "jpg") {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    if (/\.[a-z0-9]{2,5}$/i.test(name)) return name.slice(0, 96);
  } catch {
    // fall through
  }
  return `prompt-media-${index + 1}.${fallbackExt}`;
}

function extensionFromType(contentType = "") {
  if (contentType.includes("mp4")) return "mp4";
  if (contentType.includes("webm")) return "webm";
  if (contentType.includes("quicktime")) return "mov";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

async function downloadMedia(media, index) {
  const response = await fetch(media.url);
  if (!response.ok) throw new Error(`素材下载失败：${response.status}`);
  const blob = await response.blob();
  return {
    blob,
    name: cleanFilename(media.url, index, extensionFromType(blob.type)),
    size: blob.size,
    type: blob.type
  };
}

async function uploadMedia(media, index, baseToken) {
  const file = await downloadMedia(media, index);
  const parentType = file.type.startsWith("image/") ? "bitable_image" : "bitable_file";
  const form = new FormData();
  form.set("file_name", file.name);
  form.set("parent_type", parentType);
  form.set("parent_node", baseToken);
  form.set("size", String(file.size));
  form.set("extra", JSON.stringify({ drive_route_token: baseToken }));
  form.set("file", file.blob, file.name);
  const data = await feishu("/open-apis/drive/v1/medias/upload_all", {
    method: "POST",
    body: form
  });
  const fileToken = data.data?.file_token || data.file_token;
  if (!fileToken) throw new Error("飞书没有返回素材 file_token");
  return {
    file_token: fileToken,
    parent_type: parentType,
    name: file.name,
    size: file.size,
    type: file.type || "application/octet-stream"
  };
}

function recordUrl(settings, tableId, recordId) {
  if (!tableId) return "";
  try {
    const url = new URL(settings.targetInput || "");
    url.searchParams.set("table", tableId);
    if (recordId) url.searchParams.set("record", recordId);
    return url.href;
  } catch {
    if (!settings.targetBaseToken) return "";
    const url = new URL(`https://my.feishu.cn/base/${settings.targetBaseToken}`);
    url.searchParams.set("table", tableId);
    if (recordId) url.searchParams.set("record", recordId);
    return url.href;
  }
}

function fieldKind(field = {}) {
  const type = String(field.type || field.raw?.type || field.raw?.ui_type || "").toLowerCase();
  const typeNumber = Number(field.type || field.raw?.type || field.raw?.field_type);
  const name = String(field.name || "");
  if (typeNumber === 17) return "attachment";
  if (typeNumber === 5) return "datetime";
  if (typeNumber === 2) return "number";
  if (typeNumber === 7) return "checkbox";
  if (typeNumber === 3 || typeNumber === 4) return "select";
  if (typeNumber === 15) return "url";
  if (
    type.includes("attachment") ||
    /^(图片|图像|附件|视频|素材)$/.test(name) ||
    /参考图|图片附件|视频文件|视频附件|视频素材|素材附件/.test(name)
  ) {
    return "attachment";
  }
  if (type.includes("datetime") || type.includes("date")) return "datetime";
  if (type.includes("number")) return "number";
  if (type.includes("checkbox")) return "checkbox";
  if (type.includes("select")) return "select";
  if (type.includes("url") || type.includes("link")) return "url";
  return "text";
}

function hiddenFromCollector(field = {}) {
  return String(field.name || "").trim() === "风格分类";
}

function normalizeCellValue(field, value, uploadedImages) {
  const kind = fieldKind(field);
  if (kind === "attachment") return uploadedImages.map((item) => ({ file_token: item.file_token })).filter((item) => item.file_token);
  if (value === undefined || value === null || value === "") return undefined;
  if (kind === "number") {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (kind === "checkbox") return Boolean(value === true || value === "true" || value === "on" || value === "1");
  if (kind === "datetime") {
    if (typeof value === "number") return value;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? undefined : timestamp;
  }
  if (kind === "url") {
    const link = String(value).trim();
    return link ? { text: link, link } : undefined;
  }
  if (kind === "select" && field.multiple) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

function buildDefaultFormValues(capture, failedImages) {
  const rawData = {
    ...capture,
    failedImages
  };
  return {
    title: capture.title || capture.pageTitle || "未命名提示词",
    prompt: capture.prompt || "",
    sourceUrl: capture.sourceUrl || "",
    pageTitle: capture.pageTitle || "",
    author: capture.author || "",
    capturedAt: formatDateTime(capture.capturedAt),
    site: capture.site || "generic",
    rawJson: JSON.stringify(rawData, null, 2)
  };
}

function valueForField(field, fieldMap, values, defaults, uploadedImages) {
  const key = Object.entries(fieldMap || {}).find(([, fieldId]) => fieldId === field.id || fieldId === field.name)?.[0];
  const explicit = values?.[field.id] ?? values?.[field.name];
  if (explicit !== undefined) return normalizeCellValue(field, explicit, uploadedImages);
  if (fieldKind(field) === "attachment") return normalizeCellValue(field, "", uploadedImages);
  return normalizeCellValue(field, key ? defaults[key] : "", uploadedImages);
}

function buildRecordFields(schema, fieldMap, capture, uploadedImages, failedImages, keyMode = "id") {
  const fields = {};
  const defaults = buildDefaultFormValues(capture, failedImages);
  for (const field of schema?.fields || []) {
    if (hiddenFromCollector(field)) continue;
    const value = valueForField(field, fieldMap, capture.fieldValues || {}, defaults, uploadedImages);
    if (value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length)) {
      fields[keyMode === "name" ? field.name || field.id : field.id || field.name] = value;
    }
  }
  return fields;
}

function buildAttachmentFields(schema, uploadedImages, keyMode = "name") {
  const fields = {};
  const value = uploadedImages.map((item) => ({ file_token: item.file_token })).filter((item) => item.file_token);
  if (!value.length) return fields;
  for (const field of schema?.fields || []) {
    if (hiddenFromCollector(field)) continue;
    if (fieldKind(field) === "attachment") {
      fields[keyMode === "name" ? field.name || field.id : field.id || field.name] = value;
    }
  }
  return fields;
}

function removeAttachmentFields(fields, schema) {
  const attachmentKeys = new Set();
  for (const field of schema?.fields || []) {
    if (fieldKind(field) === "attachment") {
      attachmentKeys.add(field.id);
      attachmentKeys.add(field.name);
    }
  }
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !attachmentKeys.has(key)));
}

function recordHasAttachments(recordResult, schema) {
  const fields = recordResult?.data?.record?.fields || recordResult?.record?.fields || recordResult?.fields || {};
  return (schema?.fields || []).some((field) => {
    if (fieldKind(field) !== "attachment") return false;
    const value = fields[field.name] ?? fields[field.id];
    return Array.isArray(value) && value.length > 0;
  });
}

function looksLikeUrl(value) {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value.trim());
}

function convertUrlStrings(fields) {
  let converted = false;
  const next = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (looksLikeUrl(value)) {
      const link = value.trim();
      next[key] = { text: link, link };
      converted = true;
    } else {
      next[key] = value;
    }
  }
  return { fields: next, converted };
}

async function createRecordWithRetry(settings, tableId, createFields, debug) {
  const path = `/open-apis/bitable/v1/apps/${encodeURIComponent(settings.targetBaseToken)}/tables/${encodeURIComponent(tableId)}/records?user_id_type=open_id`;
  try {
    return await feishu(path, {
      method: "POST",
      body: JSON.stringify({ fields: createFields })
    });
  } catch (error) {
    if (!String(error.message || "").includes("URLFieldConvFail")) throw error;
    const retry = convertUrlStrings(createFields);
    debug.urlRetryFields = retry.fields;
    if (!retry.converted) throw error;
    return await feishu(path, {
      method: "POST",
      body: JSON.stringify({ fields: retry.fields })
    });
  }
}

function formatDateTime(isoString) {
  const date = Number.isNaN(Date.parse(isoString || "")) ? new Date() : new Date(isoString);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

async function syncCapture(capture) {
  const settings = await getSettings();
  const tableId = capture.targetTableId || settings.targetTableId;
  if (!settings.targetBaseToken || !tableId) {
    throw new Error("请先在设置页初始化飞书多维表格");
  }
  const fieldMap =
    settings.tableFieldMaps?.[tableId] ||
    (tableId === settings.targetTableId && settings.fieldMap && Object.keys(settings.fieldMap).length
      ? settings.fieldMap
      : (await loadTableSchema(settings.targetBaseToken, tableId)).fieldMap);
  const schema =
    settings.tableSchemas?.[tableId] ||
    (await loadTableSchema(settings.targetBaseToken, tableId));

  const uploadedImages = [];
  const failedImages = [];
  const mediaItems = [
    ...(capture.images || []).map((item) => ({ ...item, kind: "image" })),
    ...(capture.videos || []).map((item) => ({ ...item, kind: "video" }))
  ];
  for (const [index, media] of mediaItems.entries()) {
    try {
      uploadedImages.push(await uploadMedia(media, index, settings.targetBaseToken));
    } catch (error) {
      failedImages.push(`${media.url}: ${error.message}`);
    }
  }

  const fields = buildRecordFields(schema, fieldMap, capture, uploadedImages, failedImages, "name");
  const createFields = removeAttachmentFields(fields, schema);
  const debug = {
    at: new Date().toISOString(),
    baseToken: settings.targetBaseToken,
    tableId,
    mediaItems: mediaItems.map((item) => ({ kind: item.kind, url: item.url })),
    uploadedImages,
    failedImages,
    attachmentFields: (schema.fields || [])
      .filter((field) => fieldKind(field) === "attachment")
      .map((field) => ({ id: field.id, name: field.name, type: field.type })),
    recordFields: fields,
    createFields,
    attachmentUpdates: []
  };
  await storageSet({ [STORAGE_KEYS.LAST_SYNC_DEBUG]: debug });
  let data;
  try {
    data = await createRecordWithRetry(settings, tableId, createFields, debug);
  } catch (error) {
    const failedDebug = { ...debug, createError: error.message };
    await storageSet({ [STORAGE_KEYS.LAST_SYNC_DEBUG]: failedDebug });
    console.error("[Prompt Collector] sync failed", failedDebug);
    throw error;
  }
  const record = data.data?.record || data.data || {};
  const recordId = record.record_id || record.id;

  let createdRecord = null;
  let attachmentUpdated = false;
  const readRecord = () => feishu(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(settings.targetBaseToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}?user_id_type=open_id`
  );

  if (recordId && uploadedImages.length) {
    for (const keyMode of ["name", "id"]) {
      const attachmentFields = buildAttachmentFields(schema, uploadedImages, keyMode);
      if (!Object.keys(attachmentFields).length) continue;
      const attempt = { keyMode, fields: attachmentFields };
      try {
        const updateResponse = await feishu(
          `/open-apis/bitable/v1/apps/${encodeURIComponent(settings.targetBaseToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}?user_id_type=open_id`,
          {
            method: "PUT",
            body: JSON.stringify({ fields: attachmentFields })
          }
        );
        createdRecord = await readRecord().catch((error) => ({ readError: error.message }));
        attempt.response = updateResponse;
        attempt.recordHasAttachments = recordHasAttachments(createdRecord, schema);
        debug.attachmentUpdates.push(attempt);
        if (attempt.recordHasAttachments) {
          attachmentUpdated = true;
          break;
        }
      } catch (error) {
        attempt.error = error.message;
        debug.attachmentUpdates.push(attempt);
      }
    }
  }

  if (!createdRecord && recordId) {
    createdRecord = await readRecord().catch((error) => ({ readError: error.message }));
  }

  const finalDebug = {
    ...debug,
    recordId,
    createResponse: data,
    createdRecord,
    attachmentUpdated
  };
  await storageSet({
    [STORAGE_KEYS.LAST_SYNC_DEBUG]: finalDebug
  });
  console.log("[Prompt Collector] sync debug", finalDebug);
  return {
    ok: true,
    recordId,
    recordUrl: recordUrl(settings, tableId, recordId),
    uploadedImages: uploadedImages.length,
    uploadedTokens: uploadedImages.map((item) => item.file_token),
    failedImages,
    attachmentUpdated,
    debugSaved: true
  };
}

async function handleMessage(message) {
  switch (message?.type) {
    case "settings:get":
      return {
        settings: await getSettings(),
        tokens: await getTokens(),
        secret: { saved: Boolean(await getSecretVault()), unlocked: Boolean(sessionClientSecret || (await getSecretVault())?.secret) }
      };
    case "sourceTab:get":
      return { ok: true, tab: sourceTab };
    case "debug:lastSync": {
      const data = await storageGet([STORAGE_KEYS.LAST_SYNC_DEBUG]);
      return { ok: true, debug: data[STORAGE_KEYS.LAST_SYNC_DEBUG] || null };
    }
    case "settings:save":
      return { settings: await setSettings(message.patch || {}) };
    case "secret:save":
      return { ok: true, secret: await saveClientSecret(message) };
    case "secret:unlock":
      sessionClientSecret = await clientSecret();
      return { ok: true, secret: { unlocked: true } };
    case "oauth:start":
      try {
        return { ok: true, tokens: await startOAuth(), settings: await getSettings() };
      } catch (error) {
        return { ok: false, errorCode: error.code || "OAUTH_FAILED", message: error.message };
      }
    case "oauth:disconnect":
      await chrome.storage.local.remove([STORAGE_KEYS.TOKENS, STORAGE_KEYS.OAUTH]);
      return { settings: await setSettings({ authStatus: "disconnected" }) };
    case "target:init":
      return { ok: true, target: await bindExistingBase(message.targetInput || "") };
    case "target:refreshTables": {
      const settings = await getSettings();
      if (!settings.targetBaseToken) throw new Error("请先绑定多维表格");
      const targetTables = await listBaseTables(settings.targetBaseToken);
      const next = await setSettings({
        targetTables,
        targetTableId: targetTables.some((table) => table.tableId === settings.targetTableId)
          ? settings.targetTableId
          : targetTables[0]?.tableId || ""
      });
      return { ok: true, settings: next };
    }
    case "target:selectTable": {
      const settings = await getSettings();
      const targetTableId = message.tableId || "";
      if (!settings.targetTables?.some((table) => table.tableId === targetTableId)) {
        throw new Error("目标数据表不存在，请先刷新数据表列表");
      }
      const { fieldMap } = await loadTableSchema(settings.targetBaseToken, targetTableId);
      return { ok: true, settings: await setSettings({ targetTableId, fieldMap }) };
    }
    case "target:getSchema": {
      const settings = await getSettings();
      const tableId = message.tableId || settings.targetTableId;
      if (!settings.targetBaseToken || !tableId) throw new Error("请先选择数据表");
      const cachedSchema = settings.tableSchemas?.[tableId];
      const hasStableOrder = cachedSchema?.fields?.every((field) => Number.isFinite(Number(field.order)));
      const schema = message.refresh || !cachedSchema || !hasStableOrder
        ? await loadTableSchema(settings.targetBaseToken, tableId)
        : cachedSchema;
      const fieldMap = (await getSettings()).tableFieldMaps?.[tableId] || schema.fieldMap || {};
      return { ok: true, schema, fieldMap };
    }
    case "capture:sync":
      return await syncCapture(message.capture);
    default:
      throw new Error(`未知消息类型：${message?.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, message: error.message, errorCode: error.code || "UNKNOWN" }));
  return true;
});

chrome.action.onClicked.addListener((tab) => {
  openCollectorOverlay(tab).catch(() => {});
});
