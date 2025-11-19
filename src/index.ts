import dotenv from 'dotenv';
import path from 'path';
import { promises as fs } from 'fs';
import {
  ensureOutputDir,
  extractAudioFromVideo,
  splitVideo,
  splitAudio,
  getVideoDuration,
  generateThumbnail,
} from './ffmpeg-utils.js';
import { segmentVideo } from './segmentation.js';
import { transcribeAudioBilingual, identifySpeakers, textToSpeech } from './transcription.js';
import { evaluateSegments } from './evaluation.js';
import { Beat, Output, MultiLinguals } from './types.js';
import { parseArgs } from './cli.js';
import { getConcurrencyConfig, createApiLimiters } from './concurrency.js';

dotenv.config();

const CONCURRENCY = getConcurrencyConfig();
const API_LIMITERS = createApiLimiters(CONCURRENCY);

const OUTPUT_DIR = 'output';

// コマンドライン引数をパース
const cliOptions = parseArgs(process.argv);
const INPUT_VIDEO = cliOptions.input;
const DEFAULT_LANG = cliOptions.lang;
const TEST_MODE = cliOptions.test;
const TEST_DURATION = cliOptions.testDuration;

function populateCacheMaps(
  beats: Beat[],
  translationMap: Map<string, string>,
  beatMap: Map<string, Beat>
) {
  beats.forEach((beat) => {
    if (beat.multiLinguals?.ja && beat.multiLinguals?.en) {
      translationMap.set(beat.multiLinguals.ja, beat.multiLinguals.en);
    }
    if (beat.videoSource) {
      beatMap.set(beat.videoSource, beat);
    }
  });
}

async function loadExistingCache(outputPath: string) {
  const existingTranslations = new Map<string, string>();
  const existingBeatsCache = new Map<string, Beat>();

  try {
    const existingData = await fs.readFile(outputPath, 'utf-8');
    const existingOutput: Output = JSON.parse(existingData);
    populateCacheMaps(existingOutput.beats, existingTranslations, existingBeatsCache);

    if (existingBeatsCache.size > 0) {
      console.log(`♻️  Loaded ${existingBeatsCache.size} existing segments from cache`);
      console.log(`   - ${existingTranslations.size} translations`);
    }
  } catch {
    console.log('📝 No existing cache found, starting fresh');
  }

  return { existingTranslations, existingBeatsCache };
}

async function generateVideoAndThumbnail(
  videoOutput: string,
  thumbnailOutput: string,
  inputVideo: string,
  start: number,
  duration: number
) {
  try {
    await fs.access(videoOutput);
    await fs.access(thumbnailOutput);
    console.log(`  ♻️  Video and thumbnail already exist, skipping generation`);
    return false;
  } catch {
    console.log(`  📹 Splitting video...`);
    await splitVideo(inputVideo, videoOutput, start, duration);
    console.log(`  🖼️  Generating thumbnail...`);
    await generateThumbnail(videoOutput, thumbnailOutput, 0);
    return true;
  }
}

async function extractAudioIfNeeded(
  audioOutput: string,
  inputVideo: string,
  start: number,
  duration: number
) {
  try {
    await fs.access(audioOutput);
    console.log(`  ♻️  Audio file already exists, skipping extraction`);
    return false;
  } catch {
    console.log(`  🎵 Extracting audio...`);
    await splitAudio(inputVideo, audioOutput, start, duration);
    return true;
  }
}

