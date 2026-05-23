import {
  createDefaultSelection,
  selectedCapture
} from "./lib/candidate-selection.js";

const state = {
  capture: null,
  fieldValues: {},
  selection: { prompts: {}, images: {} }
};

const LAST_DRAFT_KEY = "promptCollectorLastDraft";

const els = {
  status: document.querySelector("#status"),
  tableSelect: document.querySelector("#tableSelect"),
  collect: document.querySelector("#collect"),
  save: document.querySelector("#save"),
  preview: document.querySelector("#preview"),
  fieldForm: document.querySelector("#fieldForm"),
  candidatePicker: document.querySelector("#candidatePicker"),
  candidateList: document.querySelector("#candidateList"),
  imageCount: document.querySelector("#imageCount"),
  sourceHost: document.querySelector("#sourceHost"),
  images: document.querySelector("#images"),
  recordLink: document.querySelector("#recordLink"),
  openOptions: document.querySelector("#openOptions"),
  closePopup: document.querySelector("#closePopup")
};

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#b42318" : "#667085";
}

async function loadTables() {
  const { settings } = await send({ type: "settings:get" });
  const tables = settings.targetTables || [];
  els.tableSelect.replaceChildren(
    new Option(tables.length ? "选择数据表" : "未绑定多维表格", ""),
    ...tables.map((table) => new Option(table.name || `数据表 ${table.tableId.slice(-6)}`, table.tableId))
  );
  els.tableSelect.value = tables[0]?.tableId || "";
  els.tableSelect.disabled = tables.length === 0;
  if (els.tableSelect.value && settings.targetTableId !== els.tableSelect.value) {
    await send({ type: "target:selectTable", tableId: els.tableSelect.value });
  }
}

async function saveLastDraft() {
  if (!state.capture) return;
  await chrome.storage.local.set({
    [LAST_DRAFT_KEY]: {
      capture: state.capture,
      tableId: els.tableSelect.value || "",
      fieldValues: collectFieldValues(),
      savedAt: new Date().toISOString()
    }
  });
}

function orderedFields(fields = []) {
  return fields
    .map((field, index) => ({ ...field, order: Number.isFinite(Number(field.order)) ? Number(field.order) : index }))
    .sort((a, b) => a.order - b.order);
}

