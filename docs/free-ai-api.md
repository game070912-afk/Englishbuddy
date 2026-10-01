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
