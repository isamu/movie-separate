import dotenv from 'dotenv';
import path from 'path';
import { promises as fs } from 'fs';
import {
  ensureOutputDir,
  extractAudioFromVideo,
  splitVideo,
  splitAudio,
  getVideoDuration,
} from './ffmpeg-utils.js';
import { segmentVideo } from './segmentation.js';
import { transcribeAudioBilingual, identifySpeakers, textToSpeech } from './transcription.js';
import { Beat, Output } from './types.js';

dotenv.config();

const OUTPUT_DIR = 'output';

// コマンドライン引数をパース
const args = process.argv.slice(2);
const TEST_MODE = args.includes('--test') || args.includes('-t');
const TEST_DURATION = 5 * 60; // 5分 = 300秒

// 入力動画ファイルを引数から取得（デフォルトは ai.mp4）
let INPUT_VIDEO = 'ai.mp4';
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--input' || args[i] === '-i') && args[i + 1]) {
    INPUT_VIDEO = args[i + 1];
    break;
  } else if (!args[i].startsWith('-') && args[i].endsWith('.mp4')) {
    // フラグなしで .mp4 ファイルが指定された場合
    INPUT_VIDEO = args[i];
    break;
  }
}

async function main() {
  console.log('🎬 Starting video processing...');
  console.log(`📹 Input video: ${INPUT_VIDEO}`);

  if (TEST_MODE) {
    console.log('🧪 TEST MODE: Processing first 5 minutes only');
  }

  // 出力ディレクトリを作成
  await ensureOutputDir(OUTPUT_DIR);

  // 既存の翻訳をロード（存在する場合）
  const outputPath = path.join(OUTPUT_DIR, 'mulmo_view.json');
  const existingTranslations = new Map<string, string>(); // 日本語 -> 英語のマッピング

  try {
    const existingData = await fs.readFile(outputPath, 'utf-8');
    const existingOutput: Output = JSON.parse(existingData);

    for (const beat of existingOutput.beats) {
      if (beat.multiLinguals?.ja && beat.multiLinguals?.en) {
        existingTranslations.set(beat.multiLinguals.ja, beat.multiLinguals.en);
      }
    }

    if (existingTranslations.size > 0) {
      console.log(`♻️  Loaded ${existingTranslations.size} existing translations from cache`);
    }
  } catch (error) {
    // ファイルが存在しない場合は無視
    console.log('📝 No existing translations found, starting fresh');
  }

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

  // 各セグメントを処理
  for (let i = 0; i < segments.length; i++) {
    const segmentNum = i + 1;
    const segment = segments[i];
    const duration = segment.end - segment.start;

    console.log(
      `\n🎞️  Processing segment ${segmentNum}/${segments.length} (${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s, duration: ${duration.toFixed(1)}s)...`
    );

    const videoOutput = path.join(OUTPUT_DIR, `${segmentNum}.mp4`);
    const audioOutput = path.join(OUTPUT_DIR, `${segmentNum}.mp3`);

    // 動画を分割
    console.log(`  📹 Splitting video...`);
    await splitVideo(INPUT_VIDEO, videoOutput, segment.start, duration);

    // 音声を抽出
    console.log(`  🎵 Extracting audio...`);
    await splitAudio(INPUT_VIDEO, audioOutput, segment.start, duration);

    // 音声を文字起こし（日英両方、キャッシュを使用）
    console.log(`  📝 Transcribing audio...`);
    const multiLinguals = await transcribeAudioBilingual(audioOutput, existingTranslations);
    console.log(`  ✅ Transcription (JA): ${multiLinguals.ja.substring(0, 80)}...`);
    console.log(`  ✅ Translation (EN): ${multiLinguals.en.substring(0, 80)}...`);

    // 日本語音声を生成（TTS）
    const jaAudioOutput = path.join(OUTPUT_DIR, `${segmentNum}_ja.mp3`);
    console.log(`  🎤 Generating Japanese TTS audio...`);
    await textToSpeech(multiLinguals.ja, jaAudioOutput, 'ja');

    // 話者識別を試みる（各セグメントに対して）
    console.log(`  👥 Identifying speakers...`);
    const speakerSegments = await identifySpeakers(multiLinguals.ja);

    // このセグメントのbeatsを作成
    // 話者が複数いる場合は最初の話者を使用（簡略化）
    const mainSpeaker =
      speakerSegments.length > 0
        ? speakerSegments[0].speaker
        : 'Unknown Speaker';

    beats.push({
      text: multiLinguals.en, // textは英語
      audioSources: {
        en: `${segmentNum}.mp3`,
        ja: `${segmentNum}_ja.mp3`,
      },
      multiLinguals: multiLinguals,
      videoSource: `${segmentNum}.mp4`,
      speaker: mainSpeaker,
      startTime: segment.start,
      endTime: segment.end,
      duration: duration,
    });
  }

  // 結果をJSONとして保存
  const output: Output = {
    totalDuration: processDuration,
    totalSegments: segments.length,
    beats: beats,
  };
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n✨ Processing complete!`);
  console.log(`📄 Results saved to ${outputPath}`);
  console.log(`📁 Video and audio files saved in ${OUTPUT_DIR}/`);
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
