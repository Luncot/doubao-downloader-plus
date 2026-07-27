import { useEffect } from "react";
import { cleanWatermarkUrl } from "@/utils/common";
import { DoubaoDurationUtils } from "@/lib/duration-utils";

const TARGET_MODEL = "seedance_v2.0";
const STORAGE_KEY = "doubao_15s_enabled";
const DURATION_KEY = "doubao_video_duration";
const DURATION_OPTIONS = [15, 10, 5, 4];

type MediaCallback = (e: { urls: string[]; type: "image" | "video" }) => void;

// ========== 模块级回调（React 挂载时设置，网络拦截器随时可调） ==========
let mediaCallback: MediaCallback = () => {};

export function setMediaCallback(cb: MediaCallback) {
  mediaCallback = cb;
}

// ========== 工具函数 ==========

function is15sEnabled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}

function getDuration(): number {
  try {
    const v = localStorage.getItem(DURATION_KEY);
    return v ? DoubaoDurationUtils.clampDuration(Number(v)) : 15;
  } catch { return 15; }
}

function setDuration(sec: number) {
  try { localStorage.setItem(DURATION_KEY, String(DoubaoDurationUtils.clampDuration(sec))); } catch {}
}

function isCompletionUrl(input: unknown): boolean {
  const raw = typeof input === "string" ? input : (input as any)?.url || (input as any)?.href || "";
  try {
    const url = new URL(raw, location.href);
    return /(^|\.)(doubao|dola)\.com$/.test(url.hostname) && url.pathname === "/chat/completion";
  } catch {
    return /\/chat\/completion(?:\?|$)/.test(raw);
  }
}

function parseAbilityParam(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return { ...(value as object) };
  if (typeof value === "string" && value.trim()) { try { return JSON.parse(value); } catch {} }
  return {};
}

function patchBody(rawBody: string): { changed: boolean; body: string } {
  if (typeof rawBody !== "string" || !rawBody.trim()) return { changed: false, body: rawBody };
  if (!is15sEnabled()) return { changed: false, body: rawBody };
  const result = DoubaoDurationUtils.patchVideoDurationBody(rawBody, getDuration());
  if (result.changed) {
    // 同时注入 model
    try {
      const payload = JSON.parse(result.body);
      const ability = (payload as any)?.chat_ability;
      if (ability && Number(ability.ability_type) === 17) {
        const param = parseAbilityParam(ability.ability_param);
        param.model = TARGET_MODEL;
        ability.ability_param = JSON.stringify(param);
        const finalBody = JSON.stringify(payload);
        console.log(`[15s] ✅ 已注入 ${result.duration}s 参数`);
        return { changed: true, body: finalBody };
      }
    } catch {}
    console.log(`[15s] ✅ 已注入 ${result.duration}s 参数`);
    return { changed: true, body: result.body };
  }
  return result;
}

// ========== SSE 流 + vid 提取（供下载按钮使用） ==========

if (!(window as any).__doubaoVidCache) {
  (window as any).__doubaoVidCache = new Map<string, string>();
}
// 无水印视频URL缓存：vid → cleanUrl（给下载按钮用）
if (!(window as any).__doubaoCleanUrlCache) {
  (window as any).__doubaoCleanUrlCache = new Map<string, string>();
}

function findVidInObject(obj: unknown, depth = 0): string | null {
  if (depth > 10 || !obj) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) { const f = findVidInObject(item, depth + 1); if (f) return f; }
  } else if (typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    const vid = (o.vid || o.video_id) as string | undefined;
    if (vid && typeof vid === "string" && vid.startsWith("v0")) return vid;
    for (const val of Object.values(o)) { const f = findVidInObject(val, depth + 1); if (f) return f; }
  }
  return null;
}

// ========== JSON 树遍历：提取 msg 关联的 man_url/main_url → base64 解码 → 无水印 URL ==========
function b64dec(v: string): string {
  if (v.startsWith("http")) return v;
  try { return atob(v.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(v.length / 4) * 4, "=")); }
  catch { return ""; }
}

