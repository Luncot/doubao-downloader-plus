const GET_PLAY_INFO = `/samantha/media/get_play_info?version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=7622868208475047462&pc_version=3.20.2&web_id=&tea_uuid=&region=CN&sys_region=CN&samantha_web=1&web_platform=browser&use-olympus-account=1&web_tab_id=`;

/** 方案1：直接 get_play_info（付费扩展方案，带 origin/referer + lr= 替换） */
async function getPlayInfo(vid: string | number): Promise<string | null> {
  try {
    const res = await fetch(GET_PLAY_INFO + crypto.randomUUID(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "agw-js-conv": "str",
        origin: location.origin, referer: location.href,
      },
      credentials: "include",
      body: JSON.stringify({ key: vid, type: "video" }),
    });
    const data = await res.json();
    if (data?.code !== 0) { console.warn("[api] get_play_info code:", data?.code, data?.msg); return null; }
    if (!data.data) { console.warn("[api] get_play_info 无 data"); return null; }
    const d = data.data;
    const m = d.original_media_info?.main_url || d.play_infos?.[0]?.main || d.play_info?.main;
    if (m) return m.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
    console.warn("[api] get_play_info 响应中无播放地址, keys:", Object.keys(d).join(","));
    return null;
  } catch (e) { console.warn("[api] get_play_info 异常:", e); return null; }
}

/** 方案2：get_download_info（上游2.0.4方案，3步） */
async function getDownloadInfo(vid: string | number): Promise<string | null> {
  try {
    const homeResp = await fetch(`/samantha/aispace/homepage?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const homeData = await homeResp.json();
    const creationId = homeData.data?.children?.find((e: any) => e.name === "我的创作")?.id;
    if (!creationId) return null;

    const nodeResp = await fetch(`/samantha/aispace/node_info?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: creationId, need_full_path: true, size: 50, sort_param: { need_sort_config: true, sort_order: 1, sort_type: 0 } }),
    });
    const nodeData = await nodeResp.json();
    const nodeId = nodeData.data?.children?.find((e: any) => String(e.key) === String(vid))?.id;
    if (!nodeId) return null;

    const dlResp = await fetch(`/samantha/aispace/get_download_info?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ node_id: nodeId }] }),
    });
    const dlData = await dlResp.json();
    const mainUrl = dlData.data?.download_infos?.[0]?.main_url;
    if (mainUrl) return mainUrl.replace(/lr=[^&]+/g, "lr=video_gen_no_watermark");
    return null;
  } catch { return null; }
}

/**
 * 通过vid获取视频真实播放地址（无水印）
 * 优先方案1 get_play_info，失败则方案2 get_download_info
 */
export async function getVideoUrl(vid: string | number) {
  const u1 = await getPlayInfo(vid);
  if (u1) return u1;
  const u2 = await getDownloadInfo(vid);
  if (u2) return u2;
  throw new Error("获取播放地址失败");
}
