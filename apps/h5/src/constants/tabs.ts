import { PLATFORMS } from "@content-hub/shared";

export interface TabConfig {
  key: string;
  label: string;
  platform: string | null;
}

export const TABS: TabConfig[] = [
  { key: "all", label: "全部", platform: null },
  { key: "bilibili", label: PLATFORMS.bilibili.name, platform: "bilibili" },
  { key: "zhihu", label: PLATFORMS.zhihu.name, platform: "zhihu" },
  { key: "youtube", label: PLATFORMS.youtube.name, platform: "youtube" },
];
