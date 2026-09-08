#!/usr/bin/env node
/**
 * scripts/smoke.mjs — 发版冒烟测试（零依赖）
 *
 * 验证：刚构建/打包出来的产物与 package.json 声明的版本一致，
 *       手工同步的扩展副本没有脱节，关键功能特征没有丢。
 *
 * 回答两个问题：
 *   1. "新版本真的进产物了吗？"（版本注入 / 同步 / 打包一致性）
 *   2. "是不是改坏了别的东西？"（主功能链路的静态特征，浅回归）
 *
 * 用法：node scripts/smoke.mjs   （或 pnpm smoke）
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const EXT = path.join(ROOT, "chrome-extension");
const ZIP = path.join(ROOT, "doubao-downloader-plus.zip");

/** 读 JSON（容忍 BOM 头） */
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
}

const pkg = readJson(path.join(ROOT, "package.json"));
const VERSION = pkg.version;
const USERJS = path.join(DIST, "doubao-downloader.user.js");
const INJECT = path.join(EXT, "inject.js");
const EXT_FILES = ["background.js", "content.js", "icon.png", "inject.js", "manifest.json", "rules.json"];

/** 断言工具：只看产物文本，不改动任何源码 */
const checks = [];
function check(name, ok, hint = "") {
  checks.push({ name, ok, hint });
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function existsNonEmpty(p) {
  return existsSync(p) && statSync(p).size > 0;
}
function countOccurrences(haystack, needle) {
  let n = 0, i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}
function zipRead(zipPath, entry) {
  // 用 unzip 读取包内单个 entry；兼容 "/" 与 "\" 两种包内分隔符
  for (const e of [entry, entry.replaceAll("/", "\\")]) {
    try {
      return execFileSync("unzip", ["-p", zipPath, e], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    } catch { /* try next separator style */ }
  }
  return null;
}

// ---------- 1. dist（userscript / 标准扩展构建产物） ----------
check("dist/ 已构建（doubao-downloader.user.js 存在且非空）", existsNonEmpty(USERJS),
  "先运行 pnpm build");
check("dist/manifest.json 存在", existsNonEmpty(path.join(DIST, "manifest.json")), "先运行 pnpm build");
check("dist/popup.html 存在", existsNonEmpty(path.join(DIST, "popup.html")), "先运行 pnpm build");
check("dist/logo.png 存在", existsNonEmpty(path.join(DIST, "logo.png")), "先运行 pnpm build");

let userjs = null;
if (existsNonEmpty(USERJS)) {
  userjs = readFileSync(USERJS, "utf8");
  const v = userjs.match(/^\/\/ @version\s+(\S+)/m);
  check("user.js 头部 @version 与 package.json 一致", v && v[1] === VERSION,
    `user.js 头部是 ${v ? v[1] : "缺失"}，期望 ${VERSION} —— 需重新 pnpm build`);
  check("user.js 内已注入 __APP_VERSION__ 宏", userjs.includes(`isNewVersion("${VERSION}",`),
    `产物里找不到 isNewVersion("${VERSION}"，……) —— 需重新 pnpm build`);

  // 浅回归：核心功能特征必须都在产物里（防重构/打包丢逻辑）
  const matches = userjs.match(/^\/\/ @match\s+(\S+)/gm) || [];
  check("user.js @match 覆盖 doubao.com", matches.some((m) => m.includes("doubao.com")),
    "缺少 doubao.com 匹配 —— userscript 将不在豆包页面运行");
  check("user.js @match 覆盖 dola.com", matches.some((m) => m.includes("dola.com")),
    "缺少 dola.com 匹配 —— userscript 将不在 dola 页面运行");
  check("水印清洗双分支都在（lr=unwatermarked / lr=video_gen_no_watermark）",
    userjs.includes("lr=unwatermarked") && userjs.includes("lr=video_gen_no_watermark"),
    "去水印参数逻辑丢失，检查 src/utils/common.ts");
  check("视频下载链路在（get_play_info / get_download_info）",
    userjs.includes("get_play_info") && userjs.includes("get_download_info"),
    "视频 API 调用缺失，检查 src/api/video.ts");
}

let distManifest = null;
if (existsNonEmpty(path.join(DIST, "manifest.json"))) {
  distManifest = readJson(path.join(DIST, "manifest.json"));
  check("dist/manifest.json version 与 package.json 一致", distManifest.version === VERSION,
    `dist/manifest.json 是 ${distManifest.version}，期望 ${VERSION} —— 需重新 pnpm build`);
  check("dist 扩展仍引用 user.js 作为 content script",
    Array.isArray(distManifest.content_scripts) &&
    distManifest.content_scripts.some((cs) => (cs.js || []).includes("doubao-downloader.user.js")),
    "manifest content_scripts 结构变了，检查根 manifest.json");
}

// ---------- 2. chrome-extension/（手工同步的 Plus 扩展副本） ----------
for (const f of EXT_FILES) {
  check(`chrome-extension/${f} 存在`, existsNonEmpty(path.join(EXT, f)),
    "扩展副本缺文件，检查同步来源");
}
if (existsNonEmpty(USERJS) && existsNonEmpty(INJECT)) {
  // 注：Plus 扩展副本与 userscript 历史上来自不同构建链，无法字节对齐，
  //     因此这里只强制【版本号同步】——防发错版本的脱节事故。
  const uv = readFileSync(USERJS, "utf8").match(/^\/\/ @version\s+(\S+)/m)?.[1];
  const iv = readFileSync(INJECT, "utf8").match(/^\/\/ @version\s+(\S+)/m)?.[1];
  check("chrome-extension/inject.js 与 dist 的 @version 同步", uv && uv === iv,
    `dist 是 ${uv ?? "?"}，inject.js 是 ${iv ?? "?"} —— 版本需一致（扩展副本含历史手工修复，勿直接覆盖整文件）`);
}
const extManifestPath = path.join(EXT, "manifest.json");
if (existsNonEmpty(extManifestPath)) {
  const m = readJson(extManifestPath);
  check("chrome-extension/manifest.json version 与 package.json 一致", m.version === VERSION,
    `扩展 manifest 是 ${m.version}，期望 ${VERSION} —— 需同步改版本号`);
}

// ---------- 3. 推送 zip 包 ----------
if (existsSync(ZIP)) {
  const zipManifest = zipRead(ZIP, "chrome-extension/manifest.json");
  if (zipManifest) {
    try {
      const mv = JSON.parse(zipManifest.replace(/^﻿/, "")).version;
      check("推送包 doubao-downloader-plus.zip 内 manifest version 一致", mv === VERSION,
        `zip 里是 ${mv}，期望 ${VERSION} —— 需重新打包推送`);
    } catch {
      check("推送包内 manifest.json 可解析", false, "zip 内 manifest 损坏？重新打包");
    }
  } else {
    check("可读取推送包内 manifest.json", false, "unzip 不可用或包结构异常，用 7z/资源管理器检查");
  }
  const zipInject = zipRead(ZIP, "chrome-extension/inject.js");
  if (zipInject) {
    check("推送包内 inject.js 与本地扩展副本一致",
      sha256(zipInject) === sha256(readFileSync(INJECT)),
      "zip 里的扩展是旧代码 —— 需重新打包推送");
  }
} else {
  check("推送包 doubao-downloader-plus.zip 存在（若尚未发布可忽略）", true,
    "本机暂无 zip 包，未做推送包校验");
}

// ---------- 汇总 ----------
const failed = checks.filter((c) => !c.ok);
const passed = checks.length - failed.length;
console.log(`\n豆包下载器 smoke — package.json 版本 ${VERSION}\n`);
for (const c of checks) {
  console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!c.ok && c.hint) console.log(`        ↳ ${c.hint}`);
}
console.log(`\n${passed}/${checks.length} 通过${failed.length ? `，${failed.length} 项失败` : "，全绿 ✓"}\n`);
if (failed.length) process.exit(1);
