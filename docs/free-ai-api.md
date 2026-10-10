# 零成本接入 AI：用智谱 GLM-4.7-Flash

> 结论先给：**不用充钱，不用改代码。** 注册智谱开放平台拿一个免费密钥，填进环境变量就能跑。

## 为什么是智谱

| 项目 | 说明 |
| --- | --- |
| 价格 | GLM-4.7-Flash / GLM-4.5-Flash / GLM-4-Flash **官方标注免费**，无信用卡、无充值 |
| 注册 | 手机号即可，国内直连，不需要代理 |
| 接口 | OpenAI 兼容，本项目已经按这个格式写好 |
| 额度 | 新用户赠送 Token 包（永久有效），免费模型本身不计费；并发上限 30 |
| 能力 | GLM-4.7-Flash：200K 上下文，通用对话与代码能力都不错，做英语陪练绰绰有余 |

DeepSeek 现在没有免费额度（必须充值，最低档约 10 元），所以本项目**默认供应商改成了智谱**。以后想换回来，只改环境变量，代码一行不动。

## 第一步：注册并拿密钥（约 3 分钟）

1. 打开 <https://open.bigmodel.cn/>，用手机号注册登录
2. 进入控制台，找到 **API 密钥** 页面（通常地址是 <https://open.bigmodel.cn/usercenter/apikeys>；如果页面改版，就在右上角头像菜单里找「API Keys / 密钥管理」）
3. 点 **添加新的 API Key**，复制生成的一长串字符串
   - 形如 `xxxxxx.yyyyyyyy`，**只显示一次**，先粘到记事本里
   - 这个密钥等于你的钱袋子，**不要发到群里、不要提交到 GitHub**

## 第二步：本地配置

编辑项目根目录的 `.env.local`（文件已存在且被 `.gitignore` 忽略，不会上传）：

```bash
AI_PROVIDER=zhipu
AI_API_KEY=这里粘贴你刚复制的密钥
```

然后重启开发服务器：

```bash
pnpm dev
```

打开 <http://localhost:3000/chat> 随便发一句英文，能看到 AI 逐字回复就成功。

## 第三步：Vercel 线上配置

在 Vercel 项目的 **Settings → Environment Variables** 里加两条：

| 名称 | 值 |
| --- | --- |
| `AI_PROVIDER` | `zhipu` |
| `AI_API_KEY` | 你的智谱密钥 |

加完必须 **Redeploy** 一次才会生效。

> ⚠️ 变量名**不要**加 `NEXT_PUBLIC_` 前缀。加了会被打包进浏览器，密钥等于公开。

## 想换成别的供应商？

全部通过环境变量切换，代码不用动：

| 供应商 | `AI_PROVIDER` | 备注 |
| --- | --- | --- |
| 智谱（默认，免费） | `zhipu` | 国内直连 |
| DeepSeek（需充值） | `deepseek` | 性价比高，无免费额度 |
| 任意 OpenAI 兼容服务 | 留空 | 同时填 `AI_BASE_URL` + `AI_MODEL` + `AI_API_KEY` |

其他有免费额度的备选（同样是 OpenAI 兼容，填 `AI_BASE_URL` 即可）：

- **硅基流动** <https://api.siliconflow.cn/v1> — 9B 以下小模型永久免费
- **火山引擎（豆包）** — 每天 200 万 Token，但要在控制台手动开通模型
- **阿里云百炼** <https://dashscope.aliyuncs.com/compatible-mode/v1> — 每模型 100 万 Token / 90 天
- **Google Gemini** <https://generativelanguage.googleapis.com/v1beta/openai> — 免费额度大，但**国内需要代理**，Vercel 上部署不推荐

## 省钱机制说明

项目里 `lib/api/ai.ts` 是**唯一的** AI 调用出口：

- 所有密钥只在服务端读取，前端完全看不到
- 换供应商 = 换环境变量，不动业务代码
- 纠错接口 `/api/correct` 内置了一次重试（第一次解析不出结果会用更严格的参数再试一次），避免白烧 Token

## 踩坑提示

