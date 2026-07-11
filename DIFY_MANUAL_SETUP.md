# Dify 总结工作流手动搭建指南

由于 Dify 云端解析器在大文件导入时对特定连线和逻辑分支的 Schema 校验可能发生服务端崩溃（ERR_HTTP2_PROTOCOL_ERROR），推荐在 Dify 可视化画布中直接手动拖拽搭建。整个工作流仅包含 8 个节点，5分钟即可搭建完毕。

---

## 1. 整体拓扑图

在 Dify 画布中，按照如下顺序连接节点：

```
                    ┌──→ [HTTP 请求: B站] ──────┐
[开始] → [代码执行] → [条件分支] ─→ [HTTP 请求: YouTube] ─┼─→ [LLM 节点] → [结束]
                    └──→ [模板转换: 兜底] ──────┘
```

---

## 2. 节点配置详解

### 2.1 开始 (Start) 节点
定义 4 个输入变量（均为**必填**，**单行文本**）：
* `title`：视频标题
* `url`：视频链接
* `platform`：来源平台
* `content_type`：内容类型

### 2.2 代码执行 (Code) 节点
* **功能**：提取链接中的视频 ID
* **输入变量**：
  * `url`：选择 `开始.url`
  * `platform`：选择 `开始.platform`
* **代码语言**：`JavaScript`
* **代码内容** (直接复制粘贴)：
  ```javascript
  function main({url, platform}) {
      let native_id = "";
      if (platform === "bilibili") {
          let match = url.match(/BV[a-zA-Z0-9]+/);
          if (match) native_id = match[0];
      } else if (platform === "youtube") {
          let match = url.match(/(?:v=|\/embed\/|\/watch\?v=|\/v\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
          if (match) native_id = match[1];
      }
      return { native_id: native_id || "" };
  }
  ```
* **输出变量**：
  * `native_id`：类型为 `String`

### 2.3 条件分支 (If-Else) 节点
* **分支 1 (IF)**：
  * 条件：`开始.platform` 等于 `bilibili`
  * 连线至：`HTTP 请求: B站`
* **分支 2 (ELSE IF)**：
  * 条件：`开始.platform` 等于 `youtube`
  * 连线至：`HTTP 请求: YouTube`
* **默认分支 (ELSE)**：
  * 连线至：`模板转换: 兜底`

### 2.4 HTTP 请求：B站 节点
* **方法**：`GET`
* **URL**：
  `https://api.bilibili.com/x/web-interface/view?bvid=` 后面插入变量选择 `代码执行.native_id`。
  *(拼装后类似：`https://api.bilibili.com/x/web-interface/view?bvid={{#1720612345679.native_id#}}`)*
* **Headers** (防止拦截，直接粘贴)：
  `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36`
* **连线至**：`LLM 节点`

### 2.5 HTTP 请求：YouTube 节点
* **方法**：`GET`
* **URL**：
  `https://www.youtube.com/oembed?url=` 后面插入变量选择 `开始.url`，并在末尾加上 `&format=json`。
  *(拼装后类似：`https://www.youtube.com/oembed?url={{#start.url#}}&format=json`)*
* **Headers**：留空
* **连线至**：`LLM 节点`

### 2.6 模板转换：兜底 节点
* **模板内容** (直接粘贴)：
  `无法抓取该平台的正文，仅依靠标题进行总结。`
* **连线至**：`LLM 节点`

### 2.7 LLM 节点
* **选择模型**：`gpt-4o-mini` 或 `gpt-4o` 等任意聊天模型
* **参数配置**：温度 `0.3`，最大 Token `500`
* **SYSTEM PROMPT** (直接复制粘贴)：
  ```markdown
  你是一个多平台内容总结助手。用户会给你一条视频信息，包括标题、平台、内容类型和抓取到的信息。

  请根据这些信息，用简洁的中文总结这条内容的核心要点：

  1. 总结长度控制在 50-150 字之间。
  2. 提取关键信息：主题、主要观点、结论。
  3. 客观陈述，切忌添加主观臆断与多余词汇。
  4. 如果正文或接口返回内容为空，仅基于标题进行推断总结，并在开头显著标注"[基于标题推断]"。
  5. 不要使用"该视频"、"本文"、"UP主介绍说"等冗余前缀。
  ```
* **USER PROMPT** (在输入框里插入对应的变量)：
  ```markdown
  标题：{开始.title}
  平台：{开始.platform}
  内容类型：{开始.content_type}
  链接：{开始.url}

  抓取内容详情：
  B站抓取响应：{HTTP请求B站.body}
  YouTube抓取响应：{HTTP请求YouTube.body}
  其他兜底说明：{模板转换兜底.output}

  请开始总结：
  ```
* **连线至**：`结束` 节点

### 2.8 结束 (End) 节点
* **输出变量**：
  * 键 (Key)：`summary`
  * 类型：`String`
  * 值 (Value)：选择 `LLM.text`
