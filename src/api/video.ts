import { cleanWatermarkUrl } from "@/utils/common";

async function getPlayInfo(vid: string | number): Promise<string | null> {
  try {
    // content script 可直接跨域调 doubao API
    const res = await fetch(`https://www.doubao.com/samantha/media/get_play_info?version_code=20800&language=zh-CN&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&device_id=&pc_version=2.51.7&region=&sys_region=&samantha_web=1&use-olympus-account=1&web_tab_id=${crypto.randomUUID()}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "omit", body: JSON.stringify({ key: vid }),
    });
    const data = await res.json();
    console.log("[video-api] getPlayInfo 响应:", res.status, data?.code, data?.message || "");
    if (data?.code !== 0 || !data.data) return null;
    const d = data.data;
    const m = d.original_media_info?.main_url || d.play_infos?.[0]?.main || d.play_info?.main;
    if (m) return cleanWatermarkUrl(m);
    return null;
  } catch (e) { console.log("[video-api] getPlayInfo 异常:", (e as any)?.message); return null; }
}

async function getDownloadInfo(vid: string | number): Promise<string | null> {
  try {
    const homeResp = await fetch(`/samantha/aispace/homepage?aid=497858&device_platform=web&samantha_web=1&use-olympus-account=1&version_code=20800&pkg_type=release_version`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    const homeData = await homeResp.json();
    console.log("[video-api] homepage 响应:", homeResp.status, homeData?.code, homeData?.message || "");
    const creationId = homeData.data?.children?.find((e: any) => e.name === "我的创作")?.id;
    if (!creationId) { console.log("[video-api] 未找到'我的创作'"); return null; }
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
    if (mainUrl) return cleanWatermarkUrl(mainUrl);
    return null;
  } catch (e) { console.log("[video-api] getDownloadInfo 异常:", (e as any)?.message); return null; }
}

/** 通过vid获取视频真实播放地址 */
export async function getVideoUrl(vid: string | number) {
  const u1 = await getDownloadInfo(vid);
  if (u1) return u1;
  const u2 = await getPlayInfo(vid);
  if (u2) return u2;
  throw new Error("获取播放地址失败");
}
