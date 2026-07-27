// ${} 语法
// 支持data多层
export const replaceTemplate = (template: string, data: any) => {
  return template.replace(/\${([\w.]+)}/g, (_, key) => {
    let value = data;
    key.split(".").forEach((k: string) => {
      value = value[k];
    });
    return value;
  });
};

/** 根据当前域名返回无水印参数值 */
export function cleanWatermarkParam(): string {
  return location.hostname.includes("dola.com") ? "lr=unwatermarked" : "lr=video_gen_no_watermark";
}

/** 替换 URL 中的水印参数 */
export function cleanWatermarkUrl(url: string): string {
  return url.replace(/lr=[^&]+/g, cleanWatermarkParam());
}

export const completeSuffix = (filename: string, suffix: string) => {
  if (!filename.endsWith(suffix)) {
    return `${filename}.${suffix}`;
  }
  return filename;
};
