import OpenAI from 'openai';
import { createReadStream } from 'fs';
import { Beat, MultiLinguals } from './types.js';

// OpenAIクライアントを遅延初期化
let openai: OpenAI;

export function getOpenAIClient(): OpenAI {
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
 * Whisper APIで音声を文字起こし
 * @param audioPath 音声ファイルのパス
 * @param language 音声の言語 ('en' | 'ja')
 */
export async function transcribeAudio(
  audioPath: string,
  language: string = 'en'
): Promise<string> {
  const client = getOpenAIClient();
  const transcription = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: 'whisper-1',
    language: language,
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
 * テキストを翻訳
 * @param text 翻訳元テキスト
 * @param fromLang 翻訳元言語
 * @param toLang 翻訳先言語
 */
export async function translateText(
  text: string,
  fromLang: string,
  toLang: string
): Promise<string> {
  try {
    const client = getOpenAIClient();
    const langNames = { en: 'English', ja: 'Japanese' };
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a professional translator. Translate the given ${langNames[fromLang as keyof typeof langNames]} text to natural ${langNames[toLang as keyof typeof langNames]}. Only return the translated text, nothing else.`,
        },
        {
          role: 'user',
          content: text,
        },
      ],
    });

    return completion.choices[0].message.content || text;
  } catch (error) {
    console.warn(`Failed to translate from ${fromLang} to ${toLang}:`, error);
    return text;
  }
}

/**
 * 音声を文字起こしして日英両方のテキストを返す
 * @param audioPath 音声ファイルのパス
 * @param sourceLang 音声の元言語 ('en' | 'ja')
 * @param translationCache 翻訳キャッシュ（元言語 -> 翻訳先言語）
 */
export async function transcribeAudioBilingual(
  audioPath: string,
  sourceLang: string = 'en',
  translationCache?: Map<string, string>
): Promise<MultiLinguals> {
  const sourceText = await transcribeAudio(audioPath, sourceLang);
  const targetLang = sourceLang === 'en' ? 'ja' : 'en';

  const getCachedTranslation = () => {
    console.log(`    ♻️  Using cached translation`);
    return translationCache!.get(sourceText)!;
  };

  const getNewTranslation = async () => {
    console.log(`    🌐 Translating from ${sourceLang} to ${targetLang}...`);
    return await translateText(sourceText, sourceLang, targetLang);
  };

  const translatedText = translationCache?.has(sourceText)
    ? getCachedTranslation()
    : await getNewTranslation();

  return sourceLang === 'en'
    ? { en: sourceText, ja: translatedText }
    : { ja: sourceText, en: translatedText };
}

/**
 * テキストから音声を生成（TTS）
 */
export async function textToSpeech(
  text: string,
  outputPath: string,
  language: 'ja' | 'en' = 'ja'
): Promise<void> {
  try {
    const client = getOpenAIClient();

    // 言語に応じて音声を選択
    const voice = language === 'ja' ? 'alloy' : 'alloy'; // OpenAI TTSは多言語対応

    const mp3 = await client.audio.speech.create({
      model: 'tts-1',
      voice: voice,
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, buffer);

    console.log(`    🔊 Generated ${language.toUpperCase()} audio: ${outputPath}`);
  } catch (error) {
    console.warn(`Failed to generate TTS for ${language}:`, error);
    throw error;
  }
}
