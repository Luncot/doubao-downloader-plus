import { useEffect, useRef } from "react";

type MediaCallback = (e: { urls: string[]; type: "image" | "video" }) => void;

/**
 * Hook：在豆包页面的图片/视频元素上直接注入下载按钮
 *
 * 工作原理：
 * 1. 用 MutationObserver 监控 DOM 变化
 * 2. 找到图片元素（img）和视频容器（[class*="block-video"]）
 * 3. 注入悬浮的下载按钮
 * 4. 点击下载按钮时，从页面数据或捕获的 URL 中获取资源并下载
 */
export function useInjectButtons(onDownload?: MediaCallback) {
  const injectedRef = useRef<Set<Element>>(new Set());
  const processedVideoMessagesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // ========== 工具函数 ==========

    /** 从元素向上查找 messageId */
    function findMessageId(el: Element): string | null {
      let cur: Element | null = el;
      for (let i = 0; cur && i < 20; i++, cur = cur.parentElement) {
        const id =
          cur.getAttribute("data-message-id") ||
          cur.getAttribute("data-message_id") ||
          "";
        if (id) return id;
      }
      return null;
    }

    /** 查找 video 元素的直接 src（排除 blob: 地址） */
    function findVideoSrc(container: Element): string | null {
      const videoEl = container.querySelector("video");
      if (!videoEl) return null;
      let src = videoEl.getAttribute("src");
      // blob 地址不可下载，跳过
      if (src && src.startsWith("http")) return src;
      const source = videoEl.querySelector("source");
      if (source) {
        src = source.getAttribute("src");
        if (src && src.startsWith("http")) return src;
      }
      return null;
    }

    /** 创建下载按钮 */
    function createDownloadButton(
      label: string,
      onClick: (e: MouseEvent) => void
    ): HTMLButtonElement {
      const btn = document.createElement("button");
      btn.textContent = label;
      Object.assign(btn.style, {
        position: "absolute",
        bottom: "6px",
        right: "6px",
        zIndex: "9999",
        padding: "4px 10px",
        minWidth: "72px",
        textAlign: "center",
        background: "rgba(0, 0, 0, 0.55)",
        color: "white",
        border: "1px solid rgba(255,255,255,0.3)",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: "500",
        cursor: "pointer",
        backdropFilter: "blur(3px)",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        lineHeight: "20px",
        whiteSpace: "nowrap",
        pointerEvents: "all",
        transition: "all 0.2s",
        boxSizing: "border-box",
        opacity: "0.9",
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.opacity = "1";
        btn.style.background = "rgba(37, 99, 235, 0.9)";
      });
      btn.addEventListener("mouseleave", () => {
        if (!btn.dataset.doubaoSuccess) {
          btn.style.opacity = "0.9";
          btn.style.background = "rgba(0, 0, 0, 0.55)";
        }
      });
      btn.addEventListener("click", onClick);
      return btn;
    }

    /** 下载 URL：尝试多种方式触发下载 */
    function downloadUrl(url: string, filename: string) {
      console.log("[video] 下载URL:", url.slice(0, 120));
      // blob 地址是浏览器内部地址，无法跨页面下载
      if (url.startsWith("blob:")) {
        console.warn("[video] blob URL 无法下载");
        toast("预览模式的 blob 地址无法直接下载，请退出全屏后重试");
        return;
      }

      // 1. 用 fetch + blob
      fetch(url, { mode: "cors", credentials: "omit" })
        .then((r) => {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        })
        .then((blob) => {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 2000);
          toast("✅ 开始下载", 2000);
        })
        .catch((err) => {
          console.warn("[video] fetch blob 失败:", err);
          // 2. 用 <a download> 尝试跨域下载
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 1000);
        });
    }

    /** 简单的 toast 提示 */
    function toast(msg: string, duration = 2500) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        background: "#ef4444",
        color: "white",
        padding: "8px 14px",
        borderRadius: "8px",
        fontSize: "13px",
        zIndex: "100001",
        fontFamily: "system-ui",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        transition: "opacity 0.3s",
      });
      el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
      }, duration);
    }

    // ========== 注入图片下载按钮 ==========

    function injectImageButton(img: HTMLImageElement) {
      if (injectedRef.current.has(img)) return;
      injectedRef.current.add(img);

      // 找外层容器设为 position:relative
      let container: HTMLElement | null = img.parentElement;
      for (let i = 0; i < 5 && container; i++) {
        if (container !== document.body) break;
        container = container.parentElement;
      }
      if (!container || container === document.body) return;
      if (
        getComputedStyle(container).position === "static" ||
        !getComputedStyle(container).position
      ) {
        container.style.position = "relative";
      }

      const btn = createDownloadButton("⬇️ 下载", (e) => {
        e.stopPropagation();

        // 优先用 img 当前 src
        let url = img.src;
        // 尝试从 data-src 或其它属性找高清图
        const dataSrc =
          img.getAttribute("data-src") || img.getAttribute("data-original");
        if (dataSrc) url = dataSrc;

        if (url && url.startsWith("http")) {
          const name = `doubao_img_${Date.now()}.png`;
          downloadUrl(url, name);
        } else {
          // 通知上层去捕获
          toast("无法获取图片 URL");
        }
      });

      container.appendChild(btn);
    }

    // ========== 视频下载按钮 ==========

    /** 全局 vid 缓存（按 messageId） */
    const vidCache = new Map<string, string>();

    /** 递归找 vid */
    function findVidDeep(obj: unknown, depth = 0): string | null {
      if (depth > 10 || !obj) return null;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const f = findVidDeep(item, depth + 1);
          if (f) return f;
        }
      } else if (typeof obj === "object") {
        const o = obj as Record<string, unknown>;
        const vid = (o.vid || o.video_id) as string | undefined;
        if (vid && typeof vid === "string" && vid.startsWith("v0"))
          return vid;
        for (const val of Object.values(o)) {
          const f = findVidDeep(val, depth + 1);
          if (f) return f;
        }
      }
      return null;
    }

    /** 找 vid：优先查全局 vid 缓存（XHR 拦截填充），备用本地 cache，最后 _ROUTER_DATA */
    function lookupVid(msgId: string | null): { vid: string; msgId: string | null } | null {
      // 1. 全局 vid 缓存（XHR chain/single 填充的，最快最准）
      const globalCache = (window as any).__doubaoVidCache as Map<string, string> | undefined;
      if (globalCache && msgId) {
        const cached = globalCache.get(msgId);
        if (cached) return { vid: cached, msgId };
        if (globalCache.size > 0) {
          const last = Array.from(globalCache.entries()).pop()!;
          return { vid: last[1], msgId: last[0] };
        }
      }

      // 2. 本地 vidCache
      if (msgId) {
        const local = vidCache.get(msgId);
        if (local) return { vid: local, msgId };
      }

      // 3. _ROUTER_DATA
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

    /** 调用 get_play_info API */
    async function fetchCleanVideoUrl(vid: string): Promise<string | null> {
      try {
        const baseUrl = "https://www.doubao.com/samantha/media/get_play_info";
        const params = new URLSearchParams({
          aid: "497858", device_platform: "web", samantha_web: "1",
          "use-olympus-account": "1", version_code: "20800",
          pkg_type: "release_version", web_tab_id: crypto.randomUUID(),
        });
        const resp = await fetch(`${baseUrl}?${params.toString()}`, {
          method: "POST",
          headers: {
            accept: "application/json", "content-type": "application/json",
            "agw-js-conv": "str",
            origin: location.origin, referer: location.href,
          },
          credentials: "include",
          body: JSON.stringify({ key: vid, type: "video" }),
        });
        if (!resp.ok) { console.warn("[video] get_play_info HTTP", resp.status); return null; }
        const json = await resp.json();
        if (json.code !== 0) { console.warn("[video] get_play_info code:", json.code); return null; }

        const d = json.data;
        if (d.original_media_info?.main_url)
          return d.original_media_info.main_url.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
        const pi = d.play_infos?.[0] || d.play_info;
        if (pi?.main)
          return pi.main.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");

        console.warn("[video] get_play_info 响应无播放地址");
        return null;
      } catch (err) { console.warn("[video] get_play_info error:", err); return null; }
    }

    /** share_save 备用API */
    async function fetchVideoViaShare(msgId: string, vid: string): Promise<string | null> {
      try {
        const shareResp = await fetch(
          "https://api-normal.doubao.com/alice/media/bigmusic/share_save?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7550681679050343936&pc_version=3.14.6&region=CN&sys_region=CN&samantha_web=1&use-olympus-account=1",
          { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
            credentials: "include", body: JSON.stringify({ message_id: msgId }) }
        );
        const sj = await shareResp.json();
        if (sj.code !== 0 || !sj.data?.share_id) { console.warn("[video] share_save fail:", sj.code); return null; }

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
      } catch (err) { console.warn("[video] share_save error:", err); return null; }
    }

    function injectVideoButton(container: Element) {
      if (injectedRef.current.has(container)) return;
      injectedRef.current.add(container);

      const msgId = findMessageId(container);

      // 确保容器有 position
      (container as HTMLElement).style.position = "relative";

      const btn = createDownloadButton("⬇️ 下载视频", async (e) => {
        e.stopPropagation();
        btn.textContent = "⏳ 获取中...";
        btn.style.opacity = "1";
        btn.style.pointerEvents = "none";

        console.log("[video] ===== 开始获取视频 =====");
        console.log("[video] 容器className:", container.className);
        console.log("[video] messageId:", msgId);

        let finalUrl: string | null = null;
        let usedMethod = "none";

        try {
          // 1. 找 vid
          const found = lookupVid(msgId);
          if (found?.vid) {
            console.log("[video] 找到 vid:", found.vid, "msgId:", found.msgId);

            // 2. get_play_info API
            console.log("[video] → 尝试 get_play_info...");
            finalUrl = await fetchCleanVideoUrl(found.vid);
            if (finalUrl) usedMethod = "get_play_info";
            else console.warn("[video] get_play_info 失败");

            // 3. share_save 备用
            if (!finalUrl && found.msgId) {
              console.log("[video] → 尝试 share_save...");
              finalUrl = await fetchVideoViaShare(found.msgId, found.vid);
              if (finalUrl) usedMethod = "share_save";
            }
          } else {
            console.warn("[video] 未找到 vid，尝试全局缓存取最后一个vid");

            // 4. 尝试全局缓存中的任意 vid
            const gc = (window as any).__doubaoVidCache as Map<string, string> | undefined;
            if (gc && gc.size > 0) {
              const last = Array.from(gc.entries()).pop()!;
              console.log("[video] 从全局缓存取 vid:", last[1], "msgId:", last[0]);
              finalUrl = await fetchCleanVideoUrl(last[1]);
              if (finalUrl) usedMethod = "get_play_info(fallback)";
            }

            // 5. DOM src 兜底（排除 blob）
            if (!finalUrl) {
              const domUrl = findVideoSrc(container);
              if (domUrl) {
                console.log("[video] → DOM src:", domUrl.slice(0, 100));
                finalUrl = domUrl.replace(/lr=video_gen_watermark_dyn/, "lr=video_gen_no_watermark")
                                 .replace(/lr=video_gen_watermark/, "lr=video_gen_no_watermark");
                if (finalUrl) usedMethod = "dom_src";
              } else {
                console.warn("[video] DOM 无可用 src（可能是 blob 地址已跳过）");
              }
            }
          }

          if (finalUrl) {
            console.log("[video] ✅ 成功，方式:", usedMethod, "URL:", finalUrl.slice(0, 100));
            const name = `doubao_video_${Date.now()}.mp4`;
            downloadUrl(finalUrl, name);
            btn.textContent = "✓ 已下载";
            btn.dataset.doubaoSuccess = "true";
            btn.style.background = "rgba(16, 185, 129, 0.85)";
            btn.style.opacity = "1";
            setTimeout(() => {
              btn.textContent = "⬇️ 下载视频";
              btn.style.background = "rgba(0, 0, 0, 0.55)";
              btn.style.opacity = "0.9";
              btn.style.pointerEvents = "auto";
              delete btn.dataset.doubaoSuccess;
            }, 4000);
          } else {
            console.error("[video] ❌ 所有方式都失败");
            toast("获取视频地址失败，请按F12看日志");
            btn.textContent = "⬇️ 下载视频";
            btn.style.pointerEvents = "auto";
          }
        } catch (err) {
          console.error("[video] ❌ 异常:", err);
          toast("下载异常，请按F12看日志");
          btn.textContent = "⬇️ 下载视频";
          btn.style.pointerEvents = "auto";
        }
      });

      container.appendChild(btn);
    }

    // ========== DOM 监控 ==========

    function scanImages() {
      let count = 0;
      document.querySelectorAll("img").forEach((img) => {
        if (img.offsetWidth < 80 || img.offsetHeight < 80) return;
        if (injectedRef.current.has(img)) return;
        injectImageButton(img);
        count++;
      });
      if (count > 0) console.log("[注入] 图片按钮已注入:", count);
    }

    function scanVideos() {
      // 查找视频容器
      const videoContainers = document.querySelectorAll(
        '[class*="block-video"], [class*="video-block"], [class*="video-container"]'
      );
      videoContainers.forEach((el) => {
        if (injectedRef.current.has(el)) return;
        injectVideoButton(el);
      });

      // 也找直接 <video> 标签
      document.querySelectorAll("video").forEach((video) => {
        let parent = video.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          if (
            parent.className &&
            typeof parent.className === "string" &&
            (parent.className.includes("block-video") ||
              parent.className.includes("video"))
          ) {
            if (!injectedRef.current.has(parent)) {
              injectVideoButton(parent);
            }
            return;
          }
          parent = parent.parentElement;
        }
      });
    }

    // 启动 MutationObserver
    let observer: MutationObserver | null = null;
    const waitBody = () => {
      if (!document.body) {
        setTimeout(waitBody, 200);
        return;
      }

      // 先扫一遍
      setTimeout(() => {
        scanImages();
        scanVideos();
      }, 1000);

      observer = new MutationObserver(() => {
        scanImages();
        scanVideos();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"],
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", waitBody, { once: true });
    } else {
      waitBody();
    }

    return () => {
      observer?.disconnect();
    };
  }, [onDownload]);
}
