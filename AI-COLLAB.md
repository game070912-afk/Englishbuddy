# AI 协作开发记录

本项目公开记录 AI 参与的范围与过程。

## 分工

- **人（产品负责人 / AI 编排者）**：需求定义、功能创意、技术选型拍板、优先级排序、验收
- **AI（实现者）**：代码实现、测试用例、文档初稿、方案与权衡分析

## 记录格式

```
## YYYY-MM-DD
- 我下的指令：
- AI 产出：
- 我做的决定：
- 我改了什么 / 学到什么：
```

## 记录

## 2026-10-02

- 我下的指令：搭项目骨架，并让对话页真正联通 DeepSeek 流式输出（第一步范围选定为「骨架 + 真联通」）
- AI 产出：Next.js 16 脚手架；`lib/api/deepseek.ts` 流式客户端；`app/api/chat/route.ts` SSE 接口；`ChatPanel` 等组件；Vitest 用例（接口 5 个 + 工具函数 4 个）；README 与 API 文档
- 我做的决定：第一步不做登录与数据库；目录名按 npm 规范改为小写 `englishbuddy`；DeepSeek 作为首选模型（OpenAI 兼容接口）
- 待我确认：DeepSeek 密钥就绪后本地跑通 `/chat`；第二步是否上 Supabase Auth
