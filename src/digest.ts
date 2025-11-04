#!/usr/bin/env node
/**
 * ダイジェスト生成ツール
 * mulmo_view.jsonから重要なセグメントのみを抽出
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Output } from './types.js';

interface DigestEntry {
  segmentNumber: number;
  videoSource: string;
  timestamp: string;
  duration: number;
  importance: number;
  category: string;
  summary: string;
  speaker: string;
  text: string;
}

interface DigestOutput {
  videoName: string;
  totalDuration: string;
  totalSegments: number;
  digestSegments: number;
  compressionRatio: string;
  highlights: DigestEntry[];
}

async function generateDigest(
  inputPath: string,
  minImportance: number = 7
): Promise<void> {
  // JSONを読み込み
  const jsonContent = await fs.readFile(inputPath, 'utf-8');
  const data: Output = JSON.parse(jsonContent);

  // 動画名を取得
  const videoName = path.basename(path.dirname(inputPath));

  // 重要なセグメントをフィルタリング
  const highlights: DigestEntry[] = data.beats
    .filter(beat => (beat.importance || 0) >= minImportance)
    .map((beat, index) => ({
      segmentNumber: data.beats.indexOf(beat) + 1,
      videoSource: beat.videoSource,
      timestamp: formatTime(beat.startTime || 0),
      duration: beat.duration || 0,
      importance: beat.importance || 0,
      category: beat.category || 'unknown',
      summary: beat.summary || '',
      speaker: beat.speaker || 'Unknown',
      text: beat.multiLinguals.ja
    }));

  // ダイジェストデータを構築
  const digest: DigestOutput = {
    videoName,
    totalDuration: formatTime(data.totalDuration),
    totalSegments: data.totalSegments,
    digestSegments: highlights.length,
    compressionRatio: `${((1 - highlights.length / data.totalSegments) * 100).toFixed(1)}%`,
    highlights
  };

  // 出力ファイルパス
  const outputPath = path.join(path.dirname(inputPath), 'digest.json');

  // 保存
  await fs.writeFile(outputPath, JSON.stringify(digest, null, 2), 'utf-8');

  // サマリーを表示
  console.log(`\n✨ Digest generated successfully!`);
  console.log(`📄 Saved to: ${outputPath}`);
  console.log(`\n📊 Summary:`);
  console.log(`   Video: ${videoName}`);
  console.log(`   Total Duration: ${digest.totalDuration}`);
  console.log(`   Total Segments: ${digest.totalSegments}`);
  console.log(`   Digest Segments: ${digest.digestSegments} (importance >= ${minImportance})`);
  console.log(`   Compression: ${digest.compressionRatio}`);
  console.log(`\n🎯 Highlights:`);

  highlights.forEach((entry, index) => {
    console.log(`\n${index + 1}. [${entry.timestamp}] ${entry.speaker} (importance: ${entry.importance})`);
    console.log(`   Category: ${entry.category}`);
    console.log(`   Summary: ${entry.summary}`);
  });
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// CLI実行
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: tsx src/digest.ts <path-to-mulmo_view.json> [min-importance]');
  console.error('Example: tsx src/digest.ts output/ai/mulmo_view.json 7');
  process.exit(1);
}

const inputPath = args[0];
const minImportance = args[1] ? parseInt(args[1], 10) : 7;

generateDigest(inputPath, minImportance).catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
