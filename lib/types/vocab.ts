/** 生词卡片：字段与数据库 vocab_cards 表一一对应 */

export interface VocabCard {
  id: string;
  word: string;
  /** 音标，如 /ˈkʌmfət/ */
  phonetic: string | null;
  /** 中文释义 */
  definition: string | null;
  /** 英文例句 */
  example_sentence: string | null;
  /** 遇到这个词的上下文，可为空 */
  context: string | null;
  created_at: string | null;
}

/** AI 生成的卡片草稿，还没有落库所以没有 id */
export interface VocabDraft {
  word: string;
  phonetic: string | null;
  definition: string | null;
  example_sentence: string | null;
  context: string | null;
}

/** POST /api/vocab 的请求体 */
export interface VocabRequestBody {
  /** 要查询的单词或短语 */
  word: string;
  /** 遇到这个词的原句，带上它能让释义更贴合语境 */
  context?: string;
  /** 是否顺手存进生词本；只有登录用户才能存 */
  save?: boolean;
  /**
   * 已经生成好的卡片。
   * 「生成」和「收藏」在界面上是两步，但收藏不该再让 AI 算一遍——
   * 带上它就能直接入库，省一次调用也省几秒等待。
   */
  card?: VocabDraft;
}

/** POST /api/vocab 的响应体 */
export interface VocabResponse {
  card: VocabDraft;
  /** 是否已存入生词本 */
  saved: boolean;
  /** 生词本里已经有这个词了，这次没有重复插入 */
  duplicated: boolean;
}

/** GET /api/vocab 的响应体 */
export interface VocabListResponse {
  cards: VocabCard[];
}

/** 生词相关接口的统一错误响应 */
export interface VocabErrorResponse {
  error: { message: string; code: string };
}
