[![npm version](https://badge.fury.io/js/mulmo-movie.svg)](https://badge.fury.io/js/mulmo-movie)
# mulmo-movie

> **Note:** 動画処理を含む一般的な用途には [MulmoCast-Slides (`@mulmocast/slide`)](https://github.com/receptron/MulmoCast-Slides) の使用を推奨します。MulmoCast-Slides は動画の無音検出・セグメント分割・文字起こし・翻訳・TTS に加え、PPTX/PDF/Markdown/Keynote 入力、LLM ナレーション生成、ExtendedMulmoScript 出力、MulmoViewer バンドル生成にも対応しています。

## mulmo-movie 固有の機能（MulmoCast-Slides にないもの）

| 機能 | 説明 |
|------|------|
| **話者識別** | GPT-4o で会話から話者を自動識別 |
| **重要度スコアリング** | GPT-4o で各セグメントに 0-10 の重要度スコア・カテゴリ・要約を自動付与 |
| **ダイジェスト生成** | 重要度スコアに基づいて重要セグメントのみを抽出 |
| **テストモード** | `--test` で最初の 5 分のみ処理するプレビュー機能 |

これらの機能が必要な場合のみ mulmo-movie を使用してください。

---

AI-powered video processing tool with transcription, translation, and speaker identification.

対談動画を話の内容に応じて自動分割し、音声文字起こしと話者識別を行うツールです。

## 機能

- **スマート動画分割**: 無音部分を検出して、話の途中で切れないように自動分割
- **音声抽出**: 各セグメントから音声ファイル（MP3）を自動生成
- **多言語対応**: 英語・日本語の音声を書き起こし、双方向翻訳に対応
- **文字起こし**: OpenAI Whisper APIで高精度な文字起こし
- **自動翻訳**: GPT-4o-miniで自動翻訳（日英両方を出力）
- **日本語音声生成**: OpenAI TTS APIで翻訳テキストから日本語音声を生成
- **並列処理**: p-limitを使用したAPI呼び出しの並列化で処理時間を大幅短縮（常時並列実行）
- **翻訳キャッシュ**: 既存の翻訳を再利用してAPIコストを削減
- **話者識別**: GPT-4oで会話から話者を自動識別
- **重要度評価**: GPT-4oで各セグメントの重要度を自動評価（0-10スコア、カテゴリ、要約付き）
- **ダイジェスト生成**: 重要なセグメントのみを抽出したダイジェスト機能
- **構造化データ出力**: すべての情報をJSON形式で出力

## 必要な環境

- Node.js 18以上
- ffmpeg（音声・動画処理用）
- OpenAI APIキー

### ffmpegのインストール

#### macOS
```bash
brew install ffmpeg
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

#### Windows
[ffmpeg公式サイト](https://ffmpeg.org/download.html)からダウンロードしてインストール

## インストール

### グローバルインストール（推奨）

```bash
npm install -g mulmo-movie
```

### ローカルインストール

```bash
npm install mulmo-movie
```

## セットアップ

### OpenAI APIキーの設定

`.env`ファイルを作成して、APIキーを設定します：

```bash
cp .env.example .env
```

`.env`ファイルを編集：

```bash
OPENAI_API_KEY=sk-your-api-key-here

# API並列処理設定（オプション）
# デフォルト値はOpenAI Tier 1の制限に基づいています
WHISPER_CONCURRENCY=3      # 書き起こしの並列数
TRANSLATION_CONCURRENCY=10  # 翻訳の並列数
TTS_CONCURRENCY=3          # TTS音声生成の並列数
SPEAKER_ID_CONCURRENCY=10  # 話者識別の並列数
```

> **注意**:
> - OpenAI APIキーは[OpenAI Platform](https://platform.openai.com/api-keys)で取得できます
> - APIの使用には料金が発生します
> - **並列処理設定**: アカウントのTier（利用状況）に応じて並列数を調整できます
>   - Tier 1: デフォルト値（安全）
>   - Tier 4以上: より高い並列数に設定可能（例: WHISPER_CONCURRENCY=10）
>   - [OpenAI Rate Limits](https://platform.openai.com/docs/guides/rate-limits)を参照

## 使い方

### 基本的な使い方

```bash
mulmo-movie video.mp4
```

### オプション

```bash
mulmo-movie <input> [options]

Options:
  -l, --lang     Source language (en or ja)  [default: "en"]
  -t, --test     Test mode: first 5 minutes only
  -o, --output   Output directory
  -h, --help     Show help
  -v, --version  Show version
```

### 例

```bash
# 英語動画を処理（デフォルト）
mulmo-movie video.mp4

# 日本語動画を処理
mulmo-movie video.mp4 --lang ja

# テストモード（最初の5分のみ）
mulmo-movie --test video.mp4

# 出力ディレクトリを指定
mulmo-movie video.mp4 --output ./my-output
```

### その他のコマンド

#### 評価のみを実行

既にテキストデータがある場合、評価だけを再実行できます：

```bash
npx tsx src/evaluate-only.ts output/ai/mulmo_view.json
```

この評価専用コマンドは：
- 既存の`mulmo_view.json`から日本語テキストを読み込み
- GPT-4oで全セグメントの重要度を評価
- 未来予測、意外な回答、専門的な洞察を高く評価
- 評価結果を同じファイルに上書き保存

**注意**: 評価はLLMの性質上、実行ごとに若干異なる結果になる可能性があります。満足いく結果が得られるまで何度か実行することをお勧めします。

## 処理の流れ

1. **キャッシュのロード**: `output/{動画名}/mulmo_view.json`から既存データを読み込み
   - 既存の翻訳をキャッシュ（日本語→英語のマッピング）
   - 既存のセグメント情報（Beat）をキャッシュ
2. **無音検出**: 動画全体から無音部分を自動検出
3. **セグメント作成**: 20秒〜2分の範囲で、無音部分で分割
4. **フェーズ1: 各セグメントの処理**（各ステップで個別にキャッシュチェック）:
   - **動画・サムネイル**: `{n}.mp4`と`{n}.jpg`が存在すればスキップ、なければ生成
   - **音声抽出**: `{n}.mp3`が存在すればスキップ、なければ抽出
   - **文字起こし・翻訳**: JSONにテキストデータがあればスキップ、なければWhisper API + GPT-4o-miniで処理
   - **話者識別**: JSONに話者情報があればスキップ、なければGPT-4oで識別
   - 各セグメント処理後にJSONを保存（クラッシュ時の安全性）
5. **フェーズ2: 日本語TTS音声生成**:
   - **TTS音声**: `{n}_ja.mp3`が存在すればスキップ、なければTTS APIで生成
6. **🆕 フェーズ3: セグメント重要度評価**:
   - JSONに評価データ（importance, category, summary）があればスキップ
   - なければ全セグメントのテキストをGPT-4oに送信し一括評価
   - 各セグメントに重要度スコア（0-10）、カテゴリ、要約を追加
7. **JSON出力**: すべての情報を`output/{動画名}/mulmo_view.json`に保存

## 出力

### ファイル構成

処理が完了すると、`output/`ディレクトリ配下に動画ファイル名のディレクトリが作成され、以下のファイルが生成されます：

```
output/
└── ai/                    # 動画ファイル名（ai.mp4 → ai/）
    ├── mulmo_view.json    # メタデータと文字起こし結果
    ├── 1.mp4              # セグメント1の動画
    ├── 1.jpg              # セグメント1のサムネイル画像
    ├── 1.mp3              # セグメント1の音声（元の英語）
    ├── 1_ja.mp3           # セグメント1の日本語TTS音声
    ├── 2.mp4              # セグメント2の動画
    ├── 2.jpg              # セグメント2のサムネイル画像
    ├── 2.mp3              # セグメント2の音声（元の英語）
    ├── 2_ja.mp3           # セグメント2の日本語TTS音声
    └── ...
```

別の動画を処理する場合：

```
output/
├── ai/
│   └── ... (ai.mp4の処理結果)
└── interview/
    └── ... (interview.mp4の処理結果)
```

### JSONフォーマット

各動画ディレクトリ内の`mulmo_view.json`の構造：

```json
{
  "lang": "en",
  "totalDuration": 465.5,
  "totalSegments": 8,
  "beats": [
    {
      "text": "Hello, today we will talk about AI...",
      "audioSources": {
        "en": "1.mp3",
        "ja": "1_ja.mp3"
      },
      "multiLinguals": {
        "ja": "こんにちは、今日はAIについて話します...",
        "en": "Hello, today we will talk about AI..."
      },
      "videoSource": "1.mp4",
      "thumbnail": "1.jpg",
      "speaker": "話者A",
      "startTime": 0,
      "endTime": 45.2,
      "duration": 45.2,
      "importance": 9,
      "category": "introduction",
      "summary": "AIに関する対談の導入部分"
    },
    {
      "text": "Yes, nice to meet you...",
      "audioSources": {
        "en": "2.mp3",
        "ja": "2_ja.mp3"
      },
      "multiLinguals": {
        "ja": "はい、よろしくお願いします...",
        "en": "Yes, nice to meet you..."
      },
      "videoSource": "2.mp4",
      "thumbnail": "2.jpg",
      "speaker": "話者B",
      "startTime": 45.2,
      "endTime": 98.7,
      "duration": 53.5,
      "importance": 3,
      "category": "tangent",
      "summary": "挨拶と自己紹介"
    }
  ]
}
```

#### フィールドの説明

- `lang`: デフォルト言語（"en" または "ja"）
- `totalDuration`: 処理した動画の総時間（秒）
- `totalSegments`: 分割されたセグメントの総数
- `beats[]`: 各セグメントの情報
  - `text`: 英語テキスト（`multiLinguals.en`と同じ）
  - `audioSources`: 音声ファイル
    - `en`: 元の英語音声ファイル名（動画から抽出）
    - `ja`: 日本語TTS音声ファイル名（OpenAI TTS APIで生成）
  - `multiLinguals`: 多言語テキスト
    - `ja`: 日本語の文字起こし（Whisper API）
    - `en`: 英語翻訳（GPT-4o-mini）
  - `videoSource`: 動画ファイル名
  - `thumbnail`: サムネイル画像ファイル名（動画の最初のフレーム、640px幅）
  - `speaker`: 話者名（GPT-4oが識別）
  - `startTime`: セグメント開始時刻（秒）
  - `endTime`: セグメント終了時刻（秒）
  - `duration`: セグメントの長さ（秒）
  - `importance`: 🆕 重要度スコア（0-10、10が最重要）
  - `category`: 🆕 カテゴリ（key_point, introduction, explanation, example, discussion, conclusion, tangent, transition）
  - `summary`: 🆕 セグメントの要約（日本語、1-2文）

## 分割アルゴリズム

このツールは以下の方法で動画を分割します：

1. **無音検出**: ffmpegの`silencedetect`フィルタで無音部分を検出
2. **最適な分割点の選択**:
   - 各セグメントが20秒以上になるように調整
   - 2分を超える場合は、2分に近い無音部分で分割
   - 無音の中点で分割（音声が途切れないように）
3. **フォールバック**: 無音が検出されない場合は、60秒ごとに固定分割

## 🆕 重要度評価とダイジェスト

### 重要度評価

フェーズ3で、GPT-4oが全セグメントを一括評価し、各セグメントに以下を付与：

- **importance（0-10）**: 内容の重要性スコア
  - 10: 最も重要な結論、核心的な主張
  - 7-9: 重要なポイント、キーとなる説明
  - 4-6: 補足的な説明、具体例
  - 1-3: 雑談、挨拶、脱線
  - 0: 無意味な内容

- **category**: セグメントのカテゴリ
  - `key_point`: 重要な主張や結論
  - `introduction`: 話題の導入
  - `explanation`: 詳細な解説
  - `example`: 具体例や事例
  - `discussion`: 意見交換
  - `conclusion`: まとめ
  - `tangent`: 本題から外れた雑談
  - `transition`: 話題の切り替え

- **summary**: セグメントの簡潔な要約（日本語、1-2文）

### ダイジェストの作成

内蔵のダイジェスト生成ツールを使用：

```bash
# デフォルト（重要度7以上を抽出）
npm run digest output/ai/mulmo_view.json

# 重要度の閾値をカスタマイズ（例: 5以上）
npm run digest output/ai/mulmo_view.json 5
```

出力例：

```
✨ Digest generated successfully!
📄 Saved to: output/ai/digest.json

📊 Summary:
   Video: ai
   Total Duration: 74:20
   Total Segments: 141
   Digest Segments: 15 (importance >= 7)
   Compression: 89.4%

🎯 Highlights:

1. [2:09] 話者A (importance: 7)
   Category: explanation
   Summary: アメリカの再生産業とマイクロソフトの投資について。

2. [5:30] 話者B (importance: 9)
   Category: key_point
   Summary: AIの今後の展開における重要な決定事項。
```

生成される`digest.json`の構造：

```json
{
  "videoName": "ai",
  "totalDuration": "74:20",
  "totalSegments": 141,
  "digestSegments": 15,
  "compressionRatio": "89.4%",
  "highlights": [
    {
      "segmentNumber": 6,
      "videoSource": "6.mp4",
      "timestamp": "2:09",
      "duration": 50.6,
      "importance": 7,
      "category": "explanation",
      "summary": "アメリカの再生産業について",
      "speaker": "話者A",
      "text": "完全な日本語テキスト..."
    }
  ]
}
```

### 処理コスト

- **API呼び出し**: 1回のみ（全セグメントを一括評価）
- **トークン数**: セグメント数 × 平均文字数 × 2
- **コスト見積もり**:
  - 30分動画（8セグメント）: 約$0.05
  - 74分動画（141セグメント）: 約$0.19
  - 長い動画（300セグメント）: 約$0.50

評価はキャッシュされるため、再実行時はスキップされます。

## カスタマイズ

### セグメントの長さを変更

`src/index.ts`の以下の行を編集：

```typescript
const segments = await segmentVideo(INPUT_VIDEO, 20, 120);
//                                              ↑   ↑
//                                          最小時間 最大時間（秒）
```

### 無音検出の感度を調整

`src/segmentation.ts`の`detectSilence`関数のパラメータを変更：

```typescript
export async function detectSilence(
  videoPath: string,
  noiseThreshold: number = -30,  // dB（小さいほど厳密）
  minSilenceDuration: number = 0.5  // 秒（無音の最小長）
)
```

### 処理対象の動画を変更

コマンドライン引数で指定できます：

```bash
npm start your-video.mp4
```

または、デフォルトを変更する場合は`src/index.ts`を編集：

```typescript
let INPUT_VIDEO = 'ai.mp4';  // ← デフォルトのファイル名を変更
```

## トラブルシューティング

### `ffmpeg not found`エラー

ffmpegがインストールされていない、またはPATHに含まれていません。
上記の「ffmpegのインストール」を参照してください。

### OpenAI APIエラー

- `.env`ファイルが正しく設定されているか確認
- APIキーが有効か確認
- OpenAIアカウントに十分なクレジットがあるか確認

### メモリエラー

長い動画を処理する場合、メモリ不足になる可能性があります。
まずテストモードで試してください：

```bash
npm run start:test
```

### 無音が検出されない

対談動画で常に音が鳴っている場合、無音検出が困難です。
`src/segmentation.ts`の`noiseThreshold`を調整してください（例: -30 → -40）。

## キャッシュシステム

このツールは各API課金処理を個別にチェックし、不要なAPI呼び出しを最小化します：

### 課金処理ごとの個別キャッシュ

各セグメントの処理で、以下の順に個別にキャッシュをチェックします：

#### 1. 動画ファイル生成（無課金、ffmpeg処理）
- **チェック**: `{n}.mp4`と`{n}.jpg`が存在するか
- **存在する場合**: 動画分割とサムネイル生成をスキップ
- **存在しない場合**: ffmpegで動画を分割し、サムネイルを生成

#### 2. 音声ファイル抽出（無課金、ffmpeg処理）
- **チェック**: `{n}.mp3`が存在するか
- **存在する場合**: 音声抽出をスキップ
- **存在しない場合**: ffmpegで音声を抽出

#### 3. 文字起こしと翻訳（**Whisper API + GPT-4o-mini API課金**）
- **チェック**: `mulmo_view.json`に該当セグメントのテキストデータ（`multiLinguals`）が存在するか
- **存在する場合**: Whisper API呼び出しと翻訳API呼び出しを**両方スキップ**
- **存在しない場合**:
  - Whisper APIで音声を文字起こし
  - GPT-4o-miniで英語に翻訳（既存の翻訳キャッシュも参照）
- **コスト削減**: セグメントあたり約$0.02〜$0.05

#### 4. 話者識別（**GPT-4o API課金**）
- **チェック**: `mulmo_view.json`に該当セグメントの話者情報（`speaker`）が存在するか
- **存在する場合**: GPT-4o API呼び出しをスキップ
- **存在しない場合**: GPT-4oで話者を識別
- **コスト削減**: セグメントあたり約$0.10〜$0.20

#### 5. TTS音声生成（**TTS API課金**）
- **チェック**: `{n}_ja.mp3`が存在するか
- **存在する場合**: TTS API呼び出しをスキップ
- **存在しない場合**: OpenAI TTS APIで日本語音声を生成
- **コスト削減**: セグメントあたり約$0.01〜$0.05

### 再実行時の動作例

処理が中断された場合や、既存データがある場合の具体例：

```bash
npm start  # 同じ動画を再実行
```

**シナリオ1: セグメント1が完全に完了している場合**
- ✅ 動画・サムネイル存在 → ffmpeg処理スキップ
- ✅ 音声ファイル存在 → 音声抽出スキップ
- ✅ テキストデータ存在 → Whisper & 翻訳APIスキップ
- ✅ 話者情報存在 → GPT-4o APIスキップ
- ✅ TTS音声存在 → TTS APIスキップ
- **コスト: $0**

**シナリオ2: セグメント2が音声抽出まで完了、テキスト化は未完了の場合**
- ✅ 動画・サムネイル存在 → ffmpeg処理スキップ
- ✅ 音声ファイル存在 → 音声抽出スキップ
- ❌ テキストデータなし → Whisper & 翻訳API実行（課金）
- ❌ 話者情報なし → GPT-4o API実行（課金）
- ❌ TTS音声なし → TTS API実行（課金）
- **コスト: 約$0.13〜$0.30**

**シナリオ3: セグメント3がテキスト化まで完了、TTS未完了の場合**
- ✅ 動画・サムネイル存在 → ffmpeg処理スキップ
- ✅ 音声ファイル存在 → 音声抽出スキップ
- ✅ テキストデータ存在 → Whisper & 翻訳APIスキップ
- ✅ 話者情報存在 → GPT-4o APIスキップ
- ❌ TTS音声なし → TTS API実行（課金）
- **コスト: 約$0.01〜$0.05**

### 利点

- **柔軟性**: 各処理が独立してキャッシュされるため、部分的な失敗でも無駄なコストがかからない
- **コスト効率**: 高価なAPI（GPT-4o）と安価なAPI（Whisper、TTS）を個別に管理
- **透明性**: ログで各処理がスキップされたか実行されたかが明確に表示される

## コスト見積もり

OpenAI APIの料金（2024年11月時点）：

- **Whisper API**: $0.006 / 分
- **TTS API**: $15.00 / 1M文字
- **GPT-4o-mini API** (翻訳): $0.15 / 1M入力トークン、$0.60 / 1M出力トークン
- **GPT-4o API** (話者識別 + 🆕重要度評価): $2.50 / 1M入力トークン、$10.00 / 1M出力トークン

例: 30分の動画（8セグメント、約2000文字の日本語テキスト）の場合
- Whisper: 約 $0.18
- TTS (日本語音声生成): 約 $0.03
- GPT-4o-mini (翻訳): 約 $0.10〜$0.30
- GPT-4o (話者識別): 約 $0.50〜$2.00
- 🆕 GPT-4o (重要度評価): 約 $0.05
- **合計**: 約 $0.86〜$2.56

例: 74分の動画（141セグメント）の場合
- Whisper: 約 $0.44
- TTS: 約 $0.30
- GPT-4o-mini (翻訳): 約 $0.50〜$1.50
- GPT-4o (話者識別): 約 $7.00〜$28.00
- 🆕 GPT-4o (重要度評価): 約 $0.19
- **合計**: 約 $8.43〜$30.43

## 技術スタック

- **TypeScript**: 型安全な開発
- **ffmpeg**: 動画・音声処理
- **OpenAI Whisper**: 音声認識
- **OpenAI GPT-4o**: 話者識別
- **Node.js**: ランタイム環境

## ライセンス

MIT

## 貢献

Issue、Pull Requestは大歓迎です！

## 注意事項

- このツールはOpenAI APIを使用します。APIの利用料金が発生します
- 長い動画の処理には時間がかかります（30分の動画で10〜20分程度）
- 処理中はインターネット接続が必要です
- 動画ファイルは著作権法を遵守して使用してください