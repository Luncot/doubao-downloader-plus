import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Semi UI React 19 兼容
(window as any).__semi_useReact19 = true;

// 清理旧版 IndexedDB（schema 版本不匹配时会导致 init 失败）
try { indexedDB.deleteDatabase("DouBaoDownloader"); } catch {}

// @run-at document-start 时 body 可能还不存在
function mountApp() {
  if (!document.body) {
    setTimeout(mountApp, 50);
    return;
  }
  const app = document.createElement("div");
  app.style.height = "0";
  document.body.appendChild(app);
  ReactDOM.createRoot(app).render(<App />);
}
mountApp();
