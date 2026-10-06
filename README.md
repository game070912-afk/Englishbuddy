# EnglishBuddy

[![CI](https://github.com/game070912-afk/Englishbuddy/actions/workflows/ci.yml/badge.svg)](https://github.com/game070912-afk/Englishbuddy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

基于大模型的英语学习助手：开口说话，说错了当场纠正。

**在线体验**：<https://englishbuddy.edgeone.dev>
**备用镜像**：<https://englishbuddy-iota.vercel.app>（海外更快）

> 两个地址在中国大陆裸连都可能打不开（`vercel.app` 被封、`edgeone.dev` 因选了「境外加速」返回 401），
> 演示给别人看之前先确认对方的网络环境。详见 [docs/deploy.md](./docs/deploy.md)。

> **AI 协作开发说明**：需求定义、产品创意、AI 编排与验收由人负责；代码实现、测试用例、文档初稿由 AI 生成并经人工审查。详见 [AI-COLLAB.md](./AI-COLLAB.md)。

## 功能列表

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 英语对话练习 | ✅ 可用 | 模拟外教 Alex，可指定话题与难度，回复流式输出 |
| 语法 / 表达纠错 | ✅ 可用 | 标注错误类型（语法/用词/风格/表达）并给出更地道的说法 |
| 邮箱注册与登录 | ✅ 可用 | Supabase Auth，会话通过 `proxy.ts` 自动刷新 |
| 对话历史保存 | ✅ 可用 | 登录后自动存档，换设备也能接着看（RLS 保证只看到自己的） |
| 词汇查询与生词本 | ✅ 可用 | 结合上下文生成音标/释义/例句，登录后可收藏成卡片随时复习 |
| 语音输入 | ✅ 可用（需配置） | 对话页按住麦克风说英语，松手转成文字回填输入框，改完再发送 |

> 语音输入与备用 AI 共用同一个 Groq Key：配好 `AI_FALLBACK_*` 三条（免费，见 [docs/free-ai-api.md](./docs/free-ai-api.md)），语音就能用，不用单独申请。不配也不影响其它功能，只是对话页不会出现麦克风按钮。详见 [docs/deploy.md](./docs/deploy.md)。

**不用注册也能直接用**：匿名访客可以试试对话、纠错和查词，每 IP 10 分钟 20 次、对话上下文 6 条；登录后解锁完整额度、历史保存与生词本收藏。

## 技术栈

- Next.js 16（App Router）+ TypeScript（strict）
- Tailwind CSS 4
- Supabase（已接入：邮箱登录 + Postgres + 行级安全策略 RLS）
- AI 供应商可插拔：默认智谱 GLM-4.7-Flash（**免费**），可一键切换 DeepSeek 或任意 OpenAI 兼容服务
- 语音转写：Groq whisper-large-v3（多语言模型，强制按英文识别），同样收在 `lib/api/` 单处，换供应商只改一个文件

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

### `POST /api/transcribe`

语音转写接口。浏览器录音转成文字必须经由服务端转发（密钥不能进前端，国内语音供应商也普遍禁止浏览器跨域直连），密钥只在服务端读取。

请求体：

```json
{ "audio": "<base64 的 WAV：16kHz / 16bit / 单声道>" }
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| audio | string | 是 | WAV 音频的 base64，≤60 秒 |

成功响应：

```json
{ "text": "I want to practice my English." }
```

失败响应：

```json
{ "error": { "message": "没听清，请再说一次", "code": "ASR_UPSTREAM_ERROR" } }
```

错误码：`INVALID_REQUEST` / `ASR_NOT_CONFIGURED` / `ASR_UPSTREAM_ERROR` / `RATE_LIMITED` / `INTERNAL_ERROR`

> 音频转码在浏览器端完成：`MediaRecorder` 录下的 webm/opus 经 Web Audio 解码后重采样成 16kHz 单声道，
> 再编码成 WAV 上传。服务端只在内存里转发，**不落盘、不入库**。

## 部署

支持两个平台，环境变量完全一样（填 `AI_API_KEY`；要语音输入就再配备用 AI 的 `AI_FALLBACK_*` 三条，语音与备用 AI 共用同一个 Groq Key）：

- **EdgeOne Pages（推荐）**：腾讯云边缘节点，`*.edgeone.app` 国内可直接打开，免费套餐，零配置支持 Next.js SSR
- **Vercel**：海外访问快，但 **`*.vercel.app` 在国内打不开**（实测 Vercel 的 IP 段被封，换域名也没用）

> 踩过的坑：原本推荐 Zeabur，但它的共享集群已在 2026 年停止服务，新项目必须买服务器或自带机器，
> 零成本路线不再存在——详见 [docs/deploy.md](./docs/deploy.md)。平台免费政策会变，动手前先查官方文档。

**改完环境变量要重新部署**，否则不生效。详细步骤、环境变量表与常见坑见 [docs/deploy.md](./docs/deploy.md)，免费密钥获取见 [docs/free-ai-api.md](./docs/free-ai-api.md)。

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
