type ContentType = 'video' | 'article' | 'question' | 'answer' | 'post';

interface DeepLinkSchema {
  platform: string;
  contentType: ContentType;
  schema: string;
}

const DEEP_LINK_SCHEMAS: DeepLinkSchema[] = [
  { platform: 'bilibili', contentType: 'video', schema: 'bilibili://video/{native_id}' },
  { platform: 'bilibili', contentType: 'article', schema: 'bilibili://article/{native_id}' },
  { platform: 'youtube', contentType: 'video', schema: 'youtube://watch?v={native_id}' },
];

export function getDeepLink(
  platform: string,
  contentType: string,
  nativeId: string,
): string | null {
  const schema = DEEP_LINK_SCHEMAS.find(
    (s) => s.platform === platform && s.contentType === contentType,
  );
  if (!schema) return null;
  return schema.schema.replace('{native_id}', nativeId);
}
