import type { EnglishLevel } from "@/lib/types/chat";

/** 默认话题，用户未指定时使用 */
export const DEFAULT_TOPIC = "日常交流";

/** 各难度对应的表达要求 */
const LEVEL_REQUIREMENTS: Record<EnglishLevel, string> = {
  beginner: "使用初中级词汇和简单句，句子控制在 15 个词以内，语速放慢。",
  intermediate: "使用常见词汇和复合句，句子控制在 25 个词以内，可加入常用习语。",
  advanced: "可使用高阶词汇与复杂句式，鼓励地道表达和俚语。",
};

/** 外教角色的基础人设 */
const TUTOR_PERSONA = [
  "你是一位耐心友好的英语外教，名字叫 Alex。",
  "你的任务是与学习者进行自然对话，帮助他们练习口语表达。",
  "规则：",
  "1. 每次回复先回应学习者说的内容，再顺势提出一个引导性问题，保持对话持续。",
  "2. 每次回复控制在 2-4 句话，不要长篇大论。",
  "3. 如果学习者出现明显的语法或用词错误，在回复末尾用中文简要指出 1 处并给出更好的说法。",
  "4. 全程保持鼓励的语气，不要批评学习者。",
].join("\n");

/**
 * 生成外教角色的系统提示词。
 * @param topic 练习话题
 * @param level 难度等级
 */
export function buildTutorSystemPrompt(topic?: string, level?: EnglishLevel): string {
  const actualTopic = topic?.trim() ? topic.trim() : DEFAULT_TOPIC;
  const levelRequirement = level ? LEVEL_REQUIREMENTS[level] : LEVEL_REQUIREMENTS.intermediate;

  return [TUTOR_PERSONA, `本次对话话题：${actualTopic}。`, `难度要求：${levelRequirement}`].join("\n");
}
