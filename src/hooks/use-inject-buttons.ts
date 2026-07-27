import { useEffect, useRef } from "react";
import { getVideoUrl } from "@/api/video";
import { cleanWatermarkUrl } from "@/utils/common";

// ===== 拦截 chain/single API 响应，提取无水印视频 URL（油猴脚本也适用） =====
if (typeof window !== "undefined") {
  // 初始化缓存 Map
  if (!(window as any).__doubaoCleanUrlCache) (window as any).__doubaoCleanUrlCache = new Map<string, string>();

  // 劫持 fetch，拦截 chain/single 响应
  const _origFetch = window.fetch;
  window.fetch = function(input: RequestInfo | URL, init?: RequestInit) {
    const url = typeof input === "string" ? input : (input instanceof Request ? input.url : String(input));
    const isRelevantApi = url.includes("/im/chain/single") || url.includes("/samantha/") || url.includes("/get_play_info");

    const result = _origFetch.call(window, input, init);
    if (isRelevantApi) {
      result.then(async (response) => {
        try {
          const clone = response.clone();
          const text = await clone.text();

          // 方法1: 正则匹配 main_url 两种格式
          // 格式A: 非转义 "main_url":"BASE64..."（dola.com）
          // 格式B: 转义 \"main_url\":\"BASE64...\"（doubao.com 嵌套 JSON 字符串）
          const regexA = /"main_url"\s*:\s*"([A-Za-z0-9+/=_-]{80,})"/g;
          const regexB = /\\"main_url\\"\s*:\s*\\"([A-Za-z0-9+/=_-]{80,})\\"/g;
          let match;
          // 先匹配格式A
          while ((match = regexA.exec(text)) !== null) {
            try {
              let decoded = atob(match[1].replace(/-/g, "+").replace(/_/g, "/")
                .padEnd(Math.ceil(match[1].length / 4) * 4, "="));
              if (decoded && decoded.startsWith("http")) {
                const cleaned = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
                if (cleaned.startsWith("http://")) decoded = cleaned.replace("http://", "https://");
                else decoded = cleaned;
                const cache = (window as any).__doubaoCleanUrlCache as Map<string, string>;
                // 优先保留含 lr=unwatermarked 的 URL（响应里可能水印版在前无水印版在后）
                if (decoded.includes("lr=unwatermarked") || !cache.get("fallback")) {
                  cache.set("fallback", decoded);
                  console.log("[注入] fetch拦截 regex提取:", decoded.includes("lr=unwatermarked") ? "无水印" : "水印", decoded.slice(0, 100));
                }
              }
            } catch (e) {}
          }
          // 再匹配格式B（转义版）
          while ((match = regexB.exec(text)) !== null) {
            try {
              let decoded = atob(match[1].replace(/-/g, "+").replace(/_/g, "/")
                .padEnd(Math.ceil(match[1].length / 4) * 4, "="));
              if (decoded && decoded.startsWith("http")) {
                const cleaned = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
                if (cleaned.startsWith("http://")) decoded = cleaned.replace("http://", "https://");
                else decoded = cleaned;
                const cache = (window as any).__doubaoCleanUrlCache as Map<string, string>;
                if (decoded.includes("lr=unwatermarked") || !cache.get("fallback")) {
                  cache.set("fallback", decoded);
                  console.log("[注入] fetch拦截 regexB:", decoded.includes("lr=unwatermarked") ? "无水印" : "水印", decoded.slice(0, 100));
                }
              }
            } catch (e) {}
          }

          // 方法2: JSON 解析提取 play_info.main / original_media_info.main_url
          try {
            const json = JSON.parse(text);
            const d = json.data || json;
            const rawUrl = d.original_media_info?.main_url
              || d.play_infos?.[0]?.main
              || d.play_info?.main;
            if (rawUrl && rawUrl.startsWith("http")) {
              let clean = rawUrl.replace(/lr=[^&]+/g, "lr=unwatermarked");
              if (clean.startsWith("http://")) clean = clean.replace("http://", "https://");
              const cache = (window as any).__doubaoCleanUrlCache as Map<string, string>;
              const isDola = location.hostname.includes("dola.com");
              if (clean.includes("lr=unwatermarked") && !isDola) {
                cache.set("fallback", clean);
                console.log("[注入] fetch拦截 JSON提取: 无水印", clean.slice(0, 100));
              }
            }
          } catch (e) {}
        } catch (e) {}
      }).catch(() => {});
    }
    return result;
  } as typeof window.fetch;

  // ===== XHR 拦截 chain/single 响应，提取无水印视频 URL（dola.com 用 XHR 调 API） =====
  function b64dec2(v: string): string {
    if (v.startsWith("http")) return v;
    try { return atob(v.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(v.length / 4) * 4, "=")); }
    catch { return ""; }
  }

  function findVideoUrlInMsg(obj: unknown, depth = 0): string | null {
    if (depth > 10 || !obj) return null;
    if (Array.isArray(obj)) {
      for (const item of obj) { const f = findVideoUrlInMsg(item, depth + 1); if (f) return f; }
    } else if (typeof obj === "object") {
      const o = obj as Record<string, unknown>;
      const manUrl = o.man_url || o.main_url;
      if (typeof manUrl === "string" && manUrl.length > 80) {
        const decoded = b64dec2(manUrl);
        if (decoded && decoded.startsWith("http")) {
          let clean = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
          if (clean.startsWith("http://")) clean = clean.replace("http://", "https://");
          return clean;
        }
      }
      for (const val of Object.values(o)) { const f = findVideoUrlInMsg(val, depth + 1); if (f) return f; }
    }
    return null;
  }

  const _origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(...args: unknown[]) {
    const xhr = this as XMLHttpRequest & { __xhrUrl?: string; __xhrMethod?: string };
    const xhrUrl = xhr.__xhrUrl || "";
    xhr.addEventListener("load", () => {
      const isRelevant = xhrUrl.includes("chain/single") || xhrUrl.includes("/samantha/") || xhrUrl.includes("/get_play_info");
      if (!isRelevant) return;
      try {
        const text = xhr.responseText;
        const cc = (window as any).__doubaoCleanUrlCache as Map<string, string> | undefined;

        // chain/single 专用：正则提取 + 逐消息 vid 关联
        if (xhrUrl.includes("chain/single")) {
          // 1) 正则提取 main_url（跟 fetch 拦截一样，两种格式）
          const regexA = /"main_url"\s*:\s*"([A-Za-z0-9+/=_-]{80,})"/g;
          const regexB = /\\"main_url\\"\s*:\s*\\"([A-Za-z0-9+/=_-]{80,})\\"/g;
          let match;
          while ((match = regexA.exec(text)) !== null) {
            try {
              let decoded = atob(match[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(match[1].length / 4) * 4, "="));
              if (decoded && decoded.startsWith("http")) {
                const cleaned = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
                if (cleaned.startsWith("http://")) decoded = cleaned.replace("http://", "https://");
                else decoded = cleaned;
                if (cc && (decoded.includes("lr=unwatermarked") || !cc.get("fallback"))) {
                  cc.set("fallback", decoded);
                  console.log("[注入] XHR chain regexA:", decoded.includes("lr=unwatermarked") ? "无水印" : "水印", decoded.slice(0, 120));
                }
              }
            } catch (e) {}
          }
          while ((match = regexB.exec(text)) !== null) {
            try {
              let decoded = atob(match[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(match[1].length / 4) * 4, "="));
              if (decoded && decoded.startsWith("http")) {
                const cleaned = decoded.replace(/lr=[^&]+/g, "lr=unwatermarked");
                if (cleaned.startsWith("http://")) decoded = cleaned.replace("http://", "https://");
                else decoded = cleaned;
                if (cc && (decoded.includes("lr=unwatermarked") || !cc.get("fallback"))) {
                  cc.set("fallback", decoded);
                  console.log("[注入] XHR chain regexB:", decoded.includes("lr=unwatermarked") ? "无水印" : "水印", decoded.slice(0, 120));
                }
              }
            } catch (e) {}
          }

          // 2) 逐消息提取 vid + man_url
          const vc = (window as any).__doubaoVidCache as Map<string, string> | undefined;
          try {
            const resp = JSON.parse(text);
            const messages = resp?.downlink_body?.pull_singe_chain_downlink_body?.messages;
            if (Array.isArray(messages)) {
              for (const msg of messages) {
                const msgId = String(msg.message_id || "").trim();
                if (!msgId || msgId === "0") continue;
                const vid = (msg.vid || msg.video_id) as string | undefined;
                const foundVid = (vid && vid.startsWith("v0")) ? vid : null;
                if (foundVid && vc) vc.set(msgId, foundVid);
                const videoUrl = findVideoUrlInMsg(msg);
                if (videoUrl && cc) {
                  if (foundVid) cc.set(foundVid, videoUrl);
                  cc.set(msgId, videoUrl);
                  cc.set("fallback", videoUrl);
                  console.log("[注入] XHR chain/single 缓存 vid=", foundVid, "msgId=", msgId, videoUrl.slice(0, 80));
                }
              }
            }
          } catch(e) { console.warn("[注入] XHR chain/single 解析失败:", (e as any)?.message); }
        } else {
          // samantha/get_play_info：通用提取 play_info.main / original_media_info.main_url
          try {
            const json = JSON.parse(text);
            const d = json.data || json;
            const rawUrl = d.original_media_info?.main_url
              || d.play_infos?.[0]?.main
              || d.play_info?.main;
            if (rawUrl && rawUrl.startsWith("http")) {
              let clean = rawUrl.replace(/lr=[^&]+/g, "lr=unwatermarked");
              if (clean.startsWith("http://")) clean = clean.replace("http://", "https://");
              // dola.com 用 chain/single 正则提取（两行上已做），这里不覆盖
              const isDola = location.hostname.includes("dola.com");
              if (cc && clean.includes("lr=unwatermarked") && !isDola) {
                cc.set("fallback", clean);
                console.log("[注入] XHR 通用提取: 无水印", clean.slice(0, 100));
              }
            }
          } catch (e) {}
        }
      } catch(e) {}
    });
    return _origXHRSend.apply(xhr, args as [any, any?]);
  } as typeof XMLHttpRequest.prototype.send;

  const _origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL) {
    (this as any).__xhrMethod = method;
    (this as any).__xhrUrl = typeof url === "string" ? url : url.href;
    return _origXHROpen.apply(this, arguments as any);
  } as typeof XMLHttpRequest.prototype.open;
}

