import { useEffect, useRef } from "react";
import { getVideoUrl } from "@/api/video";

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

    function findVideoSrc(container: Element): string | null {
      const videoEl = container.querySelector("video");
      if (!videoEl) return null;
      let src = videoEl.getAttribute("src");
      if (src && src.startsWith("http")) return src;
      const source = videoEl.querySelector("source");
      if (source) {
        src = source.getAttribute("src");
        if (src && src.startsWith("http")) return src;
      }
      return null;
    }

    function downloadUrl(url: string, filename: string) {
      if (url.startsWith("blob:")) { return; }
      fetch(url, { mode: "cors", credentials: "omit" })
        .then(r => { if (!r.ok) throw Error(); return r.blob(); })
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl; a.download = filename;
          document.body.appendChild(a); a.click();
          setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000);
        })
        .catch(() => { window.open(url, "_blank"); });
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

    /** 旧 get_play_info API（备选） */
    async function fetchCleanVideoUrl(vid: string): Promise<string | null> {
      try {
        const baseUrl = "https://www.doubao.com/samantha/media/get_play_info";
        const params = new URLSearchParams({ aid: "497858", device_platform: "web", samantha_web: "1",
          "use-olympus-account": "1", version_code: "20800", pkg_type: "release_version", web_tab_id: crypto.randomUUID() });
        const resp = await fetch(`${baseUrl}?${params.toString()}`, {
          method: "POST", headers: { accept: "application/json", "content-type": "application/json",
            "agw-js-conv": "str", origin: location.origin, referer: location.href },
          credentials: "include", body: JSON.stringify({ key: vid, type: "video" }),
        });
        if (!resp.ok) return null;
        const json = await resp.json();
        if (json.code !== 0) return null;
        const d = json.data;
        if (d.original_media_info?.main_url) return d.original_media_info.main_url.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
        const pi = d.play_infos?.[0] || d.play_info;
        if (pi?.main) return pi.main.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
        return null;
      } catch { return null; }
    }

    /** share_save 备用 */
    async function fetchVideoViaShare(msgId: string, vid: string): Promise<string | null> {
      try {
        const shareResp = await fetch(
          "https://api-normal.doubao.com/alice/media/bigmusic/share_save?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1",
          { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "include", body: JSON.stringify({ message_id: msgId }) }
        );
        const sj = await shareResp.json();
        if (sj.code !== 0 || !sj.data?.share_id) return null;
        const infoResp = await fetch(
          "https://www.doubao.com/creativity/share/get_video_share_info?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1&web_tab_id=" + crypto.randomUUID(),
          { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "agw-js-conv": "str" },
            credentials: "include", body: JSON.stringify({ share_id: sj.data.share_id, vid, creation_id: "" }) }
        );
        const ij = await infoResp.json();
        if (ij.code !== 0 || !ij.data) return null;
        const pi = ij.data.play_infos?.[0] || ij.data.play_info;
        if (pi?.main) return pi.main.replace(/lr=video_gen_watermark_dyn/, "lr=video_gen_no_watermark").replace(/lr=video_gen_watermark/, "lr=video_gen_no_watermark");
        return null;
      } catch { return null; }
    }

    function injectVideoButton(container: Element) {
      if (injectedRef.current.has(container)) return;
      if (!(container instanceof HTMLElement)) return;
      injectedRef.current.add(container);

      const msgId = findMessageId(container);

      // 按钮直接贴在容器底部（极高 z-index 穿透 xgplayer）
      const btn = document.createElement("button");
      btn.textContent = "⬇️ 下载视频";
      container.style.position = "relative";
      container.style.overflow = "visible";
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

            // 1. 上游 get_download_info API（最优先）
            try { finalUrl = await getVideoUrl(found.vid); if (finalUrl) usedMethod = "get_download_info"; }
            catch (e) { console.warn("[video] get_download_info 失败:", e); }

            // 2. get_play_info API
            if (!finalUrl) { finalUrl = await fetchCleanVideoUrl(found.vid); if (finalUrl) usedMethod = "get_play_info"; }

            // 3. share_save 备用
            if (!finalUrl && found.msgId) { finalUrl = await fetchVideoViaShare(found.msgId, found.vid); if (finalUrl) usedMethod = "share_save"; }
          } else {
            console.warn("[video] 未找到 vid，尝试全局缓存取最后一个vid");
            const gc = (window as any).__doubaoVidCache as Map<string, string> | undefined;
            if (gc && gc.size > 0) {
              const last = Array.from(gc.entries()).pop()!;
              console.log("[video] 从全局缓存取 vid:", last[1], "msgId:", last[0]);
              try { finalUrl = await getVideoUrl(last[1]); if (finalUrl) usedMethod = "get_download_info(fallback)"; } catch {}
              if (!finalUrl) { finalUrl = await fetchCleanVideoUrl(last[1]); if (finalUrl) usedMethod = "get_play_info(fallback)"; }
            }

            if (!finalUrl) {
              const domUrl = findVideoSrc(container);
              if (domUrl) {
                finalUrl = domUrl.replace(/lr=video_gen_watermark_dyn/, "lr=video_gen_no_watermark")
                                 .replace(/lr=video_gen_watermark/, "lr=video_gen_no_watermark");
                if (finalUrl) usedMethod = "dom_src";
              }
            }
          }

          if (finalUrl) {
            console.log("[video] ✅ 成功，方式:", usedMethod, "URL:", finalUrl.slice(0, 100));
            downloadUrl(finalUrl, `doubao_video_${Date.now()}.mp4`);
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

    // ========== DOM 监控 ==========

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
