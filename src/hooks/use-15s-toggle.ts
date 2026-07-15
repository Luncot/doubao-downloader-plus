import { useEffect } from "react";
import { db } from "@/db";

const KEY = "enable_15s_video";

export function use15sToggle() {
  useEffect(() => {
    if (!document.body) return;
    let currentOn = true;
    db.setting.where("key").equals(KEY).first().then(s => { currentOn = s?.value !== false; updateUI(currentOn); });

    const btn = document.createElement("div");
    function updateUI(on: boolean) { btn.textContent = on ? "15s ON" : "15s OFF"; btn.style.background = on ? "#2563eb" : "#6b7280"; }
    Object.assign(btn.style, {
      position: "fixed" as const, bottom: "90px", right: "20px",
      zIndex: "99999", padding: "4px 12px", borderRadius: "14px",
      cursor: "pointer", fontSize: "12px", fontWeight: "500",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
      color: "white", border: "1px solid rgba(255,255,255,0.2)",
      boxShadow: "0 2px 10px rgba(0,0,0,0.25)", userSelect: "none", lineHeight: "22px",
    });
    btn.onmouseenter = () => { btn.style.opacity = "0.8"; };
    btn.onmouseleave = () => { btn.style.opacity = "1"; };
    btn.onclick = async () => {
      const s = await db.setting.where("key").equals(KEY).first();
      const next = !(s?.value !== false);
      if (s?.id) await db.setting.update(s.id, { value: next });
      else await db.setting.add({ key: KEY, value: next } as any);
      updateUI(next);
      const t = document.createElement("div");
      Object.assign(t.style, { position: "fixed", bottom: "120px", right: "20px", background: next ? "#10b981" : "#ef4444", color: "white", padding: "8px 14px", borderRadius: "8px", fontSize: "13px", zIndex: "100000", fontFamily: "system-ui", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" });
      t.textContent = next ? "✓ 15秒模式已开启" : "✕ 15秒模式已关闭";
      document.body.appendChild(t);
      setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 2000);
    };
    document.body.appendChild(btn);
    return () => btn.remove();
  }, []);
}
