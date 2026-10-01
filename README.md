# EnglishBuddy

[![CI](https://github.com/game070912-afk/Englishbuddy/actions/workflows/ci.yml/badge.svg)](https://github.com/game070912-afk/Englishbuddy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

基于大模型的英语学习助手：开口说话，说错了当场纠正。

**在线体验**：<https://englishbuddy-iota.vercel.app>

> **AI 协作开发说明**：需求定义、产品创意、AI 编排与验收由人负责；代码实现、测试用例、文档初稿由 AI 生成并经人工审查。详见 [AI-COLLAB.md](./AI-COLLAB.md)。

## 功能列表

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 英语对话练习 | ✅ 可用 | 模拟外教 Alex，可指定话题与难度，回复流式输出 |
| 语法 / 表达纠错 | ✅ 可用 | 标注错误类型（语法/用词/风格/表达）并给出更地道的说法 |
| 词汇查询与学习卡片 | 🚧 开发中 | 结合上下文生成释义与例句 |

## 技术栈

- Next.js 16（App Router）+ TypeScript（strict）
- Tailwind CSS 4
- Supabase（Auth + Postgres，第二步接入）
- AI 供应商可插拔：默认智谱 GLM-4.7-Flash（**免费**），可一键切换 DeepSeek 或任意 OpenAI 兼容服务

## 本地开发

1. 安装依赖：`pnpm install`
2. 复制环境变量模板并填入自己的密钥：

   ```bash
   cp .env.example .env.local
   # 编辑 .env.local，填入 AI_API_KEY
   ```

   没有密钥？**不需要花钱**：照着 [docs/free-ai-api.md](./docs/free-ai-api.md) 注册智谱开放平台，3 分钟拿到免费密钥。

3. 启动开发服务器：`pnpm dev`，打开 <http://localhost:3000>

其他命令：

```bash
pnpm typecheck   # 类型检查
pnpm test        # 运行 Vitest 用例
pnpm lint        # ESLint 检查
pnpm build       # 生产构建
```

## API 文档

### `POST /api/chat`

对话练习接口，密钥只在服务端读取。

请求体：

```json
{
  "messages": [{ "id": "1", "role": "user", "content": "I wants to practice English" }],
  "topic": "面试",
  "level": "beginner"
}
```

参数说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| messages | ChatMessage[] | 是 | 历史消息，最多取最近 20 条，单条 ≤2000 字符 |
| topic | string | 否 | 练习话题，≤100 字符 |
| level | "beginner" \| "intermediate" \| "advanced" | 否 | 难度，默认 intermediate |

成功响应：`text/event-stream`，每行一个事件：

```
data: {"type":"delta","text":"Sure!"}
data: {"type":"done","reason":"stop"}
```

失败响应：

```json
{ "error": { "message": "AI 服务暂时不可用，请稍后再试", "code": "AI_UPSTREAM_ERROR" } }
```

错误码：`INVALID_REQUEST` / `AI_NOT_CONFIGURED` / `AI_UPSTREAM_ERROR` / `AI_STREAM_ERROR` / `INTERNAL_ERROR`

### `POST /api/correct`

语法纠错接口，同样只在服务端读取密钥。

请求体：

```json
{ "text": "I wants to practice my English." }
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| text | string | 是 | 待批改的英文，≤2000 字符 |

成功响应：`text/event-stream`，先给修改后的整段，再逐条推送批改意见：

```
data: {"type":"corrected","text":"I want to practice my English."}
data: {"type":"item","item":{"original":"I wants","suggestion":"I want","type":"grammar","explanation":"主语 I 后接动词原形"}}
data: {"type":"done"}
```

模型输出完全无法解析时会自动重试一次，仍失败则推送 `{"type":"error","message":"..."}`。

## 部署

Vercel 一键导入即可，环境变量填 `AI_PROVIDER=zhipu` 与 `AI_API_KEY`。详细步骤与常见坑见 [docs/deploy.md](./docs/deploy.md)，免费密钥获取见 [docs/free-ai-api.md](./docs/free-ai-api.md)。

## 架构决策

关键取舍记录在 [docs/decisions/](./docs/decisions/)，例如「为什么做成供应商可插拔 + SSE/JSON Lines 流式输出」。

## 开源协议

[MIT](./LICENSE)

## 目录结构

```
app/            路由页面与 API Route Handlers
components/     UI 组件
lib/api/        AI 调用与提示词封装
lib/types/      共享类型
lib/utils/      输入校验与解析工具
docs/           部署文档与架构决策记录
tests/          Vitest 用例
```