function hiddenFromCollector(field = {}) {
  return String(field.name || "").trim() === "风格分类";
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

function formatDateTime(isoString) {
  const date = Number.isNaN(Date.parse(isoString || "")) ? new Date() : new Date(isoString);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultValues(capture) {
  return {
    title: capture.title || capture.pageTitle || "未命名提示词",
    prompt: capture.prompt || "",
    sourceUrl: capture.sourceUrl || "",
    pageTitle: capture.pageTitle || "",
    author: capture.author || "",
    capturedAt: formatDateTime(capture.capturedAt),
    site: capture.site || "generic",
    rawJson: JSON.stringify(capture, null, 2)
  };
}

function selectedPreviewCapture(capture) {
  return selectedCapture(capture, state.selection);
}

function defaultValueForField(field, fieldMap, capture) {
  const fieldId = field.id || field.name;
  if (state.fieldValues && Object.hasOwn(state.fieldValues, fieldId)) {
    return state.fieldValues[fieldId] ?? "";
  }
  const defaults = defaultValues(capture);
  const key = Object.entries(fieldMap || {}).find(([, fieldId]) => fieldId === field.id || fieldId === field.name)?.[0];
  return key ? defaults[key] || "" : "";
}

function optionName(option = {}) {
  return option.name || option.text || option.value || option.id || "";
}

async function loadSchema(tableId = els.tableSelect.value) {
  if (!tableId) return { fields: [], fieldMap: {} };
  const response = await send({ type: "target:getSchema", tableId });
  return { fields: orderedFields(response.schema?.fields || []), fieldMap: response.fieldMap || {} };
}

function renderFieldForm(fields, fieldMap, capture) {
  els.fieldForm.replaceChildren(
    ...fields.filter((field) => !hiddenFromCollector(field)).map((field) => {
      const kind = fieldKind(field);
      const label = document.createElement("label");
      label.className = "field-label";
      label.textContent = field.name || field.id;

      if (kind === "attachment") {
        const note = document.createElement("div");
        note.className = "field-note";
        note.dataset.fieldId = field.id || field.name;
        note.dataset.kind = kind;
        const imageCount = capture.images?.length || 0;
        const videoCount = capture.videos?.length || 0;
        note.textContent = imageCount || videoCount
          ? `${imageCount} 张图片、${videoCount} 个视频将自动上传`
          : "无可上传素材";
        label.append(note);
        return label;
      }

      const input = (() => {
        if (kind === "checkbox") return document.createElement("input");
        if (kind === "select" && field.options?.length) return document.createElement("select");
        if (kind === "number") return document.createElement("input");
        if (kind === "datetime") return document.createElement("input");
        if (kind === "url") return document.createElement("input");
        return document.createElement("textarea");
      })();
      input.className = "field-input";
      input.dataset.fieldId = field.id || field.name;
      input.dataset.kind = kind;
      if (kind === "checkbox") {
        input.type = "checkbox";
        input.checked = Boolean(defaultValueForField(field, fieldMap, capture));
      } else if (kind === "select" && field.options?.length) {
        input.multiple = Boolean(field.multiple);
        input.append(new Option("不填写", ""));
        for (const option of field.options) {
          const name = optionName(option);
          if (name) input.append(new Option(name, name));
        }
        input.value = defaultValueForField(field, fieldMap, capture);
      } else if (kind === "number") {
        input.type = "number";
        input.value = defaultValueForField(field, fieldMap, capture);
      } else if (kind === "datetime") {
        input.type = "datetime-local";
        input.value = defaultValueForField(field, fieldMap, capture);
      } else if (kind === "url") {
        input.type = "url";
        input.value = defaultValueForField(field, fieldMap, capture);
      } else {
        input.value = defaultValueForField(field, fieldMap, capture);
        input.rows = kind === "text" || kind === "select" ? 3 : 1;
      }
      label.append(input);
      return label;
    })
  );
}

async function getSourceTab() {
  const { tab } = await send({ type: "sourceTab:get" });
  if (!tab?.id) {
    throw new Error("没有找到采集来源页，请在目标网页上点击插件图标打开采集窗口。");
  }
  return tab;
}

async function collectFromPage() {
  const tab = await getSourceTab();
  const url = new URL(tab.url || "");
  const unsupportedProtocols = ["chrome:", "chrome-extension:", "edge:", "about:"];
  if (unsupportedProtocols.includes(url.protocol)) {
    throw new Error("当前页面不支持采集，请切回 X 或包含提示词的网页。");
  }
  if (/(^|\.)feishu\.cn$|(^|\.)larksuite\.com$/.test(url.hostname)) {
    throw new Error("当前是飞书页面，请切回原始 prompt 页面再采集。");
  }
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content-script.js"]
  });
  return result;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response && response.ok === false) {
    const error = new Error(response.message || "操作失败");
    error.code = response.errorCode;
    throw error;
  }
  return response;
}

async function renderPreview(capture) {
  els.preview.hidden = false;
  const previewCapture = selectedPreviewCapture(capture);
  const imageCount = previewCapture.images?.length || 0;
  const videoCount = previewCapture.videos?.length || 0;
  els.imageCount.textContent = `${imageCount} 张图片 / ${videoCount} 个视频`;
  els.sourceHost.textContent = new URL(capture.sourceUrl).hostname;
  els.recordLink.hidden = true;
  const schema = await loadSchema();
  renderCandidatePicker(capture);
  renderFieldForm(schema.fields, schema.fieldMap, previewCapture);
  els.images.replaceChildren(
    ...(previewCapture.images || []).slice(0, 8).map((image) => {
      const img = document.createElement("img");
      img.src = image.url;
      img.alt = image.alt || "";
      img.loading = "lazy";
      return img;
    }),
    ...(capture.videos || []).slice(0, 4).map((video) => {
      const element = document.createElement("video");
      element.src = video.url;
      element.poster = video.poster || "";
      element.muted = true;
      element.controls = true;
      element.preload = "metadata";
      return element;
    })
  );
  els.save.disabled = false;
}

