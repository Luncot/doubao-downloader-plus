#!/usr/bin/env node
/**
 * scripts/release.mjs — 一键发布流水线
 *
 * 依次执行：pnpm build → 同步扩展副本的版本号（inject.js / manifest.json）
 *          → 重打推送包 doubao-downloader-plus.zip → smoke 全绿验证
 *
 * ⚠️ 重要：chrome-extension/inject.js 含历史手工修复，无法由当前 src 重建，
 *    因此【绝不整文件覆盖它】，只把版本号同步到 package.json 声明的版本。
 *    若改过核心源码需要同步到扩展版，请人工核对差异后单独处理。
 *
 * 任一步骤失败即中止。用法：node scripts/release.mjs  （或 pnpm release）
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8").replace(/^﻿/, ""));
const VERSION = pkg.version;

function run(cmd, label) {
  console.log(`\n▶ ${label}`);
  execSync(cmd, { stdio: "inherit", cwd: ROOT });
}

/** 只更新文件中的版本号串（其余字节原样），返回是否发生改动 */
function syncVersionInFile(relPath, label) {
  const p = path.join(ROOT, relPath);
  const raw = readFileSync(p, "utf8");
  const current = raw.match(/"version":\s*"([^"]*)"/)?.[1] ?? raw.match(/\/\/ @version\s+(\S+)/)?.[1];
  if (!current) throw new Error(`${relPath}: 找不到版本号，无法同步`);
  if (current === VERSION) {
    console.log(`\n▶ ${label} 已是 v${VERSION}，无需改动`);
    return;
  }
  const next = raw.split(current).join(VERSION);
  if (next === raw) throw new Error(`${relPath}: 版本替换失败（${current} → ${VERSION}）`);
  writeFileSync(p, next);
  console.log(`\n▶ ${label} version ${current} → ${VERSION}`);
}

/** 重打推送包（.NET ZipArchive，entry 统一正斜杠，兼容 unzip 校验） */
function repackZip() {
  console.log(`\n▶ 重打推送包 doubao-downloader-plus.zip`);
  execSync(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${path.join(ROOT, "scripts", "repack.ps1")}" -Root "${ROOT}"`, {
    stdio: "inherit",
  });
}

run("pnpm build", "构建 dist（tsc + vite）");
syncVersionInFile("chrome-extension/inject.js", "chrome-extension/inject.js（仅版本号，不覆盖代码）");
syncVersionInFile("chrome-extension/manifest.json", "chrome-extension/manifest.json");
repackZip();
run("node scripts/smoke.mjs", "冒烟验证");
console.log(`\n✅ 发布完成：v${VERSION} 已构建、版本同步、打包并通过 smoke`);
