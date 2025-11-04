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

  // 入力動画ファイル名から拡張子を除いたベース名を取得
  const videoBaseName = path.basename(INPUT_VIDEO, path.extname(INPUT_VIDEO));

  // 出力ディレクトリを動画名に基づいて作成 (例: output/ai/)
  const videoOutputDir = path.join(OUTPUT_DIR, videoBaseName);
  await ensureOutputDir(videoOutputDir);
  console.log(`📁 Output directory: ${videoOutputDir}`);

  // 既存のデータをロード（存在する場合）
  const outputPath = path.join(videoOutputDir, 'mulmo_view.json');
  const existingTranslations = new Map<string, string>(); // 日本語 -> 英語のマッピング
  const existingBeatsCache = new Map<string, Beat>(); // ファイル名 -> Beat のマッピング

  try {
    const existingData = await fs.readFile(outputPath, 'utf-8');
    const existingOutput: Output = JSON.parse(existingData);

    for (const beat of existingOutput.beats) {
      // 翻訳キャッシュ
      if (beat.multiLinguals?.ja && beat.multiLinguals?.en) {
        existingTranslations.set(beat.multiLinguals.ja, beat.multiLinguals.en);
      }
      // Beat全体のキャッシュ（ファイル名をキーに）
      if (beat.videoSource) {
        existingBeatsCache.set(beat.videoSource, beat);
      }
    }

    if (existingBeatsCache.size > 0) {
      console.log(`♻️  Loaded ${existingBeatsCache.size} existing segments from cache`);
      console.log(`   - ${existingTranslations.size} translations`);
    }
  } catch (error) {
    // ファイルが存在しない場合は無視
    console.log('📝 No existing cache found, starting fresh');
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

  // フェーズ1: 動画分割・文字起こし・翻訳・話者識別
  console.log('\n📋 Phase 1: Transcription and Translation');
  console.log('=========================================');

  for (let i = 0; i < segments.length; i++) {
    const segmentNum = i + 1;
    const segment = segments[i];
    const duration = segment.end - segment.start;

    console.log(
      `\n🎞️  Processing segment ${segmentNum}/${segments.length} (${segment.start.toFixed(1)}s - ${segment.end.toFixed(1)}s, duration: ${duration.toFixed(1)}s)...`
    );

    const videoOutput = path.join(videoOutputDir, `${segmentNum}.mp4`);
    const audioOutput = path.join(videoOutputDir, `${segmentNum}.mp3`);
    const thumbnailOutput = path.join(videoOutputDir, `${segmentNum}.jpg`);
    const videoFileName = `${segmentNum}.mp4`;

    // キャッシュされたデータを取得
    const cachedBeat = existingBeatsCache.get(videoFileName);

    // 動画ファイルとサムネイルが存在しない場合のみ生成
    let shouldGenerateVideo = true;
    try {
      await fs.access(videoOutput);
      await fs.access(thumbnailOutput);
      console.log(`  ♻️  Video and thumbnail already exist, skipping generation`);
      shouldGenerateVideo = false;
    } catch {
      // ファイルが存在しない場合は生成
    }

    if (shouldGenerateVideo) {
      // 動画を分割
      console.log(`  📹 Splitting video...`);
      await splitVideo(INPUT_VIDEO, videoOutput, segment.start, duration);

      // サムネイル画像を生成
      console.log(`  🖼️  Generating thumbnail...`);
      await generateThumbnail(videoOutput, thumbnailOutput, 0);
    }

    // 音声ファイルが存在しない場合のみ抽出（Whisper APIの課金対象）
    let shouldExtractAudio = true;
    try {
      await fs.access(audioOutput);
      console.log(`  ♻️  Audio file already exists, skipping extraction`);
      shouldExtractAudio = false;
    } catch {
      // ファイルが存在しない場合は抽出
    }

    if (shouldExtractAudio) {
      console.log(`  🎵 Extracting audio...`);
      await splitAudio(INPUT_VIDEO, audioOutput, segment.start, duration);
    }

    // 文字起こしと翻訳（Whisper API + Translation APIの課金対象）
    let multiLinguals: MultiLinguals;
    if (cachedBeat && cachedBeat.multiLinguals?.ja && cachedBeat.multiLinguals?.en) {
      // キャッシュされたテキストデータがある場合はスキップ
      console.log(`  ♻️  Transcription and translation cached, skipping Whisper & Translation API`);
      multiLinguals = cachedBeat.multiLinguals;
    } else {
      // 音声を文字起こし（日英両方、キャッシュを使用）
      console.log(`  📝 Transcribing audio...`);
      multiLinguals = await transcribeAudioBilingual(audioOutput, existingTranslations);
      console.log(`  ✅ Transcription (JA): ${multiLinguals.ja.substring(0, 80)}...`);
      console.log(`  ✅ Translation (EN): ${multiLinguals.en.substring(0, 80)}...`);
    }

    // 話者識別（GPT-4o APIの課金対象）
    let mainSpeaker: string;
    if (cachedBeat && cachedBeat.speaker) {
      // キャッシュされた話者情報がある場合はスキップ
      console.log(`  ♻️  Speaker identification cached, skipping GPT-4o API`);
      mainSpeaker = cachedBeat.speaker;
    } else {
      // 話者識別を試みる（各セグメントに対して）
      console.log(`  👥 Identifying speakers...`);
      const speakerSegments = await identifySpeakers(multiLinguals.ja);
      // 話者が複数いる場合は最初の話者を使用（簡略化）
      mainSpeaker =
        speakerSegments.length > 0
          ? speakerSegments[0].speaker
          : 'Unknown Speaker';
    }

    beats.push({
      text: multiLinguals.en, // textは英語
      audioSources: {
        en: `${segmentNum}.mp3`,
        ja: `${segmentNum}_ja.mp3`,
      },
      multiLinguals: multiLinguals,
      videoSource: `${segmentNum}.mp4`,
      thumbnail: `${segmentNum}.jpg`,
      speaker: mainSpeaker,
      startTime: segment.start,
      endTime: segment.end,
      duration: duration,
    });

    // 各セグメント処理後にJSONを保存（安全のため）
    const output: Output = {
      totalDuration: processDuration,
      totalSegments: segments.length,
      beats: beats,
    };
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf-8');
    console.log(`  💾 Saved progress to ${path.basename(outputPath)}`);
  }

  // フェーズ2: TTS音声生成
  console.log('\n\n🎤 Phase 2: Japanese TTS Audio Generation');
  console.log('=========================================');

  for (let i = 0; i < beats.length; i++) {
    const segmentNum = i + 1;
    const beat = beats[i];
    const jaAudioOutput = path.join(videoOutputDir, `${segmentNum}_ja.mp3`);

    console.log(`\n🔊 Processing TTS for segment ${segmentNum}/${beats.length}...`);

    // TTS音声ファイルが存在しない場合のみ生成（TTS APIの課金対象）
    try {
      await fs.access(jaAudioOutput);
      console.log(`  ♻️  Japanese TTS audio already exists, skipping TTS API`);
    } catch {
      console.log(`  🎤 Generating Japanese TTS audio...`);
      await textToSpeech(beat.multiLinguals.ja, jaAudioOutput, 'ja');
    }
  }

  // 最終結果をJSONとして保存
  const output: Output = {
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
