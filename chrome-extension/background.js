// ===== 消息处理 =====
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === "download") {
    chrome.downloads.download({
      url: msg.url,
      filename: msg.filename || "doubao_video_" + Date.now() + ".mp4",
      saveAs: false,
      conflictAction: "uniquify",
    }, function(downloadId) {
      sendResponse({ success: true, downloadId: downloadId });
    });
    return true;
  }

  // content script 通知：我已加载，快挂 debugger
  if (msg.type === "attach_debugger" && sender.tab && sender.tab.id) {
    ensureDebugger(sender.tab.id);
    return false;
  }

  // background 直调 doubao API（兜底，可能因无 cookie 被拒）
  if (msg.type === "fetch_clean_video" && msg.vid) {
    var apiUrl = "https://www.doubao.com/samantha/media/get_play_info?version_code=20800&language=zh-CN&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=&pc_version=2.51.7&region=&sys_region=&samantha_web=1&use-olympus-account=1&web_tab_id=" + crypto.randomUUID();
    fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ key: msg.vid })
    }).then(function(r) { return r.json(); }).then(function(data) {
      console.log("[bg] get_play_info 响应:", data.code, data.message || "");
      if (data.code === 0 && data.data) {
        var d = data.data;
        var url = (d.original_media_info && d.original_media_info.main_url)
          || (d.play_infos && d.play_infos[0] && d.play_infos[0].main)
          || (d.play_info && d.play_info.main);
        if (url) {
          url = url.replace(/lr=[^&]+/g, "lr=unwatermarked");
          console.log("[bg] 无水印地址:", url.slice(0, 100));
          sendResponse({ url: url });
          return;
        }
      }
      sendResponse({ url: null });
    }).catch(function(err) {
      console.warn("[bg] API 请求失败:", err.message);
      sendResponse({ url: null });
    });
    return true;
  }
});

// ===== Debugger 拦截 API 响应，提取无水印视频 URL =====
var attachedTabs = {};

function sendCmd(tabId, method, params) {
  return new Promise(function(resolve, reject) {
    chrome.debugger.sendCommand({ tabId: tabId }, method, params || {}, function(result) {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      resolve(result);
    });
  });
}

function shouldAttach(url) {
  return url && (url.includes("doubao.com/chat") || url.includes("dola.com/chat"));
}

function b64decode(v) {
  if (v.startsWith("http")) return v;
  try { return atob(v.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(v.length/4)*4,"=")); }
  catch(e) { return ""; }
}

function walkJson(obj, visitor, seen) {
  if (!seen) seen = new Set();
  if (!obj || seen.has(obj)) return;

  // 字符串可能是 JSON 编码的，尝试解析
  if (typeof obj === "string") {
    var trimmed = obj.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && !seen.has(trimmed)) {
      try { walkJson(JSON.parse(trimmed), visitor, seen); } catch(e) {}
    }
    return;
  }

  if (typeof obj !== "object") return;
  seen.add(obj);
  visitor(obj);
  if (Array.isArray(obj)) { obj.forEach(function(v) { walkJson(v, visitor, seen); }); }
  else { Object.keys(obj).forEach(function(k) { walkJson(obj[k], visitor, seen); }); }
}

function findValues(obj, key) {
  var vals = [];
  walkJson(obj, function(node) {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      if (Object.prototype.hasOwnProperty.call(node, key)) vals.push(node[key]);
    }
  });
  return vals;
}

async function ensureDebugger(tabId) {
  if (attachedTabs[tabId]) return;
  try {
    await new Promise(function(resolve, reject) {
      chrome.debugger.attach({ tabId: tabId }, "1.3", function() {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        resolve();
      });
    });

    // 跟 watermark-helper 一样拦截 chain/single + chat/completion + samantha
    // 同时覆盖 doubao.com 和 dola.com
    await sendCmd(tabId, "Fetch.enable", {
      patterns: [
        // doubao.com 的 API
        { urlPattern: "*doubao.com/*chat*", requestStage: "Response" },
        { urlPattern: "*doubao.com/*chain*", requestStage: "Response" },
        { urlPattern: "*doubao.com/*message*", requestStage: "Response" },
        { urlPattern: "*doubao.com/*samantha*", requestStage: "Response" },
        // dola.com 的 API
        { urlPattern: "*dola.com/*chat*", requestStage: "Response" },
        { urlPattern: "*dola.com/*chain*", requestStage: "Response" },
        { urlPattern: "*dola.com/*message*", requestStage: "Response" },
        { urlPattern: "*dola.com/*samantha*", requestStage: "Response" },
        // 通用：任何域名的 chain/single
        { urlPattern: "*doubao.com/im/chain/single*", requestStage: "Response" },
        { urlPattern: "*dola.com/im/chain/single*", requestStage: "Response" }
      ]
    });
    attachedTabs[tabId] = true;
    console.log("[bg] debugger ready, tab:", tabId);
  } catch(e) {
    console.warn("[bg] debugger fail:", e.message);
  }
}

// 多种时机附加 debugger
chrome.tabs.onUpdated.addListener(function(tabId, info, tab) {
  if (info.status === "loading" && shouldAttach(tab && tab.url)) ensureDebugger(tabId);
});
chrome.tabs.onActivated.addListener(function(info) {
  chrome.tabs.get(info.tabId, function(tab) {
    if (shouldAttach(tab && tab.url)) ensureDebugger(info.tabId);
  });
});
chrome.runtime.onStartup.addListener(function() {
  chrome.tabs.query({}, function(tabs) {
    tabs.forEach(function(t) { if (shouldAttach(t.url)) ensureDebugger(t.id); });
  });
});

