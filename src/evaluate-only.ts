#!/usr/bin/env node
/**
 * 評価専用ツール
 * 既存のmulmo_view.jsonから評価のみを実行
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Output, Beat } from './types.js';
import { getOpenAIClient } from './transcription.js';
import dotenv from 'dotenv';

dotenv.config();

// 評価入力データの型定義
interface SegmentInput {
  segmentNumber: number;
  speaker: string;
  text: string;
  startTime: number;
  duration: number;
}

// 評価結果の型定義
interface SegmentEvaluation {
  segmentNumber: number;
  importance: number;
  category: string;
  summary: string;
}

// Structured Outputs用のスキーマ
const evaluationSchema = {
  type: 'object',
  properties: {
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          segmentNumber: {
            type: 'number',
            description: 'セグメント番号'
          },
          importance: {
            type: 'number',
            description: '重要度スコア (0-10)',
            minimum: 0,
            maximum: 10
          },
          category: {
            type: 'string',
            description: 'カテゴリ',
            enum: [
              'key_point',
              'introduction',
              'explanation',
              'example',
              'discussion',
              'conclusion',
              'tangent',
              'transition'
            ]
          },
          summary: {
            type: 'string',
            description: '日本語で1-2文の要約'
          }
        },
        required: ['segmentNumber', 'importance', 'category', 'summary'],
        additionalProperties: false
      }
    }
  },
  required: ['evaluations'],
  additionalProperties: false
};

/**
 * 全セグメントを一括で評価
 */
async function evaluateSegments(beats: Beat[]): Promise<Map<number, SegmentEvaluation>> {
  const client = getOpenAIClient();

  // 入力データを準備（オリジナル言語=日本語を使用）
  const segments: SegmentInput[] = beats.map((beat, index) => ({
    segmentNumber: index + 1,
    speaker: beat.speaker || 'Unknown',
    text: beat.multiLinguals.ja, // 日本語テキストを使用
    startTime: beat.startTime || 0,
    duration: beat.duration || 0
  }));

  // プロンプトを構築
  const prompt = buildEvaluationPrompt(segments);

  console.log(`  📊 Evaluating ${segments.length} segments...`);
  console.log(`  📝 Sending ${prompt.length} characters to GPT-4o...`);

  // GPT-4oに送信（response_format使用）
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `あなたは対談・インタビュー動画の重要度を評価する専門家です。

各セグメントの内容を分析し、視聴者にとっての価値を判定してください。

重要度判定の優先基準：
1. 未来予測や将来展望（AIの進化、技術トレンド、業界の展望など）
2. 意外性のある回答や予想外の視点
3. 質問に対する深い洞察や独自の解答
4. 核心的な主張や決定的な情報
5. 専門的な知見や経験に基づく具体的なアドバイス

これらの要素を含むセグメントには高いスコア（8-10点）を付けてください。
逆に、挨拶や雑談、一般的な説明には低いスコア（0-3点）を付けてください。

必ず0から10まで幅広くスコアを使い分け、明確なメリハリをつけてください。`
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'segment_evaluation',
        strict: true,
        schema: evaluationSchema
      }
    },
    temperature: 0.9 // より多様な評価を得る
  });

  // レスポンスをパース
  const content = response.choices[0].message.content;
  if (!content) {
    throw new Error('Empty response from GPT-4o');
  }

  const result = JSON.parse(content);

  // Map形式に変換（segmentNumber -> evaluation）
  const evaluationMap = new Map<number, SegmentEvaluation>();
  for (const evaluation of result.evaluations) {
    evaluationMap.set(evaluation.segmentNumber, evaluation);
  }

  console.log(`  ✅ Successfully evaluated ${evaluationMap.size} segments`);

  return evaluationMap;
}

/**
 * 評価用プロンプトを構築
 */