function renderCandidatePicker(capture) {
  const candidates = capture.candidates || [];
  els.candidatePicker.hidden = !candidates.length;
  if (!candidates.length) {
    els.candidateList.replaceChildren();
    return;
  }
  els.candidateList.replaceChildren(...candidates.map((candidate) => {
    const card = document.createElement("article");
    card.className = "candidate-card";

    const header = document.createElement("div");
    header.className = "candidate-card-header";
    const kind = document.createElement("span");
    kind.className = "candidate-kind";
    kind.textContent = candidate.kind === "main" ? "主帖" : "评论";
    const author = document.createElement("span");
    author.className = "candidate-author";
    author.textContent = candidate.author || "未知作者";
    header.append(kind, author);
    card.append(header);

    if (candidate.rawText) {
      const text = document.createElement("div");
      text.className = "candidate-text";
      text.textContent = candidate.rawText;
      card.append(text);
    }

    for (const prompt of candidate.promptCandidates || []) {
      const label = document.createElement("label");
      label.className = "candidate-prompt";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(state.selection.prompts[prompt.id]);
      input.addEventListener("change", () => {
        state.selection.prompts[prompt.id] = input.checked;
        renderPreview(state.capture).then(saveLastDraft).catch(() => {});
      });
      const body = document.createElement("span");
      body.className = "candidate-prompt-text";
      body.textContent = prompt.text;
      label.append(input, body);
      card.append(label);
    }

    if (candidate.images?.length) {
      const images = document.createElement("div");
      images.className = "candidate-images";
      for (const image of candidate.images) {
        const label = document.createElement("label");
        label.className = "candidate-image";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = Boolean(state.selection.images[image.id]);
        input.addEventListener("change", () => {
          state.selection.images[image.id] = input.checked;
          renderPreview(state.capture).then(saveLastDraft).catch(() => {});
        });
        const img = document.createElement("img");
        img.src = image.url;
        img.alt = image.alt || "";
        img.loading = "lazy";
        label.append(input, img);
        images.append(label);
      }
      card.append(images);
    }
    return card;
  }));
}

async function collect() {
  try {
    setStatus("正在读取页面内容...");
    els.collect.disabled = true;
    const capture = await collectFromPage();
    state.capture = capture;
    state.fieldValues = {};
    state.selection = createDefaultSelection(capture.candidates || []);
    await renderPreview(capture);
    await saveLastDraft();
    setStatus(`已采集：${capture.images?.length || 0} 张图片，${capture.videos?.length || 0} 个视频`);
  } catch (error) {
    setStatus(error.message || "采集失败", true);
  } finally {
    els.collect.disabled = false;
  }
}

els.collect.addEventListener("click", collect);

function collectFieldValues() {
  const values = {};
  for (const input of els.fieldForm.querySelectorAll("[data-field-id]")) {
    if (input.dataset.kind === "attachment") continue;
    if (input.dataset.kind === "checkbox") {
      values[input.dataset.fieldId] = input.checked;
    } else if (input instanceof HTMLSelectElement && input.multiple) {
      values[input.dataset.fieldId] = [...input.selectedOptions].map((option) => option.value).filter(Boolean);
    } else {
      values[input.dataset.fieldId] = input.value;
    }
  }
  return values;
}

els.fieldForm.addEventListener("input", () => {
  state.fieldValues = collectFieldValues();
  saveLastDraft().catch(() => {});
});

els.fieldForm.addEventListener("change", () => {
  state.fieldValues = collectFieldValues();
  saveLastDraft().catch(() => {});
});

els.save.addEventListener("click", async () => {
  if (!state.capture) return;

  try {
    setStatus("正在保存到飞书...");
    els.save.disabled = true;
    const payload = {
      ...selectedCapture(state.capture, state.selection),
      targetTableId: els.tableSelect.value,
      fieldValues: collectFieldValues()
    };
    const result = await send({ type: "capture:sync", capture: payload });
    if (result.recordUrl) {
      els.recordLink.href = result.recordUrl;
      els.recordLink.hidden = false;
    }
    const imageNote = result.failedImages?.length ? `，${result.failedImages.length} 个素材失败` : "";
    const uploadNote = `，上传 ${result.uploadedImages || 0} 个素材`;
    const attachNote = result.uploadedImages && !result.attachmentUpdated ? "，附件未校验成功" : "";
    setStatus(`已保存到飞书：${result.recordId || "新记录"}${uploadNote}${imageNote}${attachNote}`);
    await saveLastDraft();
  } catch (error) {
    if (error.code === "SECRET_LOCKED") {
      setStatus("请先到设置页保存飞书 App Secret。", true);
    } else {
      setStatus(error.message || "保存失败", true);
    }
    els.save.disabled = false;
  }
});

els.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

els.closePopup.addEventListener("click", () => {
  chrome.storage.local.remove(LAST_DRAFT_KEY).catch(() => {});
  if (new URLSearchParams(location.search).get("embedded") === "1") {
    window.parent.postMessage({ type: "prompt-collector:close" }, "*");
  } else {
    window.close();
  }
});

els.tableSelect.addEventListener("change", async () => {
  try {
    await send({ type: "target:selectTable", tableId: els.tableSelect.value });
    await collect();
  } catch (error) {
    setStatus(error.message || "切换数据表失败", true);
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadTables().catch(() => {});
  await collect();
});
