export interface PlatformInfo {
  name: string;
  brandColor: string;
}

export const PLATFORMS: Record<string, PlatformInfo> = {
  bilibili: {
    name: 'B站',
    brandColor: '#FB7299',
  },
  zhihu: {
    name: '知乎',
    brandColor: '#0066FF',
  },
  youtube: {
    name: 'YouTube',
    brandColor: '#FF0000',
  },
} as const;