chrome.tabs.onRemoved.addListener(function(tabId) { delete attachedTabs[tabId]; });
chrome.debugger.onDetach.addListener(function(src) { delete attachedTabs[src.tabId]; });

// 拦截响应，提取视频地址（跟 watermark-helper 一样从 man_url/main_url 解码）
chrome.debugger.onEvent.addListener(async function(source, method, params) {
  if (method !== "Fetch.requestPaused" || !params) return;
  var tabId = source.tabId;
  var reqId = params.requestId;
  var event = params;
  var url = (event.request || {}).url || "";

  console.log("[bg] intercepted:", url.slice(0, 120));

  try {
    var resp = await sendCmd(tabId, "Fetch.getResponseBody", { requestId: reqId });
    var text = resp.base64Encoded ? atob(resp.body) : resp.body;
    var json;

    try { json = JSON.parse(text); }
    catch(e) { console.log("[bg] JSON parse failed for:", url.slice(0, 80)); await sendCmd(tabId, "Fetch.continueRequest", { requestId: reqId }); return; }

    var items = [];
    var seen = new Set();

    // ===== 方法1: 直接正则匹配原始 JSON 文本（跟 dola 项目一样，能穿透转义层） =====
    // 匹配 "main_url":"BASE64..." 格式
    var mainUrlRegex1 = /"main_url"\s*:\s*"([A-Za-z0-9+/=_-]{80,})"/g;
    var mainUrlRegex2 = /\\"main_url\\"\s*:\s*\\"([A-Za-z0-9+/=_-]{80,})\\"/g;
    var manUrlRegex = /"man_url"\s*:\s*"([A-Za-z0-9+/=_-]{80,})"/g;
    var match;
    while ((match = mainUrlRegex1.exec(text)) !== null) {
      var decoded = b64decode(match[1]);
      if (decoded && decoded.startsWith("http") && !seen.has(decoded)) {
        seen.add(decoded);
        decoded = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
        items.push({ type: "video", url: decoded });
        console.log("[bg] 正则提取 (main_url 普通):", decoded.slice(0, 100));
      }
    }
    while ((match = mainUrlRegex2.exec(text)) !== null) {
      var decoded = b64decode(match[1]);
      if (decoded && decoded.startsWith("http") && !seen.has(decoded)) {
        seen.add(decoded);
        decoded = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
        items.push({ type: "video", url: decoded });
        console.log("[bg] 正则提取 (main_url 转义):", decoded.slice(0, 100));
      }
    }
    while ((match = manUrlRegex.exec(text)) !== null) {
      var decoded = b64decode(match[1]);
      if (decoded && decoded.startsWith("http") && !seen.has(decoded)) {
        seen.add(decoded);
        decoded = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
        items.push({ type: "video", url: decoded });
        console.log("[bg] 正则提取 (man_url):", decoded.slice(0, 100));
      }
    }

    // ===== 方法2: JSON 树遍历（兜底） =====
    var manUrls = findValues(json, "man_url");
    var mainUrls = findValues(json, "main_url");
    if (manUrls.length || mainUrls.length) {
      console.log("[bg] JSON遍历 找到 man_url:", manUrls.length, "main_url:", mainUrls.length);
    }
    manUrls.concat(mainUrls).forEach(function(v) {
      var decoded = b64decode(v);
      if (decoded && decoded.startsWith("http") && !seen.has(decoded)) {
        seen.add(decoded);
        decoded = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
        items.push({ type: "video", url: decoded });
        console.log("[bg] JSON提取 (man/main_url):", decoded.slice(0, 100));
      }
    });

    // play_info.main / original_media_info.main_url
    findValues(json, "play_info").forEach(function(pi) {
      if (pi && pi.main && pi.main.startsWith("http") && !seen.has(pi.main)) {
        seen.add(pi.main);
        var cleaned = pi.main.replace(/lr=[^&]+/g, "lr=unwatermarked");
        items.push({ type: "video", url: cleaned });
        console.log("[bg] 提取视频 URL (play_info):", cleaned.slice(0, 100));
      }
    });
    findValues(json, "original_media_info").forEach(function(omi) {
      if (omi && omi.main_url && omi.main_url.startsWith("http") && !seen.has(omi.main_url)) {
        seen.add(omi.main_url);
        var cleaned = omi.main_url.replace(/lr=[^&]+/g, "lr=unwatermarked");
        items.push({ type: "video", url: cleaned });
        console.log("[bg] 提取视频 URL (original_media_info):", cleaned.slice(0, 100));
      }
    });

    // 通知页面
    items.forEach(function(item) {
      chrome.tabs.sendMessage(tabId, { type: "clean_video_url", url: item.url, timestamp: Date.now() }).catch(function(){});
    });

    // 放行响应
    var body = resp.body;
    var headers = (event.responseHeaders || []).slice();
    var hasCL = headers.some(function(h) { return h.name.toLowerCase() === "content-length"; });
    if (!hasCL) headers.push({ name: "Content-Length", value: String(new TextEncoder().encode(text).length) });

    chrome.debugger.sendCommand({ tabId: tabId }, "Fetch.fulfillRequest", {
      requestId: reqId,
      responseCode: event.responseStatusCode || 200,
      responseHeaders: headers,
      body: body
    }, function(){});
  } catch(e) {
    console.warn("[bg] 处理拦截请求失败:", e.message || e, url.slice(0, 80));
    chrome.debugger.sendCommand({ tabId: tabId }, "Fetch.continueRequest", { requestId: reqId }, function(){});
  }
});
