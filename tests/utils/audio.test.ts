import { describe, expect, it } from "vitest";

import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  SILENCE_RMS_THRESHOLD,
  TARGET_SAMPLE_RATE,
  base64ByteLength,
  computeRms,
  encodeWavPcm16,
  isBase64,
  isEffectivelySilent,
  toBase64,
} from "@/lib/utils/audio";

/** 读 WAV 头的便捷函数 */
function readWavHeader(buffer: ArrayBuffer): DataView {
  return new DataView(buffer);
}

/** 取 WAV 里的 PCM16 采样值 */
function readSample(buffer: ArrayBuffer, index: number): number {
  return new DataView(buffer).getInt16(44 + index * 2, true);
}

describe("encodeWavPcm16", () => {
  it("写出正确的 WAV 头：单声道 / 16bit / 指定采样率", () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const buffer = encodeWavPcm16(samples, 16000);
    const view = readWavHeader(buffer);

    // RIFF / WAVE 标识
    expect(String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))).toBe("RIFF");
    expect(String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11))).toBe("WAVE");

    expect(view.getUint16(22, true)).toBe(1); // 声道数
    expect(view.getUint32(24, true)).toBe(16000); // 采样率
    expect(view.getUint16(34, true)).toBe(16); // 位深
  });

  it("总长度等于 44 字节头 + 采样数 × 2", () => {
    const samples = new Float32Array(100);
    expect(encodeWavPcm16(samples, 16000).byteLength).toBe(44 + 200);
  });

  it("把浮点采样映射到 PCM16 的取值区间", () => {
    const samples = new Float32Array([0, 1, -1]);
    const buffer = encodeWavPcm16(samples, 16000);

    expect(readSample(buffer, 0)).toBe(0);
    expect(readSample(buffer, 1)).toBe(32767);
    expect(readSample(buffer, 2)).toBe(-32768);
  });

  it("超出 ±1 的采样会被截断，不会溢出", () => {
    const samples = new Float32Array([2, -2]);
    const buffer = encodeWavPcm16(samples, 16000);

    expect(readSample(buffer, 0)).toBe(32767);
    expect(readSample(buffer, 1)).toBe(-32768);
  });
});

describe("toBase64", () => {
  it("编码后能被 atob 原样还原", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const encoded = toBase64(bytes.buffer);
    const decoded = atob(encoded);

    expect(decoded.length).toBe(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      expect(decoded.charCodeAt(index)).toBe(bytes[index]);
    }
  });

  it("空输入得到空字符串", () => {
    expect(toBase64(new ArrayBuffer(0))).toBe("");
  });
});

describe("base64ByteLength", () => {
  it("按填充符正确换算字节数", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength("AAQC")).toBe(3);
    expect(base64ByteLength("AAA=")).toBe(2);
    expect(base64ByteLength("AA==")).toBe(1);
  });

  it("换算结果与 60 秒音频的上限一致", () => {
    // 60 秒 × 16000Hz × 2 字节
    expect(MAX_AUDIO_BYTES).toBe(16000 * 2 * MAX_AUDIO_SECONDS);
    expect(TARGET_SAMPLE_RATE).toBe(16000);
  });
});

describe("isBase64", () => {
  it("只接受 base64 字符与填充符", () => {
    expect(isBase64("AAQC")).toBe(true);
    expect(isBase64("AAA=")).toBe(true);
    expect(isBase64("hello world!")).toBe(false);
    expect(isBase64("abc@123")).toBe(false);
  });
});

/** 造一段正弦波，模拟一段声音 */
function makeSine(amplitude: number, length = 1000): Float32Array {
  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    samples[index] = amplitude * Math.sin((index / length) * Math.PI * 20);
  }
  return samples;
}

describe("computeRms", () => {
  it("空音频的能量是 0", () => {
    expect(computeRms(new Float32Array(0))).toBe(0);
  });

  it("全零音频的能量是 0", () => {
    expect(computeRms(new Float32Array(1000))).toBe(0);
  });

  it("恒定幅度 a 的正弦波，能量约为 a/√2", () => {
    const rms = computeRms(makeSine(0.2));
    expect(rms).toBeCloseTo(0.2 / Math.SQRT2, 2);
  });

  it("幅度越大能量越高，可以用来区分说话和安静", () => {
    expect(computeRms(makeSine(0.1))).toBeGreaterThan(computeRms(makeSine(0.001)));
  });
});

describe("isEffectivelySilent", () => {
  it("纯静音会被判定为没声音", () => {
    expect(isEffectivelySilent(new Float32Array(1000))).toBe(true);
  });

  it("幅度极小的底噪也算没声音", () => {
    expect(isEffectivelySilent(makeSine(0.001))).toBe(true);
  });

  it("正常说话的音量不算静音", () => {
    expect(isEffectivelySilent(makeSine(0.1))).toBe(false);
  });

  it("阈值本身是 -40dB 量级，正常说话远高于它", () => {
    // 0.01 ≈ -40dB；正常说话的 RMS 通常在这个值的 5 倍以上
    expect(SILENCE_RMS_THRESHOLD).toBe(0.01);
    expect(computeRms(makeSine(0.1))).toBeGreaterThan(SILENCE_RMS_THRESHOLD * 5);
  });
});
