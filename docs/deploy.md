# 部署到 Vercel

前置条件：代码已推到 GitHub，且本地已跑通（`pnpm build` 通过）。

## 步骤

1. 打开 <https://vercel.com/new>，用 GitHub 账号登录，选择本仓库导入
2. Framework Preset 会自动识别为 **Next.js**，构建命令 `pnpm build`、输出目录默认即可
3. 在 **Environment Variables** 里添加：

   | 名称 | 值 | 说明 |
   | --- | --- | --- |
   | `AI_PROVIDER` | `zhipu` | 选填，默认已是 zhipu |
   | `AI_API_KEY` | 你的 AI 密钥 | 必填，服务端专用 |
   | `BAIDU_ASR_API_KEY` | 百度语音识别 Key | 选填，不填就没有语音输入 |
   | `BAIDU_ASR_SECRET_KEY` | 百度语音识别 Secret | 选填，同上 |

   还没有密钥？先看 [free-ai-api.md](./free-ai-api.md)，智谱 GLM-4.7-Flash **完全免费**，手机号注册即可，3 分钟搞定。
   语音输入走百度短语音识别（英文），个人认证后有 3 万次免费调用额度，在
   <https://console.bce.baidu.com/ai/#/ai/speech/overview/index> 创建应用即可拿到两条 Key。
   **两条都不填也不会报错**，只是对话页不会出现麦克风按钮。

4. 点击 **Deploy**，等 1–2 分钟拿到线上域名
5. 打开域名验证：`/` 首页、`/chat` 对话、`/correct` 批改

## 必须注意的坑

1. **密钥不要加 `NEXT_PUBLIC_` 前缀**：带这个前缀的变量会被打包进浏览器，等于公开泄露。项目里所有 AI 调用都在服务端 Route Handler，用普通变量名即可。
2. **改了环境变量要重新部署**：Vercel 不会自动生效，需要在 Deployments 里点 Redeploy。
3. **流式接口有超时限制**：两个接口都设置了 `export const maxDuration = 60`，免费版 Vercel 单函数上限是 60 秒。如果 AI 回复特别长被截断，说明要换更快的模型或缩短提示词。
4. **不要提交 `.env.local`**：仓库的 `.gitignore` 已忽略它，只提交 `.env.example`（不含真实值）。

## 本地复现线上构建

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```
