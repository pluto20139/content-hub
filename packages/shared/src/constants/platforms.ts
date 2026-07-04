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
  douyin: {
    name: '抖音',
    brandColor: '#000000',
  },
  xiaohongshu: {
    name: '小红书',
    brandColor: '#FF2442',
  },
} as const;