async function getTranscriptionAndTranslation(
  cachedBeat: Beat | undefined,
  audioOutput: string,
  existingTranslations: Map<string, string>,
  sourceLang: string
): Promise<MultiLinguals> {
  if (cachedBeat?.multiLinguals?.ja && cachedBeat?.multiLinguals?.en) {
    console.log(`  ♻️  Transcription and translation cached, skipping Whisper & Translation API`);
    return cachedBeat.multiLinguals;
  }

  console.log(`  📝 Transcribing audio (${sourceLang})...`);
  const multiLinguals = await transcribeAudioBilingual(audioOutput, sourceLang, existingTranslations);
  const targetLang = sourceLang === 'en' ? 'ja' : 'en';
  console.log(`  ✅ Transcription (${sourceLang.toUpperCase()}): ${multiLinguals[sourceLang as 'en' | 'ja'].substring(0, 80)}...`);
  console.log(`  ✅ Translation (${targetLang.toUpperCase()}): ${multiLinguals[targetLang as 'en' | 'ja'].substring(0, 80)}...`);
  return multiLinguals;
}

async function identifySpeaker(
  cachedBeat: Beat | undefined,
  multiLinguals: MultiLinguals
): Promise<string> {
  if (cachedBeat?.speaker) {
    console.log(`  ♻️  Speaker identification cached, skipping GPT-4o API`);
    return cachedBeat.speaker;
  }

  console.log(`  👥 Identifying speakers...`);
  const speakerSegments = await identifySpeakers(multiLinguals.ja);
  return speakerSegments.length > 0 ? speakerSegments[0].speaker : 'Unknown Speaker';
}

async function generateJapaneseTTS(jaAudioOutput: string, text: string) {
  try {
    await fs.access(jaAudioOutput);
    console.log(`  ♻️  Japanese TTS audio already exists, skipping TTS API`);
    return false;
  } catch {
    console.log(`  🎤 Generating Japanese TTS audio...`);
    await textToSpeech(text, jaAudioOutput, 'ja');
    return true;
  }
}

function displayEvaluationStats(beats: Beat[]) {
  const highImportance = beats.filter(b => (b.importance || 0) >= 7).length;
  const mediumImportance = beats.filter(b => (b.importance || 0) >= 4 && (b.importance || 0) < 7).length;
  const lowImportance = beats.filter(b => (b.importance || 0) < 4).length;

  console.log(`\n📈 Importance Distribution:`);
  console.log(`   High (7-10): ${highImportance} segments`);
  console.log(`   Medium (4-6): ${mediumImportance} segments`);
  console.log(`   Low (0-3): ${lowImportance} segments`);
}

function createBeatFromSegment(
  segmentNum: number,
  segment: { start: number; end: number },
  multiLinguals: MultiLinguals,
  mainSpeaker: string
): Beat {
  const duration = segment.end - segment.start;
  return {
    text: multiLinguals.en,
    audioSources: { en: `${segmentNum}.mp3`, ja: `${segmentNum}_ja.mp3` },
    multiLinguals: multiLinguals,
    videoSource: `${segmentNum}.mp4`,
    thumbnail: `${segmentNum}.jpg`,
    speaker: mainSpeaker,
    startTime: segment.start,
    endTime: segment.end,
    duration: duration,
  };
}

interface SegmentProcessingContext {
  segment: { start: number; end: number };
  segmentNum: number;
  totalSegments: number;
  videoOutputDir: string;
  existingBeatsCache: Map<string, Beat>;
  existingTranslations: Map<string, string>;
  sourceLang: string;
}

async function processSegmentPhase1(ctx: SegmentProcessingContext): Promise<Beat> {
  const { segment, segmentNum, totalSegments, videoOutputDir, existingBeatsCache, existingTranslations, sourceLang } = ctx;
  const duration = segment.end - segment.start;
  console.log(`\n🎞️  Processing segment ${segmentNum}/${totalSegments} (${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s, duration: ${duration.toFixed(1)}s)...`);

  const videoOutput = path.join(videoOutputDir, `${segmentNum}.mp4`);
  const audioOutput = path.join(videoOutputDir, `${segmentNum}.mp3`);
  const thumbnailOutput = path.join(videoOutputDir, `${segmentNum}.jpg`);
  const cachedBeat = existingBeatsCache.get(`${segmentNum}.mp4`);

  await generateVideoAndThumbnail(videoOutput, thumbnailOutput, INPUT_VIDEO, segment.start, duration);
  await extractAudioIfNeeded(audioOutput, INPUT_VIDEO, segment.start, duration);
  const multiLinguals = await getTranscriptionAndTranslation(cachedBeat, audioOutput, existingTranslations, sourceLang);
  const mainSpeaker = await identifySpeaker(cachedBeat, multiLinguals);
  return createBeatFromSegment(segmentNum, segment, multiLinguals, mainSpeaker);
}