// 监听 Chrome 扩展 background 发来的无水印视频地址
if (typeof window !== "undefined") {
  window.addEventListener("message", (e) => {
    if (e.data?.type === "clean_video_url" && e.data.url) {
      let cleanUrl = e.data.url;
      if (cleanUrl.startsWith("http://")) cleanUrl = cleanUrl.replace("http://", "https://");
      __lastVideoSrc = cleanUrl;
      const c = (window as any).__doubaoCleanUrlCache;
      if (c) c.set("fallback", cleanUrl);
      console.log("[注入] 收到扩展发来的无水印地址");
    }
  });
}

// 轮询扫描所有 <video>，抢在页面加 watermark 之前缓存原始地址
const __origVideoSrc = new WeakMap<HTMLVideoElement, string>();
let __lastVideoSrc = "";
function scanVideoSrcs() {
  document.querySelectorAll("video").forEach((v) => {
    const src = (v as HTMLVideoElement).src || v.getAttribute("src") || (v as HTMLVideoElement).currentSrc || "";
    if (src.startsWith("http")) {
      if (!__origVideoSrc.has(v)) {
        __origVideoSrc.set(v, src);
        console.log("[注入] 已缓存视频原始地址");
      }
      // 始终更新最后地址，拿到带 lr= 的完整 URL 以便去水印
      __lastVideoSrc = src;
      if (src.includes("lr=") || src.includes("watermark")) {
        __origVideoSrc.set(v, src);
      }
    }
  });
}
if (typeof document !== "undefined") {
  scanVideoSrcs();
  setInterval(scanVideoSrcs, 500);
}

