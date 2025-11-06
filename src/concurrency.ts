/**
 * 並列処理制御ユーティリティ
 * p-limitを使用してAPI呼び出しを制限する
 */
import pLimit from 'p-limit';

/**
 * API並列実行数の設定
 */
export interface ConcurrencyConfig {
  whisper: number;
  translation: number;
  tts: number;
  speakerId: number;
}

/**
 * 環境変数から並列実行数の設定を取得
 */
export function getConcurrencyConfig(): ConcurrencyConfig {
  return {
    whisper: parseInt(process.env.WHISPER_CONCURRENCY || '3', 10),
    translation: parseInt(process.env.TRANSLATION_CONCURRENCY || '10', 10),
    tts: parseInt(process.env.TTS_CONCURRENCY || '3', 10),
    speakerId: parseInt(process.env.SPEAKER_ID_CONCURRENCY || '10', 10),
  };
}

/**
 * API呼び出し用のリミッター
 */
export interface ApiLimiters {
  whisper: ReturnType<typeof pLimit>;
  translation: ReturnType<typeof pLimit>;
  tts: ReturnType<typeof pLimit>;
  speakerId: ReturnType<typeof pLimit>;
}

/**
 * API呼び出し用のリミッターを作成
 */
export function createApiLimiters(config: ConcurrencyConfig): ApiLimiters {
  return {
    whisper: pLimit(config.whisper),
    translation: pLimit(config.translation),
    tts: pLimit(config.tts),
    speakerId: pLimit(config.speakerId),
  };
}