async function saveProgress(
  outputPath: string,
  beats: Beat[],
  processDuration: number,
  totalSegments: number
) {
  const output: Output = {
    lang: DEFAULT_LANG,
    totalDuration: processDuration,
    totalSegments: totalSegments,
    beats: beats,
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`  💾 Saved progress to ${path.basename(outputPath)}`);
}

async function main() {
  console.log('🎬 Starting video processing...');
  console.log(`📹 Input video: ${INPUT_VIDEO}`);
  console.log(`🌐 Default language: ${DEFAULT_LANG}`);

  if (TEST_MODE) {
    console.log('🧪 TEST MODE: Processing first 5 minutes only');
  }

  // 入力動画ファイル名から拡張子を除いたベース名を取得
  const videoBaseName = path.basename(INPUT_VIDEO, path.extname(INPUT_VIDEO));

  // 出力ディレクトリを動画名に基づいて作成 (例: output/ai/)
  const videoOutputDir = path.join(OUTPUT_DIR, videoBaseName);
  await ensureOutputDir(videoOutputDir);
  console.log(`📁 Output directory: ${videoOutputDir}`);

  // 既存のデータをロード（存在する場合）
  const outputPath = path.join(videoOutputDir, 'mulmo_view.json');
  const { existingTranslations, existingBeatsCache } = await loadExistingCache(outputPath);

  // 動画の全体の長さを取得
  const totalDuration = await getVideoDuration(INPUT_VIDEO);
  const processDuration = TEST_MODE ? Math.min(totalDuration, TEST_DURATION) : totalDuration;

  console.log(
    `📊 Total video duration: ${totalDuration.toFixed(2)}s (${(totalDuration / 60).toFixed(2)} minutes)`
  );

  if (TEST_MODE) {
    console.log(
      `📊 Processing duration: ${processDuration.toFixed(2)}s (${(processDuration / 60).toFixed(2)} minutes)`
    );
  }

  // 動画の長さを取得してセグメントに分割
  console.log('📊 Analyzing video and creating segments...');
  const allSegments = await segmentVideo(INPUT_VIDEO, 20, 120);

  // テストモードの場合は最初の5分のセグメントだけをフィルタ
  const segments = TEST_MODE
    ? allSegments.filter(seg => seg.start < TEST_DURATION)
    : allSegments;

  // 最後のセグメントが5分を超える場合は切り詰める
  if (TEST_MODE && segments.length > 0) {
    const lastSegment = segments[segments.length - 1];
    if (lastSegment.end > TEST_DURATION) {
      lastSegment.end = TEST_DURATION;
    }
  }

  console.log(`Created ${segments.length} segments${TEST_MODE ? ' (test mode - first 5 minutes)' : ''}`);

  const beats: Beat[] = [];

  // フェーズ1: 動画分割・文字起こし・翻訳・話者識別
  console.log('\n📋 Phase 1: Video Processing and Transcription');
  console.log('=========================================');
  console.log(`   Whisper Concurrency: ${CONCURRENCY.whisper} parallel requests`);
  console.log(`   Translation Concurrency: ${CONCURRENCY.translation} parallel requests`);
  console.log(`   Speaker ID Concurrency: ${CONCURRENCY.speakerId} parallel requests`);
  console.log(`   Processing all segments in parallel with individual API limits`);

  // 全セグメントを並列処理（各API呼び出しはリミッターで制限）
  const segmentPromises = segments.map(async (segment, index) => {
    const segmentNum = index + 1;
    const duration = segment.end - segment.start;
    const videoOutput = path.join(videoOutputDir, `${segmentNum}.mp4`);
    const audioOutput = path.join(videoOutputDir, `${segmentNum}.mp3`);
    const thumbnailOutput = path.join(videoOutputDir, `${segmentNum}.jpg`);
    const videoFileName = `${segmentNum}.mp4`;
    const cachedBeat = existingBeatsCache.get(videoFileName);

    // 動画・音声処理（リミッターなし - ローカル処理）
    await generateVideoAndThumbnail(videoOutput, thumbnailOutput, INPUT_VIDEO, segment.start, duration);
    await extractAudioIfNeeded(audioOutput, INPUT_VIDEO, segment.start, duration);

    // 書き起こしと翻訳（Whisperリミッター適用）
    const multiLinguals = await API_LIMITERS.whisper(() =>
      getTranscriptionAndTranslation(cachedBeat, audioOutput, existingTranslations, DEFAULT_LANG)
    );

    // 話者識別（SpeakerIDリミッター適用）
    const speaker = await API_LIMITERS.speakerId(() =>
      identifySpeaker(cachedBeat, multiLinguals)
    );

    return createBeatFromSegment(segmentNum, segment, multiLinguals, speaker);
  });

  const processedBeats = await Promise.all(segmentPromises);
  beats.push(...processedBeats);

  // 進捗を保存
  await saveProgress(outputPath, beats, processDuration, segments.length);

  // フェーズ2: TTS音声生成
  console.log('\n\n🎤 Phase 2: Japanese TTS Audio Generation');
  console.log('=========================================');
  console.log(`   Concurrency: ${CONCURRENCY.tts} parallel requests`);

  const ttsPromises = beats.map((beat, index) => {
    const segmentNum = index + 1;
    const jaAudioOutput = path.join(videoOutputDir, `${segmentNum}_ja.mp3`);
    return API_LIMITERS.tts(() => {
      console.log(`🔊 Processing TTS for segment ${segmentNum}/${beats.length}...`);
      return generateJapaneseTTS(jaAudioOutput, beat.multiLinguals.ja);
    });
  });

  await Promise.all(ttsPromises);

  // フェーズ3: セグメント重要度評価
  console.log('\n\n📊 Phase 3: Segment Importance Evaluation');
  console.log('=========================================');

  // 全セグメントに評価データがあるかチェック
  const needsEvaluation = beats.some(
    beat => beat.importance === undefined || beat.category === undefined || beat.summary === undefined
  );

  if (needsEvaluation) {
    console.log('🔍 Evaluating segment importance...');

    try {
      const evaluations = await evaluateSegments(beats);

      // 評価結果を各Beatに追加
      beats.forEach((beat, index) => {
        const segmentNum = index + 1;
        const evaluation = evaluations.get(segmentNum);
        if (evaluation) {
          beat.importance = evaluation.importance;
          beat.category = evaluation.category;
          beat.summary = evaluation.summary;
        }
      });

      console.log('✅ Evaluation complete!');
      displayEvaluationStats(beats);
    } catch (error) {
      console.error('⚠️  Evaluation failed:', error);
      console.log('   Continuing without evaluation data...');
    }
  } else {
    console.log('♻️  All segments already evaluated, skipping evaluation');
  }

  // 最終結果をJSONとして保存
  const output: Output = {
    lang: DEFAULT_LANG,
    totalDuration: processDuration,
    totalSegments: segments.length,
    beats: beats,
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✨ Processing complete!`);
  console.log(`📄 Results saved to ${outputPath}`);
  console.log(`📁 Video and audio files saved in ${videoOutputDir}/`);
  console.log(`\n📈 Summary:`);
  console.log(`   Total duration: ${processDuration.toFixed(2)}s`);
  console.log(`   Total segments: ${segments.length}`);
  console.log(`   Average segment length: ${(processDuration / segments.length).toFixed(2)}s`);

  if (TEST_MODE) {
    console.log(`\n💡 This was a test run. Run without --test flag to process the full video.`);
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
