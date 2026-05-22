import http from "node:http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const env = process.env;
const PORT = Number(env.PORT || 8787);
const API_BASE = (env.LARK_OPENAPI_BASE || "https://open.feishu.cn").replace(/\/$/, "");
const STORAGE_BACKEND = env.STORAGE_BACKEND || "lark-cli";
const LARK_CLI_BIN = env.LARK_CLI_BIN || "lark-cli";
const LARK_CLI_AS = env.LARK_CLI_AS || "";

const fieldMap = {
  title: env.FIELD_TITLE || "标题",
  prompt: env.FIELD_PROMPT || "Prompt",
  sourceUrl: env.FIELD_SOURCE_URL || "来源链接",
  pageTitle: env.FIELD_PAGE_TITLE || "页面标题",
  author: env.FIELD_AUTHOR || "作者",
  images: env.FIELD_IMAGES || "图片",
  capturedAt: env.FIELD_CAPTURED_AT || "采集时间",
  rawJson: env.FIELD_RAW_JSON || "原始数据"
};

let cachedTenantToken = null;
let cachedTenantTokenExpiresAt = 0;
let cachedBaseToken = null;

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function runCli(args) {
  const finalArgs = LARK_CLI_AS ? [...args, "--as", LARK_CLI_AS] : args;
  return new Promise((resolve, reject) => {
    const child = spawn(LARK_CLI_BIN, finalArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new Error(`lark-cli 失败：${err || out || `exit ${code}`}`));
        return;
      }
      try {
        resolve(JSON.parse(out || "{}"));
      } catch {
        resolve({ raw: out.trim() });
      }
    });
  });
}

function jsonResponse(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function feishu(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok || (data && typeof data === "object" && data.code && data.code !== 0)) {
    const message = typeof data === "object" ? data.msg || data.error || JSON.stringify(data) : data;
    throw new Error(`飞书 API 失败：${message}`);
  }
  return data;
}

async function tenantToken() {
  if (cachedTenantToken && Date.now() < cachedTenantTokenExpiresAt) return cachedTenantToken;

  const data = await feishu("/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: required("LARK_APP_ID"),
      app_secret: required("LARK_APP_SECRET")
    })
  });

  cachedTenantToken = data.tenant_access_token;
  cachedTenantTokenExpiresAt = Date.now() + Math.max(60, Number(data.expire || 7200) - 300) * 1000;
  return cachedTenantToken;
}

async function authHeaders() {
  return {
    authorization: `Bearer ${await tenantToken()}`
  };
}

async function baseToken() {
  if (cachedBaseToken) return cachedBaseToken;
  if (env.LARK_BASE_TOKEN) {
    cachedBaseToken = env.LARK_BASE_TOKEN;
    return cachedBaseToken;
  }

  if (STORAGE_BACKEND === "lark-cli") {
    const data = await runCli([
      "wiki",
      "spaces",
      "get_node",
      "--params",
      JSON.stringify({ token: required("LARK_WIKI_TOKEN") })
    ]);
    const node = data.data?.node || data.node;
    if (node?.obj_type !== "bitable") {
      throw new Error(`Wiki 节点不是多维表格，而是 ${node?.obj_type || "未知类型"}`);
    }
    cachedBaseToken = node.obj_token;
    return cachedBaseToken;
  }

  const wikiToken = required("LARK_WIKI_TOKEN");
  const data = await feishu(`/open-apis/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`, {
    headers: await authHeaders()
  });
  if (data.data?.node?.obj_type !== "bitable") {
    throw new Error(`Wiki 节点不是多维表格，而是 ${data.data?.node?.obj_type || "未知类型"}`);
  }
  cachedBaseToken = data.data.node.obj_token;
  return cachedBaseToken;
}

function cleanFilename(url, index) {
  try {
    const pathname = new URL(url).pathname;
    const name = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
    if (name && /\.[a-z0-9]{2,5}$/i.test(name)) return name.slice(0, 80);
  } catch {
    // fall through
  }
  return `prompt-image-${index + 1}.jpg`;
}

async function downloadImage(image, index) {
  const response = await fetch(image.url, {
    headers: {
      "user-agent": "Mozilla/5.0 PromptCollector/0.1"
    }
  });
  if (!response.ok) throw new Error(`图片下载失败：${response.status} ${image.url}`);
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  return {
    filename: cleanFilename(image.url, index),
    contentType,
    buffer: Buffer.from(arrayBuffer)
  };
}

async function uploadDriveMedia(file) {
  const form = new FormData();
  form.set("file_name", file.filename);
  form.set("parent_type", "bitable_image");
  form.set("parent_node", await baseToken());
  form.set("size", String(file.buffer.length));
  form.set("file", new Blob([file.buffer], { type: file.contentType }), file.filename);

  const data = await feishu("/open-apis/drive/v1/medias/upload_all", {
    method: "POST",
    headers: await authHeaders(),
    body: form
  });
  return data.data?.file_token;
}

async function uploadImages(images = []) {
  const tokens = [];
  for (const [index, image] of images.entries()) {
    if (!image?.url) continue;
    try {
      const file = await downloadImage(image, index);
      const fileToken = await uploadDriveMedia(file);
      if (fileToken) {
        tokens.push({ file_token: fileToken });
      }
    } catch (error) {
      console.warn(error.message);
    }
  }
  return tokens;
}

