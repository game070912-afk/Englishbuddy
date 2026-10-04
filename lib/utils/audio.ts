/**
 * 录音格式处理。
 *
 * 浏览器 `MediaRecorder` 默认产出 webm/opus（Chrome）或 mp4/aac（Safari），
 * 而百度短语音识别只收 pcm/wav/amr/m4a，且要求 16kHz、16bit、单声道、≤60 秒。
 * 两边对不上，所以必须在**客户端**转一道：
 *
 *   Blob → decodeAudioData → 重采样到 16kHz 单声道 → 编码成 WAV(PCM16)
 *
 * 放在客户端而不是服务端，是因为服务端转码要么依赖二进制工具（Serverless 上麻烦），
 * 要么多一次函数耗时；而浏览器自带的 Web Audio 天然能做这件事。
 */

/** 百度短语音识别要求的采样率 */
export const TARGET_SAMPLE_RATE = 16000;

/** WAV(PCM16) 每个采样点占 2 字节 */
const BYTES_PER_SAMPLE = 2;

/** 百度短语音识别的时长上限（秒） */
export const MAX_AUDIO_SECONDS = 60;

/** 按上限换算出的音频字节数上限，服务端据此拒绝过长音频 */
export const MAX_AUDIO_BYTES = TARGET_SAMPLE_RATE * BYTES_PER_SAMPLE * MAX_AUDIO_SECONDS;

/** base64 合法字符（含填充） */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** 分块大小：字符串拼接时避免一次性展开过多参数 */
const CHUNK_SIZE = 0x8000;

/** 往 DataView 的指定位置写入 ASCII 字符串 */
function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/**
 * 把 [-1, 1] 区间的浮点采样编码成 WAV(PCM16) 单声道。
 * 纯函数、不依赖 DOM，因此可以直接写单元测试。
 */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk 长度
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true); // 字节率
  view.setUint16(32, BYTES_PER_SAMPLE, true); // 块对齐
  view.setUint16(34, 16, true); // 位深

  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    // 负半轴到 -32768、正半轴到 32767，避免 +1 时溢出
    view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true);
    offset += BYTES_PER_SAMPLE;
  }

  return buffer;
}

/**
 * 用 `OfflineAudioContext` 把解码后的音频重采样成 16kHz 单声道。
 * 借浏览器自己的重采样器，比手写线性插值更稳、音质也更好。
 */
export async function resampleTo16kMono(decoded: AudioBuffer): Promise<Float32Array> {
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);

  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();

  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** 把 `MediaRecorder` 产出的音频 Blob 转成百度可收的 WAV(16kHz/16bit/单声道) */
export async function blobToWav16k(blob: Blob): Promise<ArrayBuffer> {
  const raw = await blob.arrayBuffer();
  const context = new AudioContext();

  try {
    const decoded = await context.decodeAudioData(raw);
    const samples = await resampleTo16kMono(decoded);
    return encodeWavPcm16(samples, TARGET_SAMPLE_RATE);
  } finally {
    // 录音上下文用完就关，否则浏览器会一直占着音频设备
    void context.close();
  }
}

/** 把二进制转成 base64，方便塞进 JSON 请求体 */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
  }

  return btoa(binary);
}

/** 判断字符串是否是合法 base64（允许空串，由调用方决定是否必填） */
export function isBase64(value: string): boolean {
  return BASE64_PATTERN.test(value);
}

/**
 * 由 base64 字符串反推原始字节数，省去一次解码。
 * 用来在真正发请求之前就挡掉超长的录音。
 */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}
