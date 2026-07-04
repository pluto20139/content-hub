import { PLATFORMS } from "@content-hub/shared";

export interface TabConfig {
  key: string;
  label: string;
  platform: string | null;
}

export const TABS: TabConfig[] = [
  { key: "all", label: "全部", platform: null },
  { key: "bilibili", label: PLATFORMS.bilibili.name, platform: "bilibili" },
  { key: "youtube", label: PLATFORMS.youtube.name, platform: "youtube" },
  { key: "zhihu", label: PLATFORMS.zhihu.name, platform: "zhihu" },
  { key: "douyin", label: PLATFORMS.douyin.name, platform: "douyin" },
  { key: "xiaohongshu", label: PLATFORMS.xiaohongshu.name, platform: "xiaohongshu" },
  { key: "hidden", label: "已隐藏", platform: "hidden" },
];
