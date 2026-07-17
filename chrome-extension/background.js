// 监听下载请求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "download") {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename || `doubao_video_${Date.now()}.mp4`,
      saveAs: false,
      conflictAction: "uniquify",
    }, (downloadId) => {
      sendResponse({ success: true, downloadId });
    });
    return true; // 异步响应
  }
});
