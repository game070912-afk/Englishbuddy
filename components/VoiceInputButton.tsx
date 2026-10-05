"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactElement,
} from "react";

import { requestTranscription } from "@/lib/api/transcribe-client";
import { audioBufferToWav16k, decodeAudioBlob, isEffectivelySilent, toBase64 } from "@/lib/utils/audio";

/**
 * 自动停止录音的时长。
 * 百度短语音上限 60 秒，这里留 5 秒余量，避免踩着边界被拒。
 */
const MAX_RECORD_MS = 55 * 1000;

/** 短于这个时长认为是误触，给提示而不是当作一次识别 */
const MIN_RECORD_MS = 400;

type VoiceStatus = "idle" | "recording" | "transcribing";

interface VoiceInputButtonProps {
  /** 识别成功后回填文字 */
  onTranscribed: (text: string) => void;
  /** 出错时的中文提示，交给页面已有的错误条展示 */
  onError?: (message: string) => void;
  /** 忙碌时禁用 */
  disabled?: boolean;
}

/**
 * 能力探测：服务端一律当作不支持，客户端挂载后再给出真实结果。
 *
 * 用 `useSyncExternalStore` 而不是「useEffect 里 setState」，是因为后者会触发
 * 级联渲染（ESLint 直接报错），而前者本来就是为「服务端快照 vs 客户端快照」
 * 这种场景设计的，也不会造成 hydration 不一致。
 */
function detectRecordingSupport(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return (
    Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== "undefined"
  );
}

/** 录音能力在运行期间不会变化，所以订阅函数什么都不用做 */
function subscribeToNothing(): () => void {
  return () => {};
}

/** 服务端渲染时的快照 */
function getServerSupport(): boolean {
  return false;
}

/** 麦克风图标：不为一个图标引入图标库，省掉一个依赖 */
function MicIcon({ active }: { active: boolean }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <path d="M12 19v3" />
      {active ? <path d="M8 22h8" /> : null}
    </svg>
  );
}

/**
 * 语音输入按钮：按住说话，松手转文字。
 *
 * 两条硬性要求：
 * 1. 不支持录音的环境直接不出现（优雅降级，打字体验不受影响）
 * 2. 出错只给中文提示且回填不成功也不阻塞打字
 */
export default function VoiceInputButton({
  onTranscribed,
  onError,
  disabled = false,
}: VoiceInputButtonProps) {
  const canRecord = useSyncExternalStore(
    subscribeToNothing,
    detectRecordingSupport,
    getServerSupport,
  );
  const [status, setStatus] = useState<VoiceStatus>("idle");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef(0);
  /** 录音还没真正开始用户就松了手（比如卡在授权弹窗）——补一次停止 */
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 录音结束后：转码 → 上传 → 回填 */
  const handleFinished = useCallback(
    async (chunks: Blob[]): Promise<void> => {
      if (chunks.length === 0 || Date.now() - startedAtRef.current < MIN_RECORD_MS) {
        setStatus("idle");
        onError?.("按住麦克风说一句再松手");
        return;
      }

      setStatus("transcribing");

      try {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        const decoded = await decodeAudioBlob(blob);

        // 先量一下音量：Whisper 听到近乎静音的音频不会说「没听清」，
        // 而是会凭空脑补一句话。本地拦掉既省一次请求，也不会让用户看到莫名其妙的文字。
        // 麦克风录音基本都是单声道，取第一个声道就够。
        if (isEffectivelySilent(decoded.getChannelData(0))) {
          onError?.("没听到声音，靠近麦克风再说一次");
          return;
        }

        const wav = await audioBufferToWav16k(decoded);
        const text = await requestTranscription(toBase64(wav));
        onTranscribed(text);
      } catch (error) {
        onError?.(error instanceof Error ? error.message : "语音识别失败了，请再试一次");
      } finally {
        setStatus("idle");
      }
    },
    [onError, onTranscribed],
  );

  const stopRecording = useCallback((): void => {
    clearTimer();
    stopRequestedRef.current = true;

    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, [clearTimer]);

  const startRecording = useCallback(async (): Promise<void> => {
    if (disabled || status !== "idle") {
      return;
    }

    stopRequestedRef.current = false;
    onError?.("");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.("麦克风没打开，去浏览器设置里允许一下吧");
      return;
    }

    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream);

    recorder.ondataavailable = (event: BlobEvent): void => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onstop = (): void => {
      // 用完立刻关掉麦克风，别让浏览器一直亮着录音中的红点
      for (const track of stream.getTracks()) {
        track.stop();
      }
      void handleFinished(chunks);
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setStatus("recording");

    // 授权弹窗期间用户可能已经松手了，这里补一次停止
    if (stopRequestedRef.current) {
      recorder.stop();
      return;
    }

    timerRef.current = setTimeout(() => {
      stopRecording();
    }, MAX_RECORD_MS);
  }, [disabled, handleFinished, onError, status, stopRecording]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      void startRecording();
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === " " || event.key === "Enter") {
      stopRecording();
    }
  }

  if (!canRecord) {
    return null;
  }

  const isRecording = status === "recording";
  const isTranscribing = status === "transcribing";
  const isDisabled = disabled || isTranscribing;

  return (
    <button
      type="button"
      onPointerDown={() => void startRecording()}
      onPointerUp={stopRecording}
      onPointerLeave={stopRecording}
      onPointerCancel={stopRecording}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      disabled={isDisabled}
      aria-label={isRecording ? "松手结束录音" : "按住说话"}
      title="按住说话，松手转成文字"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition ${
        isRecording
          ? "border-red-500 bg-red-500 text-white"
          : "border-slate-300 text-slate-600 hover:border-indigo-500 hover:text-indigo-600"
      } ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      {isTranscribing ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-500" />
      ) : (
        <MicIcon active={isRecording} />
      )}
    </button>
  );
}
