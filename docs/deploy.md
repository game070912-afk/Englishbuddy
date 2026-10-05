# 部署

前置条件：代码已推到 GitHub，且本地已跑通（`pnpm build` 通过）。

## 先选平台：这一步会影响国内能不能打开

| | **EdgeOne Pages（推荐）** | Vercel |
| --- | --- | --- |
| 国内直连 | ✅ 腾讯云边缘节点，`*.edgeone.app` 可打开 | ❌ `*.vercel.app` 打不开 |
| 成本 | 免费（长期免费套餐） | 免费 |
| Next.js | 零配置支持 SSR / ISR，有 Node Functions | 原生支持 |
| 冷启动 | Serverless，按调用量 | 快 |
| 节点 | 全球 3200+，亚洲 2500+ | 全球（可指定） |

**为什么 Vercel 打不开（2026-10-04 实测，不挂代理）**：

| 目标 | 结果 |
| --- | --- |
| `englishbuddy-iota.vercel.app` | ❌ 连接失败 |
| Vercel 的三个 IP 逐个强连（含官方"国内专用" CNAME 解析出来的） | ❌ 全部连接失败 |
| 对照组：百度、GitHub | ✅ 正常打开 |

也就是说**被封的是 Vercel 的 IP 段，不是某个域名**。网上流传的「换国内专用 CNAME」「换备用 IP」现在都无效；
**买个域名绑到 Vercel 上也救不了**——别在这上面花钱。

> 结论：作品集要给国内的人看，就部署到 **EdgeOne Pages**。Vercel 可以作为海外镜像保留一份。
>
> 踩过的坑（2026-10-06）：原本推荐过 Zeabur，但它的**共享集群已在 2026 年停止服务**，
> 新项目只能「买 Zeabur 的服务器」或「注册自己的服务器」，零成本路线不存在了。
> 官方文档原话：*New projects can no longer be created on shared clusters... All new projects should use Servers.*
> ——**平台免费政策会变，动手前先去官方文档核实，别信二手评测。**

---

## 方案 A：部署到 EdgeOne Pages（推荐）

EdgeOne Pages 是腾讯云的全栈部署平台，**零配置支持 Next.js 的 SSR / ISR**，
并且有 Node Functions（支持 Node.js 生态），所以项目里用到的 `Buffer` 等 Node API 都能正常跑。

1. 打开 EdgeOne 控制台注册/登录：**用微信扫码或腾讯云账号登录**
   （不是 GitHub 登录——GitHub 是第 3 步导入仓库时才授权的）。
   第一次用腾讯云需要完成实名认证
2. 进入控制台后，点 **「导入 Git 仓库」**
3. 选 **GitHub** 图标 → 跳到 GitHub 授权页 → 建议选「Only select repositories」
   只勾 `Englishbuddy`（最小权限），然后 Install
4. 配置构建：框架预设选 **Next.js**，平台会自动填好大部分配置，
   照着核对一遍即可：

   | 项 | 值 |
   | --- | --- |
   | 根目录 | `./` |
   | Build Command | `pnpm build` |
   | Output Directory | `.next` |
   | Node 版本 | 默认（通常 22，本地不一致时再改） |

5. **加速区域**：选**中国大陆**（节点在国内，访问最快）。
   用平台送的免费域名不需要备案——只有以后绑定自己的域名才涉及备案
6. 点「开始部署」，完成后在环境变量里添加下面这张表，**再重新部署一次**
7. 拿到 `*.edgeone.app` 域名后验证：`/` 首页、`/chat` 对话、`/correct` 批改

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

### EdgeOne Pages 上要注意的坑

1. **函数单次执行有时间上限（通常 30 秒）**：本项目 `app/api/chat` 与 `app/api/correct`
   里写的 `maxDuration = 60` 是 Vercel 专属设置，在 EdgeOne 上不生效。
   AI 流式回复一般几秒就出首字、十几秒结束，正常够用；但如果碰到特别长的回复被截断，
   就是撞到这个上限了。
2. **没有本地文件系统**：不能往磁盘写文件。本项目不受影响——音频只在内存里转发，
   数据都存在 Supabase。
3. **改完环境变量要重新部署**：改变量不会自动生效。
4. **免费套餐**：不限量的加速流量与请求额度，函数调用 / KV / 构建次数每月有定额；
   具体剩余额度在控制台首页的「用量概览」里看。
5. **从 Vercel 迁过来不用改代码**：项目没有任何 Vercel 专属依赖。

### 还没验证过的（部署后要实测）

- Next 16 的 `proxy.ts` 中间件在 EdgeOne 上是否生效（它负责登录态相关逻辑）
- 流式 SSE 响应在边缘节点上有没有被缓冲（影响 AI 回复是不是一个字一个字地吐）

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