function findVideoUrlInObject(obj: unknown, depth = 0): string | null {
  if (depth > 10 || !obj) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) { const f = findVideoUrlInObject(item, depth + 1); if (f) return f; }
  } else if (typeof obj === "object") {
    const o = obj as Record<string, unknown>;
    // man_url / main_url → base64 解码
    const manUrl = o.man_url || o.main_url;
    if (typeof manUrl === "string" && manUrl.length > 80) {
      const decoded = b64dec(manUrl);
      if (decoded && decoded.startsWith("http")) {
        let clean = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
        if (clean.startsWith("http://")) clean = clean.replace("http://", "https://");
        return clean;
      }
    }
    for (const val of Object.values(o)) { const f = findVideoUrlInObject(val, depth + 1); if (f) return f; }
  }
  return null;
}

function findAllKeys(obj: unknown, key: string): unknown[] {
  const results: unknown[] = [];
  function search(current: unknown) {
    if (current && typeof current === "object") {
      if (!Array.isArray(current) && Object.prototype.hasOwnProperty.call(current, key))
        results.push((current as Record<string, unknown>)[key]);
      const items = Array.isArray(current) ? current : Object.values(current as Record<string, unknown>);
      for (const item of items) search(item);
    }
  }
  search(obj);
  return results;
}

function extractImagesFromCreations(creations: unknown): string[] {
  const images: string[] = [];
  const list = Array.isArray(creations) ? creations : [creations];
  for (const cr of list) {
    const url = (cr as any)?.image?.image_ori_raw?.url;
    if (url && typeof url === "string" && !images.includes(url)) images.push(url);
  }
  return images;
}

function extractVideoFromPatchValue(pv: unknown): string | null {
  if (!pv || typeof pv !== "object") return null;
  const playInfos = findAllKeys(pv, "play_info");
  for (const pi of playInfos) {
    const main = (pi as any)?.main;
    if (main && typeof main === "string") return cleanWatermarkUrl(main);
  }
  return null;
}

async function readSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";
      for (const part of parts) {
        const m = part.match(/^data: (.+)$/m);
        if (!m) continue;
        try {
          const data = JSON.parse(m[1]);
          const patchOps = data?.patch_op;
          if (Array.isArray(patchOps)) {
            for (const op of patchOps) {
              const pv = op?.patch_value;
              if (!pv) continue;
              // 图片
              const blocks = pv?.content_block;
              if (Array.isArray(blocks)) {
                for (const block of blocks) {
                  const creations = block?.content?.creation_block?.creations;
                  if (creations) { const urls = extractImagesFromCreations(creations); if (urls.length > 0) mediaCallback({ urls, type: "image" }); }
                }
              }
              // 视频
              const videoUrl = extractVideoFromPatchValue(pv);
              if (videoUrl) {
                mediaCallback({ urls: [videoUrl], type: "video" });
                const cacheVid = findVidInObject(pv);
                if (cacheVid) (window as any).__doubaoCleanUrlCache.set(cacheVid, videoUrl);
              }
              // vid 缓存
              const pvMsgId = String((pv as any)?.message_id || data?.message_id || "").trim();
              const pvVid = findVidInObject(pv);
              if (pvVid && pvMsgId && pvMsgId !== "0") (window as any).__doubaoVidCache.set(pvMsgId, pvVid);
            }
          }
          const messages = data?.downlink_body?.pull_singe_chain_downlink_body?.messages;
          if (Array.isArray(messages)) {
            for (const msg of messages) {
              const blocks = msg?.content_block;
              if (Array.isArray(blocks)) {
                for (const block of blocks) {
                  const creations = block?.content?.creation_block?.creations;
                  if (creations) { const urls = extractImagesFromCreations(creations); if (urls.length > 0) mediaCallback({ urls, type: "image" }); }
                }
              }
              const msgVideoUrl = extractVideoFromPatchValue(msg);
              if (msgVideoUrl) {
                mediaCallback({ urls: [msgVideoUrl], type: "video" });
                const cacheVid = findVidInObject(msg);
                if (cacheVid) (window as any).__doubaoCleanUrlCache.set(cacheVid, msgVideoUrl);
              }
              const theVid = findVidInObject(msg);
              const theMsgId = String(msg.message_id || "").trim();
              if (theVid && theMsgId && theMsgId !== "0") (window as any).__doubaoVidCache.set(theMsgId, theVid);
            }
          }
        } catch {}
      }
    }
  } catch {}
}

// ========== 模块级：网络拦截（立即生效，不等 React） ==========

