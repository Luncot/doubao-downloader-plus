import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Semi UI React 19 兼容
try { (window as any).__semi_useReact19 = true; } catch {}

// @run-at document-start 时 body 可能还不存在
function mountApp() {
  if (!document.body) { setTimeout(mountApp, 50); return; }
  const app = document.createElement("div");
  app.style.height = "0";
  document.body.appendChild(app);
  ReactDOM.createRoot(app).render(<App />);
}
mountApp();

// SPA 导航检测（切换账号/对话时 history API 变化 + DOM 重建）
let lastNavUrl = location.href;
const origPushState = history.pushState.bind(history);
const origReplaceState = history.replaceState.bind(history);
history.pushState = function(...args: any[]) {
  origPushState(...args);
  if (location.href !== lastNavUrl) { lastNavUrl = location.href; setTimeout(() => location.reload(), 50); }
};
history.replaceState = function(...args: any[]) {
  origReplaceState(...args);
  if (location.href !== lastNavUrl) { lastNavUrl = location.href; setTimeout(() => location.reload(), 50); }
};
window.addEventListener("popstate", () => {
  if (location.href !== lastNavUrl) { lastNavUrl = location.href; setTimeout(() => location.reload(), 50); }
});
