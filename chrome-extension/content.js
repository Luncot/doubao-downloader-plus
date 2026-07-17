// 注入主脚本到 MAIN world
const script = document.createElement("script");
script.src = chrome.runtime.getURL("inject.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// 监听注入脚本的下载请求，转发给 background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (msg?.type === "ce_download_video") {
    chrome.runtime.sendMessage(
      { type: "download", url: msg.url, filename: msg.filename },
      () => {}
    );
  }
});
