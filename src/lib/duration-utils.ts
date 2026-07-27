/**
 * 豆包/Dola 视频时长工具
 * 支持 4-15 秒自定义时长，替换硬编码的 15 秒
 * 源自: doubao-dola-watermark-helper v1.7.0
 */
const MIN_DURATION = 4;
const MAX_DURATION = 15;

function clampDuration(value: number): number {
  const duration = Math.round(Number(value));
  if (!Number.isFinite(duration)) return MAX_DURATION;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, duration));
}

function patchAbilityParamValue(value: unknown, duration: number): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const patched = patchSerializedJson(value, duration, true);
    return { value: patched, changed: patched !== value };
  }
  if (!value || typeof value !== "object") return { value, changed: false };
  return { value, changed: patchDurationFields(value as Record<string, unknown>, duration) };
}

function patchDurationFields(value: Record<string, unknown>, duration: number, seen = new Set()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  let changed = false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "duration" && (typeof child === "number" || typeof child === "string")) {
      const nextValue = typeof child === "string" ? String(duration) : duration;
      if (child !== nextValue) { (value as any)[key] = nextValue; changed = true; }
    } else if (child && typeof child === "object") {
      changed = patchDurationFields(child as Record<string, unknown>, duration, seen) || changed;
    } else if (typeof child === "string" && child.includes("duration")) {
      const patchedString = patchSerializedJson(child, duration, true);
      if (patchedString !== child) { (value as any)[key] = patchedString; changed = true; }
    }
  }
  return changed;
}

function patchAbilityParams(value: unknown, duration: number, seen = new Set()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  let changed = false;
  if (Array.isArray(value)) {
    for (const item of value) { changed = patchAbilityParams(item, duration, seen) || changed; }
    return changed;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "ability_param") {
      const patched = patchAbilityParamValue(child, duration);
      if (patched.changed) { (value as any)[key] = patched.value; changed = true; }
    } else if (child && typeof child === "object") {
      changed = patchAbilityParams(child, duration, seen) || changed;
    } else if (typeof child === "string" && child.includes("ability_param")) {
      const patchedString = patchSerializedJson(child, duration);
      if (patchedString !== child) { (value as any)[key] = patchedString; changed = true; }
    }
  }
  return changed;
}

function patchSerializedJson(text: string, duration: number, insideAbilityParam = false): string {
  try {
    const json = JSON.parse(text);
    const changed = insideAbilityParam
      ? patchDurationFields(json, duration)
      : patchAbilityParams(json, duration);
    return changed ? JSON.stringify(json) : text;
  } catch {
    return insideAbilityParam ? patchSerializedDuration(text, duration) : text;
  }
}

function patchSerializedDuration(text: string, duration: number): string {
  return text.replace(
    /(\\*"duration\\*"\s*:\s*\\*"?)(\d{1,2})(\\*"?)/g,
    (_match: string, prefix: string, _current: string, suffix: string) => `${prefix}${duration}${suffix}`
  );
}

/** 从 body 字符串注入时长 */
function patchVideoDurationBody(rawBody: string, targetDuration: number): { changed: boolean; body: string; duration: number } {
  const duration = clampDuration(targetDuration);
  if (typeof rawBody !== "string" || !rawBody.includes("ability_param")) {
    return { body: rawBody, changed: false, duration };
  }
  try {
    const json = JSON.parse(rawBody);
    const changed = patchAbilityParams(json, duration);
    return { body: changed ? JSON.stringify(json) : rawBody, changed, duration };
  } catch {
    const patchedBody = patchSerializedDuration(rawBody, duration);
    return { body: patchedBody, changed: patchedBody !== rawBody, duration };
  }
}

export const DoubaoDurationUtils = {
  MIN_DURATION,
  MAX_DURATION,
  clampDuration,
  patchVideoDurationBody,
  patchAbilityParams,
};

export default DoubaoDurationUtils;
