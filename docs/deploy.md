# 部署

前置条件：代码已推到 GitHub，且本地已跑通（`pnpm build` 通过）。

## 先选平台：这一步会影响国内能不能打开

| | **Zeabur（推荐）** | Vercel |
| --- | --- | --- |
| 国内直连 | ✅ `*.zeabur.app` 可正常打开 | ❌ `*.vercel.app` 打不开 |
| 成本 | 免费（每月 $5 额度） | 免费 |
| 运行时 | 原生 Node，无需改代码 | Node，无需改代码 |
| 冷启动 | 闲置会自动休眠，唤醒要几秒 | 快 |
| 区域 | 香港 / 新加坡 / 东京（免费档） | 全球（可指定） |

**为什么 Vercel 打不开（2026-10-04 实测，不挂代理）**：

| 目标 | 结果 |
| --- | --- |
| `englishbuddy-iota.vercel.app` | ❌ 连接失败 |
| Vercel 的三个 IP 逐个强连（含官方"国内专用" CNAME 解析出来的） | ❌ 全部连接失败 |
| 对照组：百度、GitHub | ✅ 正常打开 |

也就是说**被封的是 Vercel 的 IP 段，不是某个域名**。网上流传的「换国内专用 CNAME」「换备用 IP」现在都无效；
**买个域名绑到 Vercel 上也救不了**——别在这上面花钱。

> 结论：作品集要给国内的人看，就部署到 Zeabur。Vercel 可以作为海外镜像保留一份。

---

## 方案 A：部署到 Zeabur（推荐）

1. 打开 <https://zeabur.com>，用 GitHub 账号登录
2. 新建项目 → 选择区域时挑**香港**（离广州最近，延迟最低；免费档可选香港/新加坡/东京）
3. 选「从 GitHub 导入」，选中本仓库
4. Zeabur 会自动识别为 Next.js（仓库根目录有 `pnpm-lock.yaml`，它会用 pnpm 安装依赖）。
   如果识别有误，手动填：

   | 项 | 值 |
   | --- | --- |
   | Build Command | `pnpm build` |
   | Start Command | `pnpm start` |

5. 在 **Variables**（环境变量）里添加下面这张表，然后重新部署一次
6. 拿到 `*.zeabur.app` 域名后验证：`/` 首页、`/chat` 对话、`/correct` 批改

### 环境变量

| 名称 | 值 | 说明 |
| --- | --- | --- |
| `AI_API_KEY` | 你的智谱 Key | **必填**，没有它对话和批改都用不了 |
| `AI_PROVIDER` | `zhipu` | 选填，默认就是 zhipu |
| `AI_FALLBACK_BASE_URL` | `https://api.groq.com/openai/v1` | 选填，备用 AI |
| `AI_FALLBACK_API_KEY` | 你的 Groq Key | 选填，**配了它语音输入就能用** |
| `AI_FALLBACK_MODEL` | `openai/gpt-oss-20b` | 选填，备用 AI 的模型名 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目地址 | 选填，登录与历史记录 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | 选填，同上 |

还没有密钥？先看 [free-ai-api.md](./free-ai-api.md)：智谱 GLM-4.7-Flash **完全免费**，手机号注册 3 分钟搞定；
Groq 也是免费档。语音输入走 Groq 的 whisper-large-v3，**直接复用 `AI_FALLBACK_API_KEY`**，不用单独申请。

**三条 `AI_FALLBACK_*` 必须同时填写才会启用**，只填一部分会当作没配（不会发到错误地址）。
**Supabase 两条不填也能正常用**，只是不保存历史、不能登录。

### Zeabur 上要注意的坑

1. **免费档会自动休眠**：一段时间没人访问，服务就睡了，下一次打开要等几秒冷启动。
   作品集访问量不大完全够用，但演示前建议自己先打开一次把它唤醒。
2. **改完环境变量要重新部署**：和 Vercel 一样，改变量不会自动生效。
3. **出网流量算进 $5 额度**：本项目每次对话都要调 AI，正常演示用量远低于上限，
   但如果被脚本刷，额度会掉得快——`/api/chat` 目前只有很宽松的内存限流。
4. **从 Vercel 迁过来不用改代码**：项目没有任何 Vercel 专属依赖，
   唯一相关的是 `maxDuration = 60`（Vercel 的函数超时设置），在 Zeabur 上会被忽略，无害。

---

## 方案 B：部署到 Vercel（海外更快，但国内打不开）

适合作为海外镜像，或者你本来就有代理。

1. 打开 <https://vercel.com/new>，用 GitHub 账号登录，导入本仓库
2. Framework Preset 自动识别为 **Next.js**，构建命令 `pnpm build`
3. 在 **Environment Variables** 里添加上面那张表（内容完全一样）
4. 点 **Deploy**，1–2 分钟后拿到域名

### Vercel 上要注意的坑

1. **国内打不开**（见开头的实测），演示给别人看之前先确认对方网络环境。
2. **密钥不要加 `NEXT_PUBLIC_` 前缀**：带前缀会被打包进浏览器，等于公开泄露。
   唯一的例外是 Supabase 那两条——它的 key 设计上就会发给浏览器，安全靠 RLS 保证。
   **绝对不要填 `service_role` key**，那个会绕过 RLS，等于数据库裸奔。
3. **改了环境变量要 Redeploy**：Vercel 不会自动生效。
4. **流式接口有超时**：两个接口都设了 `export const maxDuration = 60`，免费版单函数上限 60 秒。

---

## 本地复现线上构建

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

## 不要提交 `.env.local`

仓库的 `.gitignore` 已忽略它，只提交 `.env.example`（不含真实值）。
换部署平台时，环境变量要在新平台上**重新填一遍**——它们不会跟着仓库走。
