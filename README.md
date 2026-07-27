<div align="center" >
<img style="display: block; margin: 0 auto; " src="./src/assets/logo.png" width="200" height="200" />
</div>

<h1 align="center">豆包下载器 Plus</h1>
<p align="center">豆包 / Dola AI 无水印资源批量下载 + 15秒视频生成</p>

<div align="center">

<img alt="GitHub Release" src="https://img.shields.io/github/v/release/Luncot/doubao-downloader-plus?style=for-the-badge">
<img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/Luncot/doubao-downloader-plus?style=for-the-badge">

</div>

## ✨ 功能

- **🖼️ 图片无水印批量下载** — 自动捕获对话中的无水印原图，面板管理，一键打包 ZIP
- **🎬 视频无水印下载** — 每个视频上叠加下载按钮，支持单视频和批量下载
- **⏱️ 15秒视频生成** — 右下角 `15s ON/OFF` 悬浮开关，`JSON.stringify` 注入 `duration=15`
- **📋 对话筛选** — 按对话分类查看图片/视频，全量扫描历史
- **🌍 国际版支持** — 同时支持 `doubao.com`（国内）和 `dola.com`（国际），dola 端通过拦截 `chain/single` API 响应提取无水印地址
- **⚙️ 设置面板** — 自定义文件名、下载并发数、跳过已下载等

## 📦 安装

### 油猴脚本（推荐）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)
2. 前往 [Releases](https://github.com/Luncot/doubao-downloader-plus/releases/latest) 下载 `doubao-downloader.user.js`
3. 拖入浏览器自动安装

### Chrome 扩展

`chrome-extension/` 目录可直接加载为 Chrome 扩展：

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `chrome-extension/` 目录

扩展版额外提供 Debugger API 拦截能力，在 dola.com 上无需依赖油猴脚本的 fetch/XHR 劫持。

### 手动构建

```shell
git clone https://github.com/Luncot/doubao-downloader-plus.git
cd doubao-downloader-plus
npm install
npm run build
```

构建产物在 `dist/` 目录。

## 🚀 使用

| 操作 | 方式 |
|------|------|
| 下载图片 | 点击右侧豆包头像打开面板 → 勾选 → 下载 |
| 下载视频 | 点击视频上 `⬇️ 下载视频` 按钮 |
| 批量下载 | 面板中「下载选中」或「全部下载」 |
| 开启15秒 | 点右下角 `15s OFF` 变成 `15s ON` |
| 设置 | 面板右上角 ⚙️ 按钮 |

所有功能免费，无需激活码。

## 🔧 技术原理

| 功能 | 原理 |
|------|------|
| 图片去水印 | 拦截 `JSON.parse`，提取 `image_ori_raw.url` |
| 视频去水印（doubao） | `get_download_info` / `get_play_info` API + `lr=` 参数替换 |
| 视频去水印（dola） | 劫持 `chain/single` XHR/fetch 响应，regex 提取 base64 编码的 `main_url`，解码并替换 `lr=` 为 `unwatermarked` |
| 15秒视频 | hook `JSON.stringify` + `window.fetch` + `XMLHttpRequest.send`，注入 `duration=15` |
| 视频按钮 | MutationObserver 扫描 `<video>` 标签，挂载下载按钮 |

### dola.com 特殊处理

dola.com 的 `/samantha/*` API 对非中国 IP 返回 `710022003 country restricted`，无法通过常规 API 调用获取无水印地址。脚本通过以下方式绕过：

| 机制 | 说明 |
|------|------|
| fetch 劫持 | 包装 `window.fetch`，拦截 `chain/single` / `samantha` / `get_play_info` 响应 |
| XHR 劫持 | 包装 `XMLHttpRequest`，拦截 `chain/single` 响应 |
| 正则提取 | 直接匹配原始 JSON 文本中的 `"main_url":"BASE64..."` 格式，不依赖 JSON 解析树 |
| vid 关联 | 逐消息遍历响应 JSON，将无水印 URL 按 `vid` / `message_id` 分别缓存 |

## ⚠️ 已知问题

| 问题 | 影响 | 规避方式 |
|------|------|----------|
| dola 页面刚加载时缓存未填充 | 批量下载可能跳过视频 | 等页面完全加载后再操作 |
| 开启"跳过已下载"后 IndexedDB 有旧记录 | 可能误判新 URL 为已下载 | 关闭该选项或清除下载历史 |
| 视频 CDN 地址无 `lr=` 参数 | `cleanWatermarkUrl` 无法去水印 | 依赖 API 返回的无水印地址（已过滤） |
| 多视频时 `fallback` 缓存被覆盖 | 极端情况下多个视频拿到同一地址 | 通常无影响，vid 级别缓存优先级更高 |

## 📄 License

GNU General Public License v3.0

基于 [doubao-downloader](https://github.com/LauZzL/doubao-downloader) (GPL-3.0) 修改。
