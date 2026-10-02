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

## 2026-10-02（第一次：项目骨架 + 对话练习）

- 我下的指令：搭项目骨架，并让对话页真正联通 DeepSeek 流式输出（第一步范围选定为「骨架 + 真联通」）
- AI 产出：Next.js 16 脚手架；`lib/api/deepseek.ts` 流式客户端；`app/api/chat/route.ts` SSE 接口；`ChatPanel` 等组件；Vitest 用例（接口 5 个 + 工具函数 4 个）；README 与 API 文档
- 我做的决定：第一步不做登录与数据库；目录名按 npm 规范改为小写 `englishbuddy`；DeepSeek 作为首选模型（OpenAI 兼容接口）
- 待我确认：DeepSeek 密钥就绪后本地跑通 `/chat`；第二步是否上 Supabase Auth

## 2026-10-02（第二次：语法纠错功能）

- 我下的指令：你自己判断下一步做什么，我授权你决定
- AI 的判断：先做语法纠错，而不是 Supabase Auth。理由——Auth 需要注册账号、建项目、拿 Key，流程一卡就停摆；纠错复用已有流式架构，能立刻让作品集多一个可用功能
- AI 产出：`lib/types/correction.ts`、`lib/utils/correction.ts`（JSON Lines 解析与校验）、`app/api/correct/route.ts`（流式批改 + 解析失败自动重试一次）、`components/CorrectPanel.tsx`、`app/correct/page.tsx`；测试 11 个（接口 5 + 解析 6），累计 24 个全通过
- 我做的决定：纠错结果用 JSON Lines 流式输出（兼顾「边生成边看到」和结构化），而不是先憋完整 JSON 再返回；模型输出全无法解析时自动重试一次，仍失败给中文提示
- 待我确认：密钥填好后本地跑通 `/correct`；下一步是否上 Supabase Auth + 数据库

## 2026-10-02（第三次：开源与上线前置）

- 我下的指令：你决定（授权 AI 判断优先级）
- AI 的判断：先把开源与部署前置做完，而不是继续加功能。理由——已有 2 个可用功能，有个能分享的在线链接比再加一个功能更能证明项目是真的；且部署能提前暴露环境变量配置问题
- AI 产出：`LICENSE`（MIT）、`.github/workflows/ci.yml`（push/PR 自动跑 typecheck+test+lint+build）、`docs/deploy.md`（Vercel 步骤 + 4 个坑）、`docs/decisions/0001-...md`（ADR：为什么选 DeepSeek + SSE/JSON Lines）、两个接口加 `maxDuration = 60`（防 Vercel 流式超时）
- 我做的决定：待确认 ADR 0001 的结论是否认可（AI 已起草，等你签字或修改）
- 我需要亲自做的：① 在 Vercel 导入仓库并填 `DEEPSEEK_API_KEY` ② 把代码推到 GitHub（需先授权 GitHub 连接器或自己 git remote add）

## 2026-10-02（第四次：零成本 AI 方案 + 供应商可插拔）

- 我下的指令：DeepSeek 要花钱，教我不花钱怎么搞，要不你帮我搞一下
- AI 的判断：不换架构，只换供应商。理由——AI 调用本来就收在 `lib/api/` 一个文件里，换供应商是配置问题不是代码问题；智谱 GLM-4.7-Flash 官方标注免费、国内直连、OpenAI 兼容，是最省事的解
- AI 产出：`lib/api/ai.ts`（原 `deepseek.ts`，改为厂商中立 + `AI_PROVIDER` 预设机制）、`docs/free-ai-api.md`（注册到上线的完整步骤）、`docs/decisions/0002-...md`（ADR 记录这次选型）、新增 6 个配置解析测试（累计 30 个）、README/deploy 文档同步
- 顺手修的 bug：`.gitignore` 里 `.env*` 把模板文件 `.env.example` 也忽略了，仓库里根本没有配置模板，而 README 却写着 `cp .env.example .env.local`——加 `!.env.example` 例外并补交模板
- 我做的决定：默认供应商选免费方案（让克隆仓库的人零成本就能跑）；环境变量从 `DEEPSEEK_*` 迁到 `AI_*`，旧变量名保留兼容
- 我需要亲自做的：① 注册 <https://open.bigmodel.cn/> 拿免费密钥 ② 填进 `.env.local` 的 `AI_API_KEY` ③ Vercel 上加 `AI_PROVIDER=zhipu` + `AI_API_KEY` 后 Redeploy

## 2026-10-02~03（第五~八次：Supabase 账号体系 + 数据持久化）

- 我下的指令：接 Supabase，做登录和历史保存；中途两次改主意——先在任务栏建任务后又要求移到项目里，最后让我自己决定匿名能不能用
- AI 产出：`lib/supabase/`（配置/浏览器端/服务端客户端）、`proxy.ts`（Next 16 中间件改名，刷新登录态）、`/login` 与 `AuthForm`、`/history` 与 `POST /api/conversations`、`lib/api/usage-guard.ts`（匿名限流）
- 我做的决定：**匿名可试用但限量，不强制登录**。理由——招聘方点开链接撞登录墙会直接走人，这是确定的损失；被刷额度只是可能的风险。AI 先做成了强制登录，自己推翻改成了限流
- 踩过的坑（都记进项目笔记了）：
  1. `pnpm add` 在这台机器上必崩，改成手改 `package.json` + `pnpm install`
  2. 沙箱 safe-delete 挡安装，开关是 `CODEBUDDY_SAFE_DELETE_ENABLED=0`
  3. Next 16 中间件必须叫 `proxy.ts`，写 `middleware.ts` 会静默失效
  4. Supabase 关闭邮箱验证不追溯老账号；未验证账号登录时报"密码不对"（防用户枚举）
  5. 用户在找 Confirm email 时误关了 **Enable Signup**，导致之后所有注册被拒——靠"报错兜底显示原文"才定位到
- 我学到的一件事：**报错信息要能自证**。最后一条坑能定位，全靠之前把 Supabase 原文显示出来；否则我们还在猜密码对不对
