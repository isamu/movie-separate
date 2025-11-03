export interface BilingualText {
  ja: string;
  en: string;
}

export interface Beat {
  speaker: string;
  text: BilingualText;
  video: string;
  audio: string;
  startTime: number;
  endTime: number;
  duration: number;
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