// 全局存一个 msToken（页面的 bdms-sdk 会给每个请求加这个参数）
if (!(window as any).__msToken) (window as any).__msToken = "";

(function installNetworkHooks() {
  console.log("[15s] 网络拦截已安装 at", document.readyState);
  // --- fetch ---
  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : (input as any)?.url || "";
    // 从 URL 里截取 msToken
    if (!(window as any).__msToken) {
      const m = url.match(/[?&]msToken=([^&]+)/);
      if (m) (window as any).__msToken = m[1];
    }
    const isCompletion = isCompletionUrl(url);

    try {
      if (isCompletion) {
        console.log("[15s] ✓ 命中 /chat/completion, 15s开关:", is15sEnabled());
        let finalInit = init;
        if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
          const bodyStr = typeof init.body === "string" ? init.body : "";
          console.log("[15s] body含chat_ability:", bodyStr.includes("chat_ability"), "body前50:", bodyStr.slice(0, 50));
          const patched = patchBody(bodyStr);
          if (patched.changed) finalInit = { ...init, body: patched.body };
        } else if (typeof Request !== "undefined" && input instanceof Request && input.method === "POST") {
          const raw = await input.clone().text();
          console.log("[15s] Request body含chat_ability:", raw.includes("chat_ability"), "长度:", raw.length);
          const patched = patchBody(raw);
          if (patched.changed) input = new Request(input, { body: patched.body });
        } else {
          console.log("[15s] init无body, input类型:", typeof input);
        }

        return originalFetch.call(this, input, finalInit).then(async (resp: Response) => {
          const ct = resp.headers.get("content-type") || "";
          if (ct.includes("text/event-stream") && resp.body) {
            const [s1, s2] = resp.body.tee();
            readSSEStream(s2.getReader());
            return new Response(s1, resp);
          }
          return resp;
        });
      }
    } catch (error) {
      console.warn("[15s] fetch patch failed:", error);
    }
    // 其他请求：直接透传（不拦截、不扫描、不复制响应体）
    return originalFetch.apply(this, [input, init] as const);
  } as typeof window.fetch;

  // --- XHR ---
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __xhrUrl?: string; __xhrMethod?: string }, method: string, url: string | URL) {
    this.__xhrMethod = method;
    this.__xhrUrl = typeof url === "string" ? url : url.href;
    return originalXHROpen.call(this, method, url);
  };

  XMLHttpRequest.prototype.send = function(this: XMLHttpRequest & { __xhrUrl?: string; __xhrMethod?: string }, ...args: unknown[]) {
    const xhrUrl = this.__xhrUrl || "";
    const xhrMethod = this.__xhrMethod || "GET";

    // 15s 注入
    if (xhrMethod.toUpperCase() === "POST" && isCompletionUrl(xhrUrl)) {
      const body = typeof args[0] === "string" ? args[0] : "";
      if (body) {
        const patched = patchBody(body);
        if (patched.changed) return originalXHRSend.call(this, patched.body);
      }
    }

    // 只处理 chain/single → vid + 无水印视频 URL 提取
    this.addEventListener("load", () => {
      if (!xhrUrl.includes("chain/single")) return;
      try {
        // 正则提取 main_url（base64 编码的无水印视频地址）
        const rawText = this.responseText;
        const mainUrlRegex = /\\"main_url\\"\s*:\s*\\"([A-Za-z0-9+/=_-]{80,})\\"/g;
        let match;
        while ((match = mainUrlRegex.exec(rawText)) !== null) {
          try {
            let decoded = atob(match[1].replace(/-/g, "+").replace(/_/g, "/")
              .padEnd(Math.ceil(match[1].length / 4) * 4, "="));
            if (decoded && decoded.startsWith("http")) {
              decoded = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
              if (decoded.startsWith("http://")) decoded = decoded.replace("http://", "https://");
              (window as any).__doubaoCleanUrlCache?.set("fallback", decoded);
              console.log("[15s] XHR chain/single 提取到无水印地址:", decoded.slice(0, 100));
            }
          } catch (e) {}
        }

        const resp = JSON.parse(rawText);
        const messages = resp?.downlink_body?.pull_singe_chain_downlink_body?.messages;
        if (!Array.isArray(messages)) return;
        const vc = (window as any).__doubaoVidCache as Map<string, string>;
        for (const msg of messages) {
          const msgId = String(msg.message_id || "").trim();
          if (!msgId || msgId === "0") continue;
          const vid = findVidInObject(msg);
          if (vid) { vc.set(msgId, vid); }

          // 从消息 JSON 树中提取对应 vid 的无水印视频 URL（按 vid 和 message_id 分别缓存）
          const videoUrl = findVideoUrlInObject(msg);
          if (videoUrl) {
            const cc = (window as any).__doubaoCleanUrlCache as Map<string, string>;
            if (vid) cc.set(vid, videoUrl);
            if (msgId) cc.set(msgId, videoUrl);
            cc.set("fallback", videoUrl); // 兜底
            console.log("[15s] 缓存无水印 vid=", vid, "msgId=", msgId, videoUrl.slice(0, 80));
          }

          const blocks = msg?.content_block;
          if (Array.isArray(blocks)) {
            for (const block of blocks) {
              const creations = block?.content?.creation_block?.creations;
              if (creations) { const urls = extractImagesFromCreations(creations); if (urls.length > 0) mediaCallback({ urls, type: "image" }); }
            }
          }
        }
      } catch {}
    });
    return originalXHRSend.apply(this, args);
  };
})();

