export interface MultiLinguals {
  ja: string;
  en: string;
}

export interface AudioSources {
  en: string;
  ja: string;
}

export interface Beat {
  text: string; // 英語テキスト
  audioSources: AudioSources;
  multiLinguals: MultiLinguals;
  videoSource: string;
  thumbnail?: string; // サムネイル画像ファイル名
  speaker?: string; // オプション
  startTime?: number; // オプション
  endTime?: number; // オプション
  duration?: number; // オプション
}

export interface Output {
  totalDuration: number;
  totalSegments: number;
  beats: Beat[];
}

export interface Segment {
  start: number;
  end: number;
}
