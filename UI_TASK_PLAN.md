# UI 优化 Task Plan：苹果系极简留白

## 改动范围

| Task | 文件 | 内容 | 耗时 |
|---|---|---|---|
| T1 | `packages/shared/src/constants/platforms.ts` | 新增 `tagBg`（浅色底）和 `tagText`（品牌色文字）字段 | 0.5h |
| T2 | `apps/h5/src/App.tsx` | Tab 栏改为 iOS 分段控件（灰底白丸 pill） | 0.5h |
| T3 | `apps/h5/src/components/ContentCard.tsx` | 卡片圆角 12px / 0.5px 边框 / 16px padding / 封面 72×72 / 平台标签浅色底 / 标题 15px | 1h |
| T4 | `apps/h5/src/components/ContentCard.tsx` | AI 总结区域：去掉 indigo / 改用 #F9F9F9 中性底 / 标签 #8E8E93 / 正文 13px line-height 1.6 | 1h |
| T5 | `apps/h5/src/components/ContentCard.tsx` | 触发方式从紫色按钮改为 "AI 要点 ▾" 文字链接 / chevron 旋转动效 | 0.5h |
| T6 | `apps/h5/src/components/ContentCard.tsx` | 展开动效：max-height 过渡 300ms ease-out 替代瞬间显示 | 0.5h |
| T7 | `apps/h5/src/components/ContentCard.tsx` | Pending 态改为小转圈 + "总结中" 灰色文字 | 0.5h |
| T8 | `apps/h5/src/components/SkeletonCard.tsx` | 骨架屏配色对齐新卡片（圆角 12px / 0.5px 边框 / 封面 72×72） | 0.5h |
| T9 | `apps/h5/src/index.css` | 新增 spin keyframe / 全局配色变量 / 去掉 App.css 引用 | 0.5h |

**总耗时**：约 5.5h

## 配色规范

```
页面底色:   #F2F2F7
卡片底色:   #FFFFFF
卡片边框:   rgba(0,0,0,0.06) / 0.5px
主文字:     #1C1C1E
次文字:     #8E8E93
弱文字:     #C7C7CC
AI总结底色: #F9F9F9
AI总结分隔: rgba(0,0,0,0.06) / 0.5px
```

## 平台标签配色

| 平台 | 浅色底 | 文字色 |
|---|---|---|
| B站 | #FCE8EF | #D44A6E |
| YouTube | #FAECEC | #CC0000 |
| 知乎 | #E0EDFF | #0055CC |
| 抖音 | #F1F1F1 | #1C1C1E |
| 小红书 | #FCE8EF | #CC1E3A |

## 执行顺序

T1 → T9 → T2 → T3 → T4 → T5 → T6 → T7 → T8

T1 先改共享包配色常量，T9 加全局 CSS，然后 T2-T8 都在组件层面改。T3-T7 都在 ContentCard 里，一次改完。
