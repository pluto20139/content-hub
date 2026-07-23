export type Environment = 'wechat' | 'alipay' | 'browser';

/**
 * Detect the current browser environment from the User-Agent string.
 * SPEC 5.7.1:
 *   - MicroMessenger → wechat
 *   - AlipayClient    → alipay
 *   - everything else → browser
 */
export function detectEnvironment(ua: string): Environment {
  if (ua.includes('MicroMessenger')) return 'wechat';
  if (ua.includes('AlipayClient')) return 'alipay';
  return 'browser';
}

const MOBILE_UA_PATTERNS = ['Mobile', 'Android', 'iPhone', 'iPad', 'iPod'];

/**
 * Detect whether the User-Agent belongs to a desktop browser.
 * Used to bypass the mobile-only Deep Link + 2.5s fallback flow.
 * Returns false for WeChat/Alipay (they are wrappers that have their own flow).
 */
export function isDesktopBrowser(ua: string): boolean {
  if (ua.includes('MicroMessenger') || ua.includes('AlipayClient')) return false;
  return !MOBILE_UA_PATTERNS.some((pattern) => ua.includes(pattern));
}