// ========== 悬浮按钮 UI ==========

let toggleButton: HTMLDivElement | null = null;

function updateButtonText() {
  if (!toggleButton) return;
  const isOn = is15sEnabled();
  const dur = getDuration();
  toggleButton.textContent = isOn ? `${dur}s ON` : `${dur}s OFF`;
  toggleButton.style.background = isOn ? "#2563eb" : "#6b7280";
}

function createToggleButton() {
  if (toggleButton && toggleButton.isConnected) return;
  toggleButton = document.createElement("div");
  toggleButton.id = "doubao-15s-toggle";
  toggleButton.title = "左键切换时长, 右键切换开关";
  const isOn = is15sEnabled();
  const dur = getDuration();
  toggleButton.textContent = isOn ? `${dur}s ON` : `${dur}s OFF`;
  Object.assign(toggleButton.style, {
    position: "fixed", bottom: "140px", right: "20px", zIndex: "99999",
    padding: "6px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px",
    fontWeight: "600", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
    background: isOn ? "#2563eb" : "#6b7280", color: "white", border: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)", userSelect: "none", transition: "all 0.2s", lineHeight: "1.4",
  });

  function showToast(msg: string, color: string) {
    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed", bottom: "180px", right: "20px",
      background: color, color: "white",
      padding: "8px 14px", borderRadius: "8px", fontSize: "13px",
      zIndex: "100000", fontFamily: "system-ui",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)", transition: "opacity 0.3s",
    });
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2000);
  }

  toggleButton.addEventListener("click", (e) => {
    e.preventDefault();
    // 左键：切换开关
    const newVal = !is15sEnabled();
    try { localStorage.setItem(STORAGE_KEY, String(newVal)); } catch {}
    updateButtonText();
    showToast(newVal ? `✓ ${getDuration()}秒模式已开启` : `✕ ${getDuration()}秒模式已关闭`, newVal ? "#10b981" : "#ef4444");
  });

  toggleButton.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    // 右键：切换时长
    const cur = getDuration();
    const idx = DURATION_OPTIONS.indexOf(cur);
    const next = DURATION_OPTIONS[(idx + 1) % DURATION_OPTIONS.length];
    setDuration(next);
    updateButtonText();
    showToast(`⏱ 视频时长已切换为 ${next}s`, "#2563eb");
  });

  toggleButton.addEventListener("mouseenter", () => { if (toggleButton) toggleButton.style.opacity = "0.8"; });
  toggleButton.addEventListener("mouseleave", () => { if (toggleButton) toggleButton.style.opacity = "1"; });
  document.body.appendChild(toggleButton);
}

// ========== React Hook（只设回调 + 按钮，网络拦截已在模块级生效） ==========

export function use15s(onMedia?: MediaCallback) {
  // 更新模块级回调
  mediaCallback = onMedia || (() => {});

  useEffect(() => {
    const waitBody = () => {
      if (!document.body) { setTimeout(waitBody, 200); return; }
      createToggleButton();
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", waitBody, { once: true });
    } else {
      waitBody();
    }
    return () => { toggleButton?.remove(); toggleButton = null; };
  }, []);
}
