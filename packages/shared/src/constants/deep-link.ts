export type Platform = 'bilibili' | 'youtube' | 'zhihu' | 'douyin' | 'xiaohongshu';
export type ContentType = 'video' | 'article' | 'question' | 'answer' | 'post';

interface DeepLinkSchema {
  platform: Platform;
  contentType: ContentType;
  schema: string;
}

const DEEP_LINK_SCHEMAS: DeepLinkSchema[] = [
  { platform: 'bilibili', contentType: 'video', schema: 'bilibili://video/{native_id}' },
  { platform: 'bilibili', contentType: 'article', schema: 'bilibili://article/{native_id}' },
  { platform: 'youtube', contentType: 'video', schema: 'youtube://watch?v={native_id}' },
  { platform: 'zhihu', contentType: 'article', schema: 'zhihu://zhuanlan/{native_id}' },
  { platform: 'zhihu', contentType: 'answer', schema: 'zhihu://answer/{native_id}' },
  { platform: 'zhihu', contentType: 'question', schema: 'zhihu://question/{native_id}' },
  { platform: 'zhihu', contentType: 'post', schema: 'zhihu://people/{monitor_native_id}/pins/{native_id}' },
  { platform: 'douyin', contentType: 'video', schema: 'snssdk1128://aweme/detail/{native_id}' },
  { platform: 'xiaohongshu', contentType: 'post', schema: 'xhsdiscover://item/{native_id}' },
  { platform: 'xiaohongshu', contentType: 'video', schema: 'xhsdiscover://item/{native_id}' },
];

export interface DeepLinkOptions {
  monitorNativeId?: string;
  originalUrl?: string;
}

export function getDeepLink(
  platform: string,
  contentType: string,
  nativeId: string,
  options?: DeepLinkOptions,
): string | null {
  const schema = DEEP_LINK_SCHEMAS.find(
    (s) => s.platform === platform && s.contentType === contentType,
  );
  if (!schema) {
    return options?.originalUrl ?? null;
  }

  // Handle case where monitorNativeId is required but missing
  if (schema.schema.includes('{monitor_native_id}')) {
    if (!options?.monitorNativeId) {
      return options?.originalUrl ?? null;
    }
    // Remove people: prefix if it exists in zhihu monitor native_id
    const cleanMonitorId = options.monitorNativeId.replace("people:", "");
    return schema.schema
      .replace('{monitor_native_id}', cleanMonitorId)
      .replace('{native_id}', nativeId);
  }

  return schema.schema.replace('{native_id}', nativeId);
}