function buildFields(capture, imageTokens) {
  const fields = {};
  const assign = (fieldName, value) => {
    if (fieldName && value !== undefined && value !== null && value !== "") {
      fields[fieldName] = value;
    }
  };

  assign(fieldMap.title, capture.title || capture.pageTitle || "未命名提示词");
  assign(fieldMap.prompt, capture.prompt);
  assign(fieldMap.sourceUrl, { text: capture.sourceUrl, link: capture.sourceUrl });
  assign(fieldMap.pageTitle, capture.pageTitle);
  assign(fieldMap.author, capture.author);
  assign(fieldMap.images, imageTokens);
  assign(fieldMap.capturedAt, Date.parse(capture.capturedAt || "") || Date.now());
  assign(fieldMap.rawJson, JSON.stringify(capture, null, 2));
  return fields;
}

function formatDateTime(isoString) {
  const date = Number.isNaN(Date.parse(isoString || "")) ? new Date() : new Date(isoString);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildCliFields(capture) {
  const fields = {};
  const assign = (fieldName, value) => {
    if (fieldName && fieldName !== fieldMap.images && value !== undefined && value !== null && value !== "") {
      fields[fieldName] = value;
    }
  };

  assign(fieldMap.title, capture.title || capture.pageTitle || "未命名提示词");
  assign(fieldMap.prompt, capture.prompt);
  assign(fieldMap.sourceUrl, capture.sourceUrl);
  assign(fieldMap.pageTitle, capture.pageTitle);
  assign(fieldMap.author, capture.author);
  assign(fieldMap.capturedAt, formatDateTime(capture.capturedAt));
  assign(fieldMap.rawJson, JSON.stringify(capture, null, 2));
  return fields;
}

function findRecordId(value) {
  if (!value || typeof value !== "object") return "";
  if (typeof value.record_id === "string") return value.record_id;
  if (typeof value.id === "string" && value.id.startsWith("rec")) return value.id;
  for (const child of Object.values(value)) {
    const found = findRecordId(child);
    if (found) return found;
  }
  return "";
}

async function createRecordViaApi(capture) {
  const token = await baseToken();
  const tableId = required("LARK_TABLE_ID");
  const imageTokens = await uploadImages(capture.images);
  const fields = buildFields(capture, imageTokens);

  const data = await feishu(`/open-apis/bitable/v1/apps/${token}/tables/${tableId}/records`, {
    method: "POST",
    headers: {
      ...(await authHeaders()),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ fields })
  });
  return data.data?.record;
}

async function createRecordViaCli(capture) {
  const token = await baseToken();
  const tableId = required("LARK_TABLE_ID");
  const fields = buildCliFields(capture);
  const record = await runCli([
    "base",
    "+record-upsert",
    "--base-token",
    token,
    "--table-id",
    tableId,
    "--json",
    JSON.stringify(fields)
  ]);
  const recordId = findRecordId(record);
  if (!recordId) throw new Error(`lark-cli 没有返回 record_id：${JSON.stringify(record)}`);

  if (fieldMap.images && capture.images?.length) {
    await uploadAttachmentsViaCli(capture.images, token, tableId, recordId);
  }
  return { ...record, record_id: recordId };
}

async function uploadAttachmentsViaCli(images, token, tableId, recordId) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "prompt-collector-"));
  try {
    for (const [index, image] of images.entries()) {
      if (!image?.url) continue;
      try {
        const file = await downloadImage(image, index);
        const filePath = path.join(tempDir, file.filename);
        await writeFile(filePath, file.buffer);
        await runCli([
          "base",
          "+record-upload-attachment",
          "--base-token",
          token,
          "--table-id",
          tableId,
          "--record-id",
          recordId,
          "--field-id",
          fieldMap.images,
          "--file",
          filePath,
          "--name",
          file.filename
        ]);
      } catch (error) {
        console.warn(error.message);
      }
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function createRecord(capture) {
  if (STORAGE_BACKEND === "lark-cli") {
    return createRecordViaCli(capture);
  }
  return createRecordViaApi(capture);
}

function validateCapture(capture) {
  if (!capture || typeof capture !== "object") throw new Error("capture 不能为空");
  if (!capture.sourceUrl) throw new Error("缺少来源链接");
  if (!capture.prompt && !capture.title && !capture.images?.length) {
    throw new Error("没有可保存的提示词或图片");
  }
}

async function handler(req, res) {
  if (req.method === "OPTIONS") return jsonResponse(res, 204, {});
  if (req.method === "GET" && req.url === "/health") {
    return jsonResponse(res, 200, { ok: true });
  }
  if (req.method === "POST" && req.url === "/capture") {
    try {
      const capture = await readJson(req);
      validateCapture(capture);
      const record = await createRecord(capture);
      return jsonResponse(res, 200, {
        ok: true,
        recordId: record?.record_id,
        record
      });
    } catch (error) {
      return jsonResponse(res, 500, { ok: false, error: error.message });
    }
  }
  return jsonResponse(res, 404, { ok: false, error: "not found" });
}

http.createServer(handler).listen(PORT, "127.0.0.1", () => {
  console.log(`Prompt Collector Feishu relay listening on http://127.0.0.1:${PORT} (${STORAGE_BACKEND})`);
});
