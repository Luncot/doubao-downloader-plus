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

// SPA 导航检测：切换账号/对话时 URL 会变，自动刷新
let lastUrl = location.href;
setInterval(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(() => location.reload(), 100);
  }
}, 1000);
