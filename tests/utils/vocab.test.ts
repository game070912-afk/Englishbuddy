import { describe, expect, it } from "vitest";

import { parseVocabDraft } from "@/lib/utils/vocab";

describe("parseVocabDraft", () => {
  it("解析标准 JSON 卡片", () => {
    const card = parseVocabDraft(
      '{"word":"negotiate","phonetic":"/nɪˈɡəʊʃieɪt/","definition":"谈判，协商","example_sentence":"We need to negotiate the price.","context":""}',
    );

    expect(card?.word).toBe("negotiate");
    expect(card?.definition).toBe("谈判，协商");
    expect(card?.example_sentence).toBe("We need to negotiate the price.");
    expect(card?.context).toBeNull();
  });

  it("模型用 markdown 代码块包住时也能解析", () => {
    const card = parseVocabDraft('```json\n{"word":"abandon","definition":"放弃"}\n```');

    expect(card?.word).toBe("abandon");
    expect(card?.definition).toBe("放弃");
  });

  it("前后有多余说明文字时截出 JSON 部分", () => {
    const card = parseVocabDraft('好的，这是卡片：\n{"word":"brave","definition":"勇敢的"}\n希望对你有帮助');

    expect(card?.word).toBe("brave");
  });

  it("缺少 word 字段时判定为无效", () => {
    expect(parseVocabDraft('{"definition":"没有单词"}')).toBeNull();
  });

  it("不是 JSON 时判定为无效", () => {
    expect(parseVocabDraft("抱歉，我无法回答这个问题")).toBeNull();
  });

  it("字段类型不对时降级为 null 而不是崩掉", () => {
    const card = parseVocabDraft('{"word":"test","phonetic":123,"definition":null}');

    expect(card?.word).toBe("test");
    expect(card?.phonetic).toBeNull();
    expect(card?.definition).toBeNull();
  });

  it("超长字段按上限截断", () => {
    const card = parseVocabDraft(`{"word":"${"a".repeat(200)}","definition":"${"释".repeat(500)}"}`);

    expect(card?.word.length).toBe(60);
    expect(card?.definition?.length).toBe(200);
  });

  it("兼容模型把例句写成 example 的情况", () => {
    const card = parseVocabDraft('{"word":"focus","example":"Stay focused."}');

    expect(card?.example_sentence).toBe("Stay focused.");
  });
});
