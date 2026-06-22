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
