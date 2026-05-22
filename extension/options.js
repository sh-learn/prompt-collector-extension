const els = {
  feishuAppId: document.querySelector("#feishuAppId"),
  feishuAppSecret: document.querySelector("#feishuAppSecret"),
  redirectUri: document.querySelector("#redirectUri"),
  targetInput: document.querySelector("#targetInput"),
  authStatus: document.querySelector("#authStatus"),
  secretStatus: document.querySelector("#secretStatus"),
  baseToken: document.querySelector("#baseToken"),
  tableId: document.querySelector("#tableId"),
  tableCount: document.querySelector("#tableCount"),
  status: document.querySelector("#status"),
  saveApp: document.querySelector("#saveApp"),
  connect: document.querySelector("#connect"),
  disconnect: document.querySelector("#disconnect"),
  initTarget: document.querySelector("#initTarget"),
  refreshTables: document.querySelector("#refreshTables"),
  copyRedirect: document.querySelector("#copyRedirect")
};

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response && response.ok === false) {
    const error = new Error(response.message || "操作失败");
    error.code = response.errorCode;
    throw error;
  }
  return response;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#b42318" : "#667085";
}

function render(settings, secret = {}) {
  els.feishuAppId.value = settings.feishuAppId || "";
  els.redirectUri.value = settings.redirectUri || "";
  els.targetInput.value = settings.targetInput || "";
  els.authStatus.textContent = settings.authStatus || "disconnected";
  els.secretStatus.textContent = secret.saved ? "已保存于本机" : "未保存";
  els.baseToken.textContent = settings.targetBaseToken || "-";
  els.tableId.textContent = settings.targetTableId || "-";
  const tables = settings.targetTables || [];
  els.tableCount.textContent = tables.length ? tables.map((table) => table.name || table.tableId).join(" / ") : "-";
}

async function renderLatest(settingsFallback = null) {
  const latest = await send({ type: "settings:get" });
  render(latest.settings || settingsFallback, latest.secret);
}

async function refresh() {
  const { settings, secret } = await send({ type: "settings:get" });
  render(settings, secret);
}

async function saveAppInfo() {
  const { settings } = await send({
    type: "settings:save",
    patch: { feishuAppId: els.feishuAppId.value.trim() }
  });

  const secret = els.feishuAppSecret.value.trim();
  if (secret) {
    await send({ type: "secret:save", secret });
    els.feishuAppSecret.value = "";
  }
  await renderLatest(settings);
}

els.saveApp.addEventListener("click", async () => {
  try {
    await saveAppInfo();
    setStatus("应用信息已保存");
  } catch (error) {
    setStatus(error.message || "保存失败", true);
  }
});

els.copyRedirect.addEventListener("click", async () => {
  await navigator.clipboard.writeText(els.redirectUri.value);
  setStatus("Redirect URL 已复制");
});

els.connect.addEventListener("click", async () => {
  try {
    await saveAppInfo();
    setStatus("正在打开飞书授权...");
    const response = await send({ type: "oauth:start" });
    await renderLatest(response.settings);
    setStatus("飞书已连接");
  } catch (error) {
    if (error.code === "SECRET_LOCKED") {
      setStatus("请先保存飞书 App Secret。", true);
    } else {
      setStatus(error.message || "连接失败", true);
    }
    await refresh();
  }
});

els.disconnect.addEventListener("click", async () => {
  const { settings } = await send({ type: "oauth:disconnect" });
  render(settings);
  setStatus("已断开飞书");
});

els.initTarget.addEventListener("click", async () => {
  try {
    await send({
      type: "settings:save",
      patch: { targetInput: els.targetInput.value.trim() }
    });
    setStatus("正在绑定多维表格...");
    const response = await send({ type: "target:init", targetInput: els.targetInput.value.trim() });
    await renderLatest(response.target.settings);
    setStatus(response.target.boundExisting ? "已绑定目标多维表格" : "Prompt 列表已创建");
  } catch (error) {
    setStatus(error.message || "创建失败", true);
  }
});

els.refreshTables.addEventListener("click", async () => {
  try {
    setStatus("正在刷新数据表列表...");
    const response = await send({ type: "target:refreshTables" });
    await renderLatest(response.settings);
    setStatus("数据表列表已刷新");
  } catch (error) {
    setStatus(error.message || "刷新失败", true);
  }
});

document.addEventListener("DOMContentLoaded", refresh);