export function useInjectButtons() {
  const injectedRef = useRef<Set<Element>>(new Set());

  useEffect(() => {
    console.log("[注入] useInjectButtons 已启动");

    function findMessageId(el: Element): string | null {
      let cur: Element | null = el;
      for (let i = 0; cur && i < 20; i++, cur = cur.parentElement) {
        const id = cur.getAttribute("data-message-id") || cur.getAttribute("data-message_id") || "";
        if (id) return id;
      }
      return null;
    }

    // 用 MutationObserver 监控 video src，抢在加水印前保留原始地址
    const __videoSrcObserved = new WeakSet<Element>();
    function observeVideoSrc(videoEl: HTMLVideoElement) {
      if (__videoSrcObserved.has(videoEl)) return;
      __videoSrcObserved.add(videoEl);
      const observer = new MutationObserver(() => {
        const src = videoEl.getAttribute("src");
        if (src && src.startsWith("http") && !__origVideoSrc.has(videoEl)) {
          __origVideoSrc.set(videoEl, src);
        }
      });
      observer.observe(videoEl, { attributes: true, attributeFilter: ["src"] });
    }

    function findVideoSrc(container: Element): string | null {
      const videoEl = container.querySelector("video");
      if (!videoEl) return null;
      // 优先用当前实际播放的 URL（v.src 获取 JS 设置的完整 URL）
      const currentSrc = (videoEl as HTMLVideoElement).src || (videoEl as HTMLVideoElement).currentSrc;
      if (currentSrc && currentSrc.startsWith("http")) return currentSrc;
      const orig = __origVideoSrc.get(videoEl as HTMLVideoElement);
      if (orig) return orig;
      if (__lastVideoSrc) return __lastVideoSrc;
      const source = videoEl.querySelector("source");
      if (source) { const src = source.getAttribute("src"); if (src?.startsWith("http")) return src; }
      return null;
    }

    /** 下载视频 */
    async function downloadVideo(url: string) {
      // 先试试 fetch 下载（doubao CDN 支持 CORS）
      try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) throw Error();
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl; a.download = `doubao_video_${Date.now()}.mp4`;
        document.body.appendChild(a); a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000);
        return;
      } catch {}
      // 走 chrome-extension 后台下载（无 CORS 限制）
      const filename = `doubao_video_${Date.now()}.mp4`;
      window.postMessage({ type: "ce_download_video", url, filename }, "*");
      console.log("[video] 已发送 postMessage 给 chrome-extension 后台下载");
      const gotResponse = await new Promise<boolean>((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data?.type === "ce_download_started" && e.data.url === url) {
            window.removeEventListener("message", handler);
            resolve(true);
          }
        };
        window.addEventListener("message", handler);
        setTimeout(() => { window.removeEventListener("message", handler); resolve(false); }, 2000);
      });
      if (gotResponse) { console.log("[video] chrome-extension 已接管下载"); return; }
      // 兜底：<a download>
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
    }

    function toast(msg: string, duration = 2500) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "fixed", bottom: "20px", right: "20px", background: "#ef4444",
        color: "white", padding: "8px 14px", borderRadius: "8px", fontSize: "13px",
        zIndex: "100001", fontFamily: "system-ui", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      });
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, duration);
    }

    const vidCache = new Map<string, string>();

    function findVidDeep(obj: unknown, depth = 0): string | null {
      if (depth > 10 || !obj) return null;
      if (Array.isArray(obj)) { for (const item of obj) { const f = findVidDeep(item, depth + 1); if (f) return f; } }
      else if (typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        const vid = (o.vid || o.video_id) as string | undefined;
        if (vid && typeof vid === "string" && vid.startsWith("v0")) return vid;
        for (const val of Object.values(o)) { const f = findVidDeep(val, depth + 1); if (f) return f; }
      }
      return null;
    }

    function lookupVid(msgId: string | null): { vid: string; msgId: string | null } | null {
      const globalCache = (window as any).__doubaoVidCache as Map<string, string> | undefined;
      if (globalCache && msgId) {
        const cached = globalCache.get(msgId);
        if (cached) return { vid: cached, msgId };
        if (globalCache.size > 0) { const last = Array.from(globalCache.entries()).pop()!; return { vid: last[1], msgId: last[0] }; }
      }
      if (msgId) { const local = vidCache.get(msgId); if (local) return { vid: local, msgId }; }
      try {
        const rd = (window as any)._ROUTER_DATA;
        if (!rd?.loaderData?.chat_layout?.trimmedChainRecentConvCells) return null;
        for (const cell of rd.loaderData.chat_layout.trimmedChainRecentConvCells) {
          for (const msg of cell?.conversation?.messages || []) {
            const id = String(msg.message_id || "").trim();
            if (msgId && id !== msgId) continue;
            const vid = findVidDeep(msg);
            if (vid) { if (id && id !== "0") vidCache.set(id, vid); return { vid, msgId: id || null }; }
          }
        }
      } catch {}
      return null;
    }

    // 用相对路径（同域名不走 CORS），doubao 和 dola 都能用

    async function fetchCleanVideoUrl(vid: string): Promise<string | null> {
      try {
        const resp = await fetch(`/samantha/media/get_play_info?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version&web_tab_id=${crypto.randomUUID()}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ key: vid }),
        });
        console.log("[video] fetchCleanVideoUrl 响应状态:", resp.status);
        if (!resp.ok) { console.log("[video] fetchCleanVideoUrl HTTP 错误:", resp.status); return null; }
        const json = await resp.json();
        console.log("[video] fetchCleanVideoUrl 响应 code:", json.code, json.message || "");
        if (json.code !== 0) return null;
        const d = json.data;
        if (d.original_media_info?.main_url) return cleanWatermarkUrl(d.original_media_info.main_url);
        const pi = d.play_infos?.[0] || d.play_info;
        if (pi?.main) return cleanWatermarkUrl(pi.main);
        console.log("[video] fetchCleanVideoUrl 响应中未找到视频地址");
        return null;
      } catch(e) { console.log("[video] fetchCleanVideoUrl 异常:", (e as any)?.message); return null; }
    }

    async function fetchVideoViaShare(msgId: string, vid: string): Promise<string | null> {
      try {
        const shareResp = await fetch(
          `https://api-normal.doubao.com/alice/media/bigmusic/share_save?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1`,
          { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "include", body: JSON.stringify({ message_id: msgId }) }
        );
        const sj = await shareResp.json();
        if (sj.code !== 0 || !sj.data?.share_id) return null;
        const infoResp = await fetch(
          `https://www.doubao.com/creativity/share/get_video_share_info?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1&web_tab_id=` + crypto.randomUUID(),
          { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "agw-js-conv": "str" },
            credentials: "include", body: JSON.stringify({ share_id: sj.data.share_id, vid, creation_id: "" }) }
        );
        const ij = await infoResp.json();
        if (ij.code !== 0 || !ij.data) return null;
        const pi = ij.data.play_infos?.[0] || ij.data.play_info;
        if (pi?.main) return cleanWatermarkUrl(pi.main);
        return null;
      } catch { return null; }
    }

    function injectVideoButton(container: Element) {
      if (injectedRef.current.has(container)) return;
      if (!(container instanceof HTMLElement)) return;
      injectedRef.current.add(container);

      const msgId = findMessageId(container);

      const btn = document.createElement("button");
      btn.textContent = "⬇️ 下载视频";
      container.style.position = "relative"; container.style.overflow = "visible";
      Object.assign(btn.style, {
        position: "absolute", bottom: "10px", right: "10px", zIndex: "9999999",
        padding: "6px 14px", minWidth: "82px", textAlign: "center",
        background: "rgba(0, 0, 0, 0.65)", color: "white", border: "none", borderRadius: "6px",
        fontSize: "12px", fontWeight: "500", cursor: "pointer",
        backdropFilter: "blur(4px)", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        lineHeight: "20px", whiteSpace: "nowrap", pointerEvents: "auto", opacity: "0.9", transition: "all 0.2s",
      });
      btn.onmouseenter = () => { btn.style.opacity = "1"; btn.style.background = "rgba(37, 99, 235, 0.9)"; };
      btn.onmouseleave = () => { if (!btn.dataset.ok) { btn.style.opacity = "0.9"; btn.style.background = "rgba(0, 0, 0, 0.65)"; } };
      container.appendChild(btn);

      btn.onclick = async (e) => {
        e.stopPropagation();
        btn.textContent = "⏳ 获取中..."; btn.style.opacity = "1"; btn.style.pointerEvents = "none";

        console.log("[video] ===== 开始获取视频 =====");
        console.log("[video] 容器className:", container.className);
        console.log("[video] messageId:", msgId);

        let finalUrl: string | null = null;
        let usedMethod = "none";

        try {
          const found = lookupVid(msgId);
          if (found?.vid) {
            console.log("[video] 找到 vid:", found.vid, "msgId:", found.msgId);

            // 1. 上游 getVideoUrl（先用 get_download_info API）
            try { finalUrl = await getVideoUrl(found.vid); if (finalUrl) usedMethod = "get_download_info"; } catch {}

            // 2. get_play_info 备用
            if (!finalUrl) { finalUrl = await fetchCleanVideoUrl(found.vid); if (finalUrl) usedMethod = "get_play_info"; }

            // 3. share_save 备用（dola 上没有 api-normal 子域名）
            if (!finalUrl && found.msgId && !location.hostname.includes("dola.com")) {
              finalUrl = await fetchVideoViaShare(found.msgId, found.vid);
              if (finalUrl) usedMethod = "share_save";
            }

            // 4. 从缓存拿无水印地址（SSE 或 fallback_api）
            if (!finalUrl) {
              const cleanCache = (window as any).__doubaoCleanUrlCache as Map<string, string> | undefined;
              const cached = cleanCache?.get(found.vid) || cleanCache?.get("fallback");
              if (cached) { finalUrl = cached; usedMethod = "sse_cache"; console.log("[video] 从缓存取到无水印地址"); }
            }

            // 5. 让扩展后台调 doubao API（无 CORS 限制）
            if (!finalUrl) {
              const cleanUrl = await new Promise<string | null>((resolve) => {
                const handler = (e: MessageEvent) => {
                  if (e.data?.type === "clean_video_url" && e.data.url) {
                    window.removeEventListener("message", handler);
                    resolve(e.data.url);
                  }
                };
                window.addEventListener("message", handler);
                console.log("[video] 发送 fetch_clean_video 给扩展后台, vid:", found.vid);
                window.postMessage({ type: "fetch_clean_video", vid: found.vid }, "*");
                setTimeout(() => { window.removeEventListener("message", handler); resolve(null); }, 3000);
              });
              if (cleanUrl) { finalUrl = cleanUrl; usedMethod = "bg_api"; console.log("[video] 扩展后台获取到无水印地址"); }
            }

            // 6. 兜底：直接从 DOM 拿视频 src
            if (!finalUrl) { const domUrl = findVideoSrc(container); if (domUrl) { finalUrl = cleanWatermarkUrl(domUrl); usedMethod = "dom_src"; } }
          } else {
            console.warn("[video] 未找到 vid，尝试全局缓存");
            let last: [string, string] | null = null;
            const gc = (window as any).__doubaoVidCache as Map<string, string> | undefined;
            if (gc && gc.size > 0) {
              last = Array.from(gc.entries()).pop()!;
              console.log("[video] 从全局缓存取 vid:", last[1], "msgId:", last[0]);
              finalUrl = await fetchCleanVideoUrl(last[1]);
              if (finalUrl) usedMethod = "get_play_info(fallback)";
              if (!finalUrl) { try { finalUrl = await getVideoUrl(last[1]); if (finalUrl) usedMethod = "get_download_info(fallback)"; } catch {} }
            }
            // SSE 缓存
            if (!finalUrl) {
              const cc = (window as any).__doubaoCleanUrlCache as Map<string, string> | undefined;
              const cached = last?.[1] ? cc?.get(last[1]) : null;
              if (cached) { finalUrl = cached; usedMethod = "sse_cache(fallback)"; }
            }
            if (!finalUrl) { const domUrl = findVideoSrc(container); if (domUrl) { finalUrl = cleanWatermarkUrl(domUrl); usedMethod = "dom_src"; } }
          }

          if (finalUrl) {
            console.log("[video] ✅ 成功，方式:", usedMethod, "URL:", finalUrl.slice(0, 100));
            await downloadVideo(finalUrl);
            btn.textContent = "✓ 已下载"; btn.dataset.ok = "true";
            btn.style.background = "rgba(16, 185, 129, 0.85)"; btn.style.opacity = "1";
            setTimeout(() => {
              btn.textContent = "⬇️ 下载视频"; btn.style.background = "rgba(0, 0, 0, 0.65)";
              btn.style.opacity = "0.9"; btn.style.pointerEvents = "auto"; delete btn.dataset.ok;
            }, 4000);
          } else {
            console.error("[video] ❌ 所有方式都失败");
            toast("获取视频地址失败");
            btn.textContent = "⬇️ 下载视频"; btn.style.pointerEvents = "auto";
          }
        } catch (err) {
          console.error("[video] ❌ 异常:", err);
          toast("下载异常");
          btn.textContent = "⬇️ 下载视频"; btn.style.pointerEvents = "auto";
        }
      };
    }

    function findVideoContainer(el: Element): HTMLElement | null {
      let parent = el.parentElement;
      for (let i = 0; i < 8 && parent; i++) {
        if (parent === document.body) break;
        const cn = typeof parent.className === "string" ? parent.className : "";
        if (cn.includes("video-player") || cn.includes("block-video") || cn.includes("xgplayer") || cn.includes("video-canvas"))
          return parent;
        parent = parent.parentElement;
      }
      if (el.parentElement && el.parentElement !== document.body) return el.parentElement;
      return el.parentElement;
    }

    let videoScanTimer = 0;
    function scanVideos() {
      const videos = document.querySelectorAll("video");
      videos.forEach((video) => {
        if (injectedRef.current.has(video)) return;
        const container = findVideoContainer(video);
        if (container && !injectedRef.current.has(container)) {
          console.log("[注入] 视频容器:", container.tagName, container.className?.slice(0, 60));
          injectVideoButton(container);
          injectedRef.current.add(video);
        }
      });
    }

    const observer = new MutationObserver(() => {
      clearTimeout(videoScanTimer);
      videoScanTimer = window.setTimeout(scanVideos, 300);
    });
    if (document.body) { setTimeout(scanVideos, 1000); observer.observe(document.body, { childList: true, subtree: true }); }
    return () => observer.disconnect();
  }, []);
}