1. **密钥泄露怎么办**：去智谱控制台把旧 Key 删掉重新生成一个，然后更新 `.env.local` 和 Vercel 环境变量。提交到 GitHub 的密钥即使删掉记录也可能已被抓取，一定要先作废再重新生成。
2. **回复被截断**：两个接口都设了 `maxDuration = 60`，Vercel 免费版单函数上限 60 秒。如果经常超时，换更快的模型或缩短输入。
3. **突然报"AI 服务暂时不可用"**：免费额度有并发限制（智谱 30 并发），也可能是上游限流，等一会再试。
4. **本地改了 `.env.local` 没生效**：Next.js 不会热加载环境变量，必须重启 `pnpm dev`。

## 配一个备用供应商（强烈建议）

免费额度有个共同特点：**不是一直能用，而是一阵一阵地抽风**。主供应商再稳，
也会有半夜限流、网关 502 的时候。所以这个项目支持**主备自动切换**：

主供应商失败（重试过仍不行）→ 自动用备用供应商再发一次 → 都不行才报错。

配置方法：在 Vercel 的环境变量里加三条（本地就加进 `.env.local`）：

```
AI_FALLBACK_BASE_URL=https://api.groq.com/openai/v1
AI_FALLBACK_API_KEY=你的备用密钥
AI_FALLBACK_MODEL=备用模型名
```

**三条必须同时填**，缺一条就当作没配，不会发到错误的地址。

### 备用选哪家

| 备选 | 免费额度 | 优点 | 注意 |
| --- | --- | --- | --- |
| **Groq**（推荐） | 聊天模型 30 次/分钟、1000 次/天、20 万 Token/天（**按模型各自独立计**） | **速度最快**（LPU 加速），Vercel 部署在美国访问延迟最低 | 注册需要代理；**Llama 系列 2026-08 起已不在免费档**，别照抄老教程 |
| 火山引擎（豆包） | 每天 200 万 Token | 国内直连、额度大 | 必须先在控制台手动开通模型，否则有 Key 也调不通 |
| 阿里云百炼 | 每模型 100 万 Token | 模型最全 | 免费额度只在部分地域有，且 90 天有效 |
| 硅基流动 | 新用户 2000 万 Token | 模型多 | **对话类小模型的免费已取消**，只剩 embedding/语音/OCR |

> 硅基流动这条是 2026-10 才变的情况，之前很多教程还在推荐它做对话备用，别照抄老教程。

### 实测记录（2026-10-04，Groq 免费 Key）

调 `/models` 拿到的**真实可用清单**（11 个，其中能聊天的只有 3 个）：

| 模型 id | 用途 |
| --- | --- |
| `openai/gpt-oss-20b` | 聊天，**推荐**，实测首字 1 秒、整句 1.2 秒 |
| `openai/gpt-oss-120b` | 聊天，更聪明但更慢 |
| `qwen/qwen3.8-27b` | 聊天，中文更强 |
| `openai/gpt-oss-safeguard-20b`、`meta-llama/llama-prompt-guard-2-*` | 安全分类器，**不能聊天** |
| `whisper-large-v3`、`whisper-large-v3-turbo` | 语音转写 |
| `allam-2-7b`、`canopylabs/orpheus-*` | 阿拉伯语模型、语音合成 |

两点要注意：

1. **Llama 对话模型确实没了**。清单里带 `meta-llama` 的只剩两个分类器，老教程那句 `llama-3.3-70b-versatile` 已经调不通
2. **本地直连 `api.groq.com` 会返回 403**（Cloudflare 拦）。本地要验证就给 Node 配代理：
   `NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 pnpm dev`
   Vercel 的函数在美国，能直连，**线上不受影响**

### 为什么 Groq 适合当备用

- 站点跑在 Vercel 上，函数在美国，**访问 Groq 是同区域直连**，比跨太平洋打回国内快
- 请求数配额（每天约 1.4 万次）比 Token 配额更适合"短对话"这种场景
- 英语陪练不需要中文长文本能力，Llama 系完全够

### 验证备用有没有生效

随便发一句话，然后去 Vercel 项目 → Logs 里找这一行：

```
[EnglishBuddy] 主供应商返回 5xx，改用备用供应商
```

看到它就说明切换成功。平时没看到是正常的——说明主供应商一直扛得住。

