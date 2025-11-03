import OpenAI from 'openai';
import { createReadStream } from 'fs';
import { Beat, BilingualText } from './types.js';

// OpenAIクライアントを遅延初期化
let openai: OpenAI;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error(
        'Missing OPENAI_API_KEY environment variable. Please create a .env file with your OpenAI API key.'
      );
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

export interface TranscriptionWithTimestamps {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Whisper APIで音声を文字起こし（タイムスタンプ付き）
 */
export async function transcribeAudio(
  audioPath: string
): Promise<string> {
  const client = getOpenAIClient();
  const transcription = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: 'whisper-1',
    language: 'ja',
  });

  return transcription.text;
}

/**
 * Whisper APIで音声を文字起こし（verbose_json形式でタイムスタンプ取得）
 */
export async function transcribeAudioWithTimestamps(
  audioPath: string
): Promise<TranscriptionWithTimestamps> {
  const client = getOpenAIClient();
  const transcription = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: 'whisper-1',
    language: 'ja',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  return {
    text: transcription.text,
    segments: (transcription as any).segments,
  };
}

export interface SpeakerSegment {
  speaker: string;
  text: string;
  startTime?: number;
  endTime?: number;
}

/**
 * GPT-4oを使って話者を識別
 * 会話のパターンや口調から話者を推定
 */
export async function identifySpeakers(
  transcriptionText: string
): Promise<SpeakerSegment[]> {
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an expert at analyzing conversation transcripts and identifying different speakers.
Parse the given Japanese conversation and separate it into individual utterances with speaker labels.
Return ONLY a valid JSON object with a "speakers" array containing objects with "speaker" and "text" fields.
Use speaker names like "話者A", "話者B", etc. for Japanese conversations.
If you cannot identify multiple speakers, return all text under one speaker.

Example format:
{
  "speakers": [
    {"speaker": "話者A", "text": "こんにちは"},
    {"speaker": "話者B", "text": "はい、こんにちは"}
  ]
}`,
        },
        {
          role: 'user',
          content: `Please analyze this conversation transcript and identify the different speakers:\n\n${transcriptionText}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content || '{"speakers":[]}');

    if (!result.speakers || result.speakers.length === 0) {
      return [{ speaker: '話者A', text: transcriptionText }];
    }

    return result.speakers;
  } catch (error) {
    console.warn('Failed to identify speakers:', error);
    return [{ speaker: '話者A', text: transcriptionText }];
  }
}

/**
 * タイムスタンプ付き文字起こしから主要な話者を推定
 */
export async function identifyMainSpeaker(
  transcription: TranscriptionWithTimestamps
): Promise<string> {
  const speakerSegments = await identifySpeakers(transcription.text);

  if (speakerSegments.length > 0) {
    return speakerSegments[0].speaker;
  }

  return '話者A';
}

/**
 * 日本語テキストを英語に翻訳
 */
export async function translateToEnglish(japaneseText: string): Promise<string> {
  try {
    const client = getOpenAIClient();
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a professional translator. Translate the given Japanese text to natural English. Only return the translated text, nothing else.',
        },
        {
          role: 'user',
          content: japaneseText,
        },
      ],
    });

    return completion.choices[0].message.content || japaneseText;
  } catch (error) {
    console.warn('Failed to translate to English:', error);
    return japaneseText; // フォールバック: 翻訳失敗時は元のテキストを返す
  }
}

/**
 * 音声を文字起こしして日英両方のテキストを返す
 */
export async function transcribeAudioBilingual(audioPath: string): Promise<BilingualText> {
  const japaneseText = await transcribeAudio(audioPath);
  console.log(`    🌐 Translating to English...`);
  const englishText = await translateToEnglish(japaneseText);

  return {
    ja: japaneseText,
    en: englishText,
  };
}
