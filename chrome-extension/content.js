// 注入主脚本
var s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
s.onload = function() { s.remove(); };
(document.head || document.documentElement).appendChild(s);

// 通知 background 尽快挂 debugger（document_start 时机最早）
chrome.runtime.sendMessage({ type: "attach_debugger" });

// 下载
window.addEventListener("message", function(e) {
  if (e.source !== window) return;
  var msg = e.data;

  if (msg && msg.type === "ce_download_video") {
    chrome.runtime.sendMessage({ type: "download", url: msg.url, filename: msg.filename }, function(downloadId) {
      window.postMessage({ type: "ce_download_started", url: msg.url, downloadId: downloadId }, "*");
    });
  }

  // 获取无水印视频 → 用相对路径调 dola API（同源无 CORS + 带 cookie 认证）
  if (msg && msg.type === "fetch_clean_video" && msg.vid) {
    var apiUrl = "/samantha/media/get_play_info?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version&web_tab_id=" + crypto.randomUUID();
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key: msg.vid })
    }).then(function(r) { return r.json(); }).then(function(data) {
      console.log("[content] get_play_info (relative) 响应:", data.code, data.message || "");
      if (data.code === 0 && data.data) {
        var d = data.data;
        var url = (d.original_media_info && d.original_media_info.main_url)
          || (d.play_infos && d.play_infos[0] && d.play_infos[0].main)
          || (d.play_info && d.play_info.main);
        if (url) {
          url = url.replace(/lr=[^&]+/g, "lr=unwatermarked");
          console.log("[content] 无水印地址:", url.slice(0, 100));
          window.postMessage({ type: "clean_video_url", url: url, timestamp: Date.now() }, "*");
        } else {
          console.warn("[content] 响应中未找到视频地址");
          window.postMessage({ type: "clean_video_url", url: null }, "*");
        }
      } else {
        console.warn("[content] API 返回非 0:", data.code, data.message);
        window.postMessage({ type: "clean_video_url", url: null }, "*");
      }
    }).catch(function(err) {
      console.warn("[content] API 请求失败:", err.message);
      window.postMessage({ type: "clean_video_url", url: null }, "*");
    });
  }
});

// debugger 转发的消息
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === "clean_video_url" && msg.url) {
    window.postMessage({ type: "clean_video_url", url: msg.url, timestamp: msg.timestamp }, "*");
  }
});
