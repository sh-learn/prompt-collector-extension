(() => {
  const HOST_ID = "prompt-collector-overlay-host";

  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.style.display = "block";
    existing.scrollIntoView({ block: "nearest", inline: "nearest" });
    return;
  }

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    :host {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 2147483647;
      width: min(430px, calc(100vw - 24px));
      height: calc(100vh - 24px);
      border: 1px solid rgba(208, 213, 221, 0.95);
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(15, 23, 42, 0.22);
      overflow: hidden;
      background: #f6f7f9;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #f6f7f9;
    }
  `;

  const frame = document.createElement("iframe");
  frame.src = chrome.runtime.getURL("popup.html?embedded=1");
  frame.title = "Prompt Collector";
  frame.allow = "clipboard-write";

  shadow.append(style, frame);
  document.documentElement.append(host);

  window.addEventListener("message", (event) => {
    if (event.data?.type === "prompt-collector:close") {
      host.remove();
    }
  });
})();