function buildEvaluationPrompt(segments: SegmentInput[]): string {
  let prompt = `以下は対談・インタビュー動画の文字起こしセグメントです。各セグメントを評価してください。

評価基準：

【importance（0-10）】
内容の重要性と視聴価値を評価してください。

◆ 高スコア（8-10点）を付けるべき内容：
* 未来予測・将来展望（技術トレンド、業界の方向性、AIの進化予測など）
* 意外性のある回答・予想外の視点・斬新なアイデア
* 質問に対する深い洞察・独自の解答・専門的な知見
* 核心的な主張・決定的な情報・重要な発表
* 具体的な数値データ・統計・実例に基づく説明

◆ 中スコア（4-7点）を付けるべき内容：
* 重要だが一般的な説明・補足情報
* 具体例や事例の紹介
* 話題の導入や展開
* 意見交換や議論

◆ 低スコア（0-3点）を付けるべき内容：
* 挨拶・自己紹介・軽い雑談
* 本題から外れた脱線
* 繰り返しや言い直し
* 無意味な相槌やつなぎ

【category】
以下から最適なものを選択してください。
* key_point: 重要な主張や結論、核心的なメッセージ（特に未来予測や意外な回答）
* introduction: 話題の導入、イントロダクション
* explanation: 詳細な解説、説明
* example: 具体例や事例の紹介
* discussion: 意見交換、ディスカッション
* conclusion: まとめ、結論
* tangent: 本題から外れた雑談
* transition: 話題の切り替え、つなぎ

【summary】
セグメントの内容を日本語で1-2文（最大50文字程度）で簡潔に要約してください。

重要な注意点：
- **絶対に同じスコアを連続して付けないでください**
- **スコア5を避けてください。4と6を使い分けてください**
- 特に「未来について」「意外な回答」「予測」を含むセグメントは積極的に高スコア（8-10点）を付けてください
- **必須の分布目標**：
  * 8-10点: 最低15%以上（未来予測、意外な回答、核心的な主張）
  * 6-7点: 約25-35%（重要なポイント）
  * 3-4点: 約30-40%（標準的な内容）
  * 0-2点: 約15-25%（雑談や脱線）
- 各セグメントを個別に慎重に評価し、積極的に高スコアと低スコアを付けてください
- 特に未来や予測に関する内容は8点以上を優先してください

---

セグメント一覧：

`;

  for (const segment of segments) {
    prompt += `
セグメント ${segment.segmentNumber}:
話者: ${segment.speaker}
時刻: ${formatTime(segment.startTime)} (${segment.duration.toFixed(1)}秒)
内容: ${segment.text}

---
`;
  }

  prompt += `
上記の全セグメントを評価し、JSON形式で返してください。`;

  return prompt;
}

/**
 * 秒数を mm:ss 形式に変換
 */
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * メイン処理
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run evaluate <path-to-mulmo_view.json>');
    console.error('Example: npm run evaluate output/ai/mulmo_view.json');
    process.exit(1);
  }

  const inputPath = args[0];

  console.log('🔍 Loading existing data...');

  // JSONを読み込み
  const jsonContent = await fs.readFile(inputPath, 'utf-8');
  const data: Output = JSON.parse(jsonContent);

  // langフィールドがない場合はデフォルト値を設定
  if (!data.lang) {
    data.lang = 'en';
  }

  console.log(`📊 Found ${data.beats.length} segments`);

  // 評価を実行
  console.log('\n📊 Starting evaluation...\n');
  const evaluations = await evaluateSegments(data.beats);

  // 評価結果を各Beatに追加
  for (let i = 0; i < data.beats.length; i++) {
    const segmentNum = i + 1;
    const evaluation = evaluations.get(segmentNum);

    if (evaluation) {
      data.beats[i].importance = evaluation.importance;
      data.beats[i].category = evaluation.category;
      data.beats[i].summary = evaluation.summary;
    }
  }

  // 統計情報を表示
  const highImportance = data.beats.filter(b => (b.importance || 0) >= 8).length;
  const mediumHighImportance = data.beats.filter(b => (b.importance || 0) >= 6 && (b.importance || 0) < 8).length;
  const mediumImportance = data.beats.filter(b => (b.importance || 0) >= 4 && (b.importance || 0) < 6).length;
  const lowImportance = data.beats.filter(b => (b.importance || 0) < 4).length;

  console.log('\n✅ Evaluation complete!');
  console.log(`\n📈 Importance Distribution:`);
  console.log(`   Very High (8-10): ${highImportance} segments (${(highImportance / data.beats.length * 100).toFixed(1)}%)`);
  console.log(`   High (6-7): ${mediumHighImportance} segments (${(mediumHighImportance / data.beats.length * 100).toFixed(1)}%)`);
  console.log(`   Medium (4-5): ${mediumImportance} segments (${(mediumImportance / data.beats.length * 100).toFixed(1)}%)`);
  console.log(`   Low (0-3): ${lowImportance} segments (${(lowImportance / data.beats.length * 100).toFixed(1)}%)`);

  // スコアの詳細分布
  const scoreCounts = new Map<number, number>();
  for (const beat of data.beats) {
    const score = beat.importance || 0;
    scoreCounts.set(score, (scoreCounts.get(score) || 0) + 1);
  }

  console.log(`\n📊 Score Distribution:`);
  for (let score = 10; score >= 0; score--) {
    const count = scoreCounts.get(score) || 0;
    if (count > 0) {
      const bar = '█'.repeat(Math.ceil(count / data.beats.length * 50));
      console.log(`   ${score.toString().padStart(2)}: ${bar} ${count}`);
    }
  }

  // 保存
  await fs.writeFile(inputPath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\n💾 Saved updated data to ${inputPath}`);

  // 高スコアのセグメントをプレビュー
  const highlights = data.beats
    .map((beat, index) => ({ beat, index: index + 1 }))
    .filter(({ beat }) => (beat.importance || 0) >= 8)
    .sort((a, b) => (b.beat.importance || 0) - (a.beat.importance || 0));

  if (highlights.length > 0) {
    console.log(`\n🎯 Top Highlights (importance >= 8):\n`);
    highlights.slice(0, 10).forEach(({ beat, index }, i) => {
      console.log(`${i + 1}. [Segment ${index}] Score: ${beat.importance} - ${beat.category}`);
      console.log(`   ${beat.summary}`);
      console.log('');
    });
  }
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
