import { useEffect } from "react";

const TARGET_DURATION = 15;
const TARGET_MODEL = "seedance_v2.0";
const STORAGE_KEY = "doubao_15s_enabled";

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

function isCompletionUrl(input: unknown): boolean {
  const raw = typeof input === "string" ? input : (input as any)?.url || (input as any)?.href || "";
  try {
    const url = new URL(raw, location.href);
    return /(^|\.)doubao\.com$/.test(url.hostname) && url.pathname === "/chat/completion";
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
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return { changed: false, body: rawBody }; }
  const ability = (payload as any)?.chat_ability;
  if (!ability || Number(ability.ability_type) !== 17) return { changed: false, body: rawBody };
  const param = parseAbilityParam(ability.ability_param);
  param.model = TARGET_MODEL;
  param.duration = TARGET_DURATION;
  ability.ability_param = JSON.stringify(param);
  console.log("[15s] ✅ 已注入15s参数");
  return { changed: true, body: JSON.stringify(payload) };
}

// ========== SSE 流 + vid 提取（供下载按钮使用） ==========

if (!(window as any).__doubaoVidCache) {
  (window as any).__doubaoVidCache = new Map<string, string>();
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
    if (main && typeof main === "string") return main.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
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
              if (videoUrl) mediaCallback({ urls: [videoUrl], type: "video" });
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
              if (msgVideoUrl) mediaCallback({ urls: [msgVideoUrl], type: "video" });
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

(function installNetworkHooks() {
  console.log("[15s] 网络拦截已安装 at", document.readyState);
  // --- fetch ---
  const originalFetch = window.fetch;
  window.fetch = async function patchedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : (input as any)?.url || "";
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

  // 去重 vid API 调用
  const fetchedVids = new Set<string>();

  async function fetchAndPushVideoUrl(vid: string) {
    if (fetchedVids.has(vid)) return;
    fetchedVids.add(vid);
    try {
      const baseUrl = "https://www.doubao.com/samantha/media/get_play_info";
      const params = new URLSearchParams({ aid: "497858", device_platform: "web", samantha_web: "1", "use-olympus-account": "1", version_code: "20800", pkg_type: "release_version", web_tab_id: crypto.randomUUID() });
      const resp = await fetch(`${baseUrl}?${params.toString()}`, {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", "agw-js-conv": "str", origin: location.origin, referer: location.href },
        credentials: "include", body: JSON.stringify({ key: vid, type: "video" }),
      });
      const json = await resp.json();
      if (json.code !== 0) return;
      const d = json.data;
      let url: string | null = null;
      if (d.original_media_info?.main_url) url = d.original_media_info.main_url.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
      else { const pi = d.play_infos?.[0] || d.play_info; if (pi?.main) url = pi.main.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark"); }
      if (url) mediaCallback({ urls: [url], type: "video" });
    } catch {}
  }

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __xhrUrl?: string; __xhrMethod?: string }, ...args: unknown[]) {
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

    // chain/single → vid + 图片提取
    this.addEventListener("load", () => {
      if (!xhrUrl.includes("chain/single")) return;
      try {
        const resp = JSON.parse(this.responseText);
        const messages = resp?.downlink_body?.pull_singe_chain_downlink_body?.messages;
        if (!Array.isArray(messages)) return;
        const vc = (window as any).__doubaoVidCache as Map<string, string>;
        for (const msg of messages) {
          const msgId = String(msg.message_id || "").trim();
          if (!msgId || msgId === "0") continue;
          const vid = findVidInObject(msg);
          if (vid) { vc.set(msgId, vid); fetchAndPushVideoUrl(vid); }
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

function createToggleButton() {
  if (toggleButton && toggleButton.isConnected) return;
  toggleButton = document.createElement("div");
  toggleButton.id = "doubao-15s-toggle";
  const isOn = is15sEnabled();
  toggleButton.textContent = isOn ? "15s ON" : "15s OFF";
  Object.assign(toggleButton.style, {
    position: "fixed", bottom: "140px", right: "20px", zIndex: "99999",
    padding: "6px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px",
    fontWeight: "600", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
    background: isOn ? "#2563eb" : "#6b7280", color: "white", border: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,0.2)", userSelect: "none", transition: "all 0.2s", lineHeight: "1.4",
  });
  toggleButton.addEventListener("click", () => {
    const newVal = !is15sEnabled();
    try { localStorage.setItem(STORAGE_KEY, String(newVal)); } catch {}
    if (toggleButton) {
      toggleButton.textContent = newVal ? "15s ON" : "15s OFF";
      toggleButton.style.background = newVal ? "#2563eb" : "#6b7280";
    }
    const toast = document.createElement("div");
    Object.assign(toast.style, {
      position: "fixed", bottom: "180px", right: "20px",
      background: newVal ? "#10b981" : "#ef4444", color: "white",
      padding: "8px 14px", borderRadius: "8px", fontSize: "13px",
      zIndex: "100000", fontFamily: "system-ui",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)", transition: "opacity 0.3s",
    });
    toast.textContent = newVal ? "✓ 15秒模式已开启" : "✕ 15秒模式已关闭";
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2000);
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
