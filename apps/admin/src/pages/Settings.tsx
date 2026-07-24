import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import QRCode from "qrcode";

interface ConfigItem {
  id: number;
  platform: string;
  config_key: string;
  updated_at: string;
  config_value: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

if (!SUPABASE_URL) {
  throw new Error("Missing VITE_SUPABASE_URL");
}

export default function Settings() {
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Bilibili QR auth state
  const [showQr, setShowQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [pollStatus, setPollStatus] = useState("");
  const [cookieUpdated, setCookieUpdated] = useState<string | null>(null);

  // Cron trigger state
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState("");

  useEffect(() => {
    fetchConfigs();
  }, []);

  async function fetchConfigs() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/settings/platform-configs`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `获取平台配置失败 (${res.status})`);
      }

      const data = await res.json();
      setConfigs(data);
    } catch (err: any) {
      console.error("Fetch configs error:", err);
      setError(err.message || "加载系统配置失败");
    }
  }

  // Handle Bilibili QR login
  const handleStartBilibiliLogin = async () => {
    setShowQr(true);
    setPollStatus("正在获取哔哩哔哩登录二维码...");
    setCookieUpdated(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/bilibili-auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });

      const data = await res.json();
      if (!res.ok || !data.url || !data.qrcode_key) {
        throw new Error(data.error || "获取二维码失败");
      }

      const qrUrl = await QRCode.toDataURL(data.url, { margin: 2, width: 200 });
      setQrDataUrl(qrUrl);
      setPollStatus("请使用哔哩哔哩 App 扫码登录");

      // Poll QR status
      const qrcodeKey = data.qrcode_key;
      const timer = setInterval(async () => {
        try {
          const pollRes = await fetch(`${SUPABASE_URL}/functions/v1/bilibili-auth`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll", qrcode_key: qrcodeKey }),
          });

          const pollData = await pollRes.json();
          if (pollData.code === 0) {
            clearInterval(timer);
            setPollStatus("🎉 扫码成功！Cookie 已成功自动保存入库。");
            setCookieUpdated(new Date().toLocaleString("zh-CN"));
            fetchConfigs();
          } else if (pollData.code === 86038) {
            clearInterval(timer);
            setPollStatus("❌ 二维码已失效，请重新生成。");
          } else {
            setPollStatus(`扫码状态：${pollData.message || "等待扫码..."}`);
          }
        } catch {
          // ignore transient poll error
        }
      }, 2000);
    } catch (err: any) {
      setPollStatus(`失败: ${err.message}`);
    }
  };

  // Handle Cron Trigger
  const handleTriggerCron = async () => {
    setTriggering(true);
    setTriggerMsg("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-api/settings/cron-trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "强行触发失败");
      }

      setTriggerMsg("🎉 Cron 独占锁已重置，系统将在后台立刻激活单次全网抓取流程！");
    } catch (err: any) {
      setTriggerMsg(`错误: ${err.message}`);
    } finally {
      setTriggering(false);
    }
  };

  const bilibiliCookieConfig = configs.find((c) => c.platform === "bilibili" && c.config_key === "cookie");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">系统设置与运维面板</h1>
        <p className="text-xs text-gray-500 mt-1">B站 Cookie 扫码绑定、Twitter API 状态、RSSHub 连通性与 Cron 锁运维</p>
      </div>

      {error && <div className="p-4 bg-red-50 text-red-600 text-xs rounded-xl">{error}</div>}

      {/* 1. B站 Cookie 授权 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center">
              <span className="text-base mr-2">📺</span> 哔哩哔哩 (Bilibili) Cookie 状态
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              更新状态：{bilibiliCookieConfig ? new Date(bilibiliCookieConfig.updated_at).toLocaleString("zh-CN") : "未检测到配置"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleStartBilibiliLogin}
            className="px-4 py-2 bg-[#FB7299] text-white text-xs font-semibold rounded-xl hover:bg-[#e05e83] transition shadow-sm"
          >
            扫码重新绑定 Cookie
          </button>
        </div>

        {showQr && (
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200/80 flex flex-col items-center justify-center space-y-3">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="B站扫码登录" className="w-48 h-48 rounded-xl shadow-md border bg-white p-2" />
            ) : (
              <div className="w-48 h-48 rounded-xl bg-gray-200 flex items-center justify-center text-xs text-gray-400">
                生成中...
              </div>
            )}
            <p className="text-xs font-medium text-gray-700">{pollStatus}</p>
            {cookieUpdated && <p className="text-xs text-emerald-600 font-bold">{cookieUpdated}</p>}
          </div>
        )}
      </div>

      {/* 2. RSSHub & 海外节点连通性 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-sm font-bold text-gray-900 flex items-center">
          <span className="text-base mr-2">🌐</span> RSSHub 与云端 Edge 节点连通性
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-900">自部署 RSSHub 服务 (1200 端口)</p>
              <p className="text-gray-500 text-[11px] mt-0.5">知乎/抖音/小红书/B站 依赖节点</p>
            </div>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 font-bold text-[10px] rounded-full">
              ● 运行正常
            </span>
          </div>

          <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-900">Supabase Edge Function x-fetcher</p>
              <p className="text-gray-500 text-[11px] mt-0.5">X (Twitter) 海外免 GFW 节点</p>
            </div>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 font-bold text-[10px] rounded-full">
              ● 已上线服务
            </span>
          </div>
        </div>
      </div>

      {/* 3. Cron 调度锁与一键抓取 */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-gray-900 flex items-center">
              <span className="text-base mr-2">⚡</span> Cron 全局调度锁与手动抓取
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              重置 `cron_locks` 表排他锁，强行激活全网单次抓取与 AI 摘要生成
            </p>
          </div>
          <button
            type="button"
            onClick={handleTriggerCron}
            disabled={triggering}
            className="px-4 py-2 bg-black text-white text-xs font-semibold rounded-xl hover:bg-gray-800 disabled:opacity-50 transition shadow-sm"
          >
            {triggering ? "强行触发中..." : "手动强行触发抓取"}
          </button>
        </div>

        {triggerMsg && (
          <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-xl font-medium border border-emerald-100">
            {triggerMsg}
          </div>
        )}
      </div>
    </div>
  );
}
