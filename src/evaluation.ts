import { Beat } from './types.js';
import { getOpenAIClient } from './transcription.js';

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
export async function evaluateSegments(beats: Beat[]): Promise<Map<number, SegmentEvaluation>> {
  const client = getOpenAIClient();

  // 入力データを準備
  const segments: SegmentInput[] = beats.map((beat, index) => ({
    segmentNumber: index + 1,
    speaker: beat.speaker || 'Unknown',
    text: beat.multiLinguals.ja,
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
        content: 'あなたは動画コンテンツの重要度を評価する専門家です。各セグメントの重要性を正確に判定してください。重要：すべてのセグメントに同じスコアを付けないでください。内容に応じて0から10まで幅広くスコアを使い分け、明確なメリハリをつけてください。'
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
    temperature: 0.5 // バリエーションと一貫性のバランス
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
  let prompt = `以下は動画の文字起こしセグメントです。各セグメントを評価してください。

評価基準：

【importance（0-10）】
内容の重要性を評価してください。
* 10: 最も重要な結論、核心的な主張、決定的な情報
* 7-9: 重要なポイント、キーとなる説明、重要な事実
* 4-6: 補足的な説明、具体例、一般的な議論
* 1-3: 軽い雑談、挨拶、脱線、繰り返し
* 0: 無意味な内容、ノイズ

【category】
以下から最適なものを選択してください。
* key_point: 重要な主張や結論、核心的なメッセージ
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
- 全体の文脈を考慮して、動画全体で本当に重要な部分を見極めてください
- 重要度は相対的に評価し、本当に重要なものだけを高スコアにしてください
- **全セグメントに同じスコア（特に5）をつけないでください！必ずメリハリをつけてください**
- 目安として、スコアの分布は以下のようにしてください：
  * 8-10点: 全体の約5-10%（最重要なポイント）
  * 6-7点: 全体の約20-30%（重要なポイント）
  * 3-5点: 全体の約40-50%（標準的な内容）
  * 0-2点: 全体の約20-30%（雑談や脱線）
- 各セグメントを個別に慎重に評価し、内容に応じて適切なスコアを付けてください

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
