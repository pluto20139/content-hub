## 1. 核心样式体系
本项目前端（配置管理端 `apps/admin` 与用户端 H5 `apps/h5`）采用 **Tailwind CSS 3** 作为唯一的样式解决方案。整体设计遵循**原子化 CSS (Atomic CSS)** 方法论，强调通过组合实用类（Utility Classes）来构建 UI，而非编写传统的自定义 CSS 文件。

- **框架版本**：Tailwind CSS 3
- **构建工具集成**：Vite 5
- **设计哲学**：移动端优先 (Mobile First)，确保 H5 页面在移动设备上的最佳体验。

## 2. 关键设计规范

### 2.1 命名与书写规范
- **CSS 类名**：严禁编写自定义 CSS 类名，优先使用 Tailwind 原子类。
  - ✅ 推荐：`className="flex items-center gap-2"`
  - ❌ 避免：`.card-container { display: flex; ... }`
- **组件文件**：React 组件文件采用 PascalCase 命名（如 `ContentCard.tsx`），样式直接内嵌于 JSX/TSX 中。

### 2.2 平台视觉标识 (Design Tokens)
虽然未使用独立的设计 Token 文件，但 PRD 定义了严格的**平台专属配色规范**，用于信息流中的平台标签 (Tag) 和视觉区分：

| 平台 | 配色值 | 用途 |
| :--- | :--- | :--- |
| **抖音 (Douyin)** | `#000000` (黑色) | 平台 Tag、品牌色 |
| **哔哩哔哩 (Bilibili)** | `#FB7299` (粉色) | 平台 Tag、品牌色 |
| **知乎 (Zhihu)** | `#0066FF` (蓝色) | 平台 Tag、品牌色 |
| **YouTube** | `#FF0000` (红色) | 平台 Tag、品牌色 |

### 2.3 响应式策略
- **移动端优先**：H5 用户端 (`apps/h5`) 针对手机屏幕优化，支持无限滚动和 Deep Link 跳转交互。
- **适配场景**：需兼容微信/支付宝内置浏览器环境，样式需考虑受限环境下的弹窗与引导交互。

## 3. 目录结构与组织
样式逻辑紧密耦合在 React 组件中，通过 Monorepo 结构管理：
- `apps/h5/src/components/`：H5 端通用 UI 组件（如信息卡片 `ContentCard`）。
- `apps/admin/src/components/`：管理端通用 UI 组件（如监控列表 `MonitorList`）。
- `packages/shared/src/constants/platforms.ts`：共享平台常量（包含上述配色定义），确保前后端视觉一致性。

## 4. 开发者准则
1. **零自定义 CSS**：除非遇到 Tailwind 无法覆盖的极端场景（如复杂的动画关键帧），否则禁止创建 `.css` 或 `.scss` 文件。
2. **复用共享常量**：涉及平台配色的逻辑，必须从 `@content-hub/shared` 包中引用常量，禁止在组件内硬编码颜色值。
3. **保持原子化**：利用 Tailwind 的组合特性处理响应式布局（如 `md:flex-row flex-col`），确保多端适配。
4. **UI 一致性**：严格遵循 PRD 定义的“信息卡片”模型（封面图 16:9、标题最多 2 行溢出截断、左上角平台角标）。