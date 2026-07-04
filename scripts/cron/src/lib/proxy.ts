import { supabase } from "./supabase.js";

export interface ProxyPool {
  getProxy(): string | null;
  markFailed(proxy: string): void;
  getHealthyProxy(): string | null;
  allFailed(): boolean;
}

export class DatabaseProxyPool implements ProxyPool {
  private platform: string;
  private proxies: Array<{ url: string; failCount: number; inactiveUntil: Date | null }> = [];

  constructor(platform: string) {
    this.platform = platform;
  }

  async load(): Promise<void> {
    try {
      // 1. Query platform configs
      const { data, error } = await supabase
        .from("platform_configs")
        .select("config_value")
        .eq("platform", this.platform)
        .eq("config_key", "proxy_list")
        .maybeSingle();

      let listStr = data?.config_value || "";

      // 2. Fallback to Env seeds
      if (!listStr) {
        const envKey = `${this.platform.toUpperCase()}_PROXY_LIST`;
        listStr = process.env[envKey] || "";
      }

      if (listStr) {
        const urls = listStr.split(",").map((p: string) => p.trim()).filter(Boolean);
        this.proxies = urls.map((url: string) => ({
          url,
          failCount: 0,
          inactiveUntil: null
        }));
        console.log(`[ProxyPool] Loaded ${this.proxies.length} proxies for platform ${this.platform}`);
      }
    } catch (err: any) {
      console.error(`[ProxyPool] Failed to load proxies:`, err.message);
    }
  }

  getProxy(): string | null {
    return this.getHealthyProxy();
  }

  getHealthyProxy(): string | null {
    const now = new Date();
    const healthy = this.proxies.filter(p => {
      if (p.inactiveUntil && p.inactiveUntil > now) {
        return false;
      }
      return true;
    });

    if (healthy.length === 0) return null;
    const selected = healthy[Math.floor(Math.random() * healthy.length)];
    return selected.url;
  }

  markFailed(proxyUrl: string): void {
    const proxy = this.proxies.find(p => p.url === proxyUrl);
    if (!proxy) return;

    proxy.failCount++;
    if (proxy.failCount >= 2) {
      proxy.inactiveUntil = new Date(Date.now() + 30 * 60 * 1000); // disable for 30 mins
      proxy.failCount = 0;
      console.log(`[ProxyPool] Proxy ${proxyUrl} disabled until ${proxy.inactiveUntil.toISOString()}`);
    }
  }

  allFailed(): boolean {
    if (this.proxies.length === 0) return false;
    const now = new Date();
    return this.proxies.every(p => p.inactiveUntil && p.inactiveUntil > now);
  }
}
