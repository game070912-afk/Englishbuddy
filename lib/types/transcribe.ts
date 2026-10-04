/** 语音转写相关类型（客户端与服务端共享） */

/**
 * POST /api/transcribe 的请求体。
 * audio 是 16kHz / 16bit / 单声道 WAV 的 base64 字符串。
 */
export interface TranscribeRequestBody {
  audio: string;
}

/** 转写成功响应 */
export interface TranscribeResponse {
  text: string;
}

/** 转写失败响应，与项目其它接口保持同一形状 */
export interface TranscribeErrorResponse {
  error: {
    message: string;
    code: string;
  };
}
