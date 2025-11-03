# AI Video Separator

対談動画を話の内容に応じて自動分割し、音声文字起こしと話者識別を行うツールです。

## 機能

- **スマート動画分割**: 無音部分を検出して、話の途中で切れないように自動分割
- **音声抽出**: 各セグメントから音声ファイル（MP3）を自動生成
- **文字起こし**: OpenAI Whisper APIで高精度な日本語文字起こし
- **自動翻訳**: GPT-4o-miniで日本語を英語に自動翻訳（日英両方を出力）
- **翻訳キャッシュ**: 既存の翻訳を再利用してAPIコストを削減
- **話者識別**: GPT-4oで会話から話者を自動識別
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

## セットアップ

### 1. 依存関係のインストール

```bash
npm install
```

### 2. OpenAI APIキーの設定

`.env`ファイルを作成して、APIキーを設定します：

```bash
cp .env.example .env
```

`.env`ファイルを編集：

```
OPENAI_API_KEY=sk-your-api-key-here
```

> **注意**: OpenAI APIキーは[OpenAI Platform](https://platform.openai.com/api-keys)で取得できます。APIの使用には料金が発生します。

## 使い方

### 基本的な使い方

デフォルトの動画ファイル（ai.mp4）を処理：

```bash
npm start
```

### 動画ファイルを指定する

#### 方法1: --input フラグを使用

```bash
npm start -- --input your-video.mp4
```

または短縮形：

```bash
npm start -- -i your-video.mp4
```

#### 方法2: ファイル名を直接指定

```bash
npm start -- your-video.mp4
```

### テストモード（最初の5分だけ処理）

長い動画をテストする場合、最初の5分だけを処理できます：

```bash
npm run start:test
```

動画ファイルを指定してテストモード：

```bash
npm start -- --test --input your-video.mp4
```

または：

```bash
npm start -- -t -i your-video.mp4
```

## 処理の流れ

1. **既存翻訳のロード**: `output/mulmo_view.json`から既存の翻訳をキャッシュとして読み込み
2. **無音検出**: 動画全体から無音部分を自動検出
3. **セグメント作成**: 20秒〜2分の範囲で、無音部分で分割
4. **各セグメントの処理**:
   - 動画ファイル（1.mp4, 2.mp4, ...）を生成
   - 音声ファイル（1.mp3, 2.mp3, ...）を抽出
   - Whisper APIで日本語文字起こし
   - GPT-4o-miniで英語に翻訳（キャッシュにある場合はスキップ）
   - GPT-4oで話者を識別
5. **JSON出力**: すべての情報を`output/mulmo_view.json`に保存

## 出力

### ファイル構成

処理が完了すると、`output/`ディレクトリに以下のファイルが生成されます：

```
output/
├── mulmo_view.json   # メタデータと文字起こし結果
├── 1.mp4             # セグメント1の動画
├── 1.mp3             # セグメント1の音声
├── 2.mp4             # セグメント2の動画
├── 2.mp3             # セグメント2の音声
└── ...
```

### JSONフォーマット

`mulmo_view.json`の構造：

```json
{
  "totalDuration": 465.5,
  "totalSegments": 8,
  "beats": [
    {
      "text": "Hello, today we will talk about AI...",
      "audioSources": {
        "en": "1.mp3"
      },
      "multiLinguals": {
        "ja": "こんにちは、今日はAIについて話します...",
        "en": "Hello, today we will talk about AI..."
      },
      "videoSource": "1.mp4",
      "speaker": "話者A",
      "startTime": 0,
      "endTime": 45.2,
      "duration": 45.2
    },
    {
      "text": "Yes, nice to meet you...",
      "audioSources": {
        "en": "2.mp3"
      },
      "multiLinguals": {
        "ja": "はい、よろしくお願いします...",
        "en": "Yes, nice to meet you..."
      },
      "videoSource": "2.mp4",
      "speaker": "話者B",
      "startTime": 45.2,
      "endTime": 98.7,
      "duration": 53.5
    }
  ]
}
```

#### フィールドの説明

- `totalDuration`: 処理した動画の総時間（秒）
- `totalSegments`: 分割されたセグメントの総数
- `beats[]`: 各セグメントの情報
  - `text`: 英語テキスト（`multiLinguals.en`と同じ）
  - `audioSources`: 音声ファイル
    - `en`: 英語音声ファイル名
  - `multiLinguals`: 多言語テキスト
    - `ja`: 日本語の文字起こし（Whisper API）
    - `en`: 英語翻訳（GPT-4o-mini）
  - `videoSource`: 動画ファイル名
  - `speaker`: 話者名（GPT-4oが識別）
  - `startTime`: セグメント開始時刻（秒）
  - `endTime`: セグメント終了時刻（秒）
  - `duration`: セグメントの長さ（秒）

## 分割アルゴリズム

このツールは以下の方法で動画を分割します：

1. **無音検出**: ffmpegの`silencedetect`フィルタで無音部分を検出
2. **最適な分割点の選択**:
   - 各セグメントが20秒以上になるように調整
   - 2分を超える場合は、2分に近い無音部分で分割
   - 無音の中点で分割（音声が途切れないように）
3. **フォールバック**: 無音が検出されない場合は、60秒ごとに固定分割

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
npm start -- --input your-video.mp4
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

## コスト見積もり

OpenAI APIの料金（2024年11月時点）：

- **Whisper API**: $0.006 / 分
- **GPT-4o-mini API** (翻訳): $0.15 / 1M入力トークン、$0.60 / 1M出力トークン
- **GPT-4o API** (話者識別): $2.50 / 1M入力トークン、$10.00 / 1M出力トークン

例: 30分の動画（8セグメント）の場合
- Whisper: 約 $0.18
- GPT-4o-mini (翻訳): 約 $0.10〜$0.30
- GPT-4o (話者識別): 約 $0.50〜$2.00
- **合計**: 約 $0.80〜$2.50

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
