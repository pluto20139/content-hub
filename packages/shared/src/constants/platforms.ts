export interface PlatformInfo {
  name: string;
  brandColor: string;
  tagBg: string;
  tagText: string;
}

export const PLATFORMS: Record<string, PlatformInfo> = {
  bilibili: {
    name: 'B站',
    brandColor: '#FB7299',
    tagBg: '#FCE8EF',
    tagText: '#D44A6E',
  },
  zhihu: {
    name: '知乎',
    brandColor: '#0066FF',
    tagBg: '#E0EDFF',
    tagText: '#0055CC',
  },
  youtube: {
    name: 'YouTube',
    brandColor: '#FF0000',
    tagBg: '#FAECEC',
    tagText: '#CC0000',
  },
  douyin: {
    name: '抖音',
    brandColor: '#000000',
    tagBg: '#F1F1F1',
    tagText: '#1C1C1E',
  },
  xiaohongshu: {
    name: '小红书',
    brandColor: '#FF2442',
    tagBg: '#FCE8EF',
    tagText: '#CC1E3A',
  },
} as const;
