# Claude Code 開発ガイドライン

このプロジェクトでClaudeを使用して開発する際の規約とベストプラクティス

## Key Commands

- **Start**: `npm start -- -i <video.mp4>`
- **Test Mode**: `npm run start:test`
- **Evaluate**: `npm run evaluate <mulmo_view.json>`
- **Digest**: `npm run digest <mulmo_view.json> [min-importance]`
- **Speed Change**: `npm run speed -- -i <file> -s <speed>`
- **Lint**: `npm run lint`

## コーディング規約

### 関数の長さ
- **関数は20行以内に収める**
- 長くなる場合は小さな関数に分割する
- 単一責任の原則を守る

### 変数宣言
- **`const`を優先**
  - 再代入が必要ない場合は常に`const`を使用
- `let`は最小限に
  - ループカウンタなど、再代入が必須の場合のみ
- `var`は使用禁止

### ループとイテレーション
- **`for`ループより関数型アプローチを優先**
  - `forEach()`: 副作用のあるイテレーション
  - `map()`: 変換処理
  - `filter()`: フィルタリング
  - `reduce()`: 集約処理
  - `some()`/`every()`: 条件判定

```typescript
// ❌ 避ける
for (let i = 0; i < items.length; i++) {
  const item = items[i];
  processItem(item);
}

// ✅ 推奨
items.forEach(item => processItem(item));

// ❌ 避ける
const results = [];
for (let i = 0; i < items.length; i++) {
  results.push(transform(items[i]));
}

// ✅ 推奨
const results = items.map(item => transform(item));
```

### 非同期処理
- **`async/await`を優先**
  - `Promise`の`.then()`チェーンは避ける
  - エラーハンドリングは`try/catch`で統一

```typescript
// ❌ 避ける
function processData(path: string): Promise<void> {
  return fs.readFile(path)
    .then(data => parseData(data))
    .then(parsed => saveData(parsed))
    .catch(error => console.error(error));
}

// ✅ 推奨
async function processData(path: string): Promise<void> {
  try {
    const data = await fs.readFile(path);
    const parsed = parseData(data);
    await saveData(parsed);
  } catch (error) {
    console.error(error);
  }
}
```

## プロジェクト構造

```
src/
├── types.ts           # 型定義
├── index.ts           # メインエントリーポイント
├── ffmpeg-utils.ts    # FFmpeg関連ユーティリティ
├── segmentation.ts    # 動画分割ロジック
├── transcription.ts   # 文字起こし・翻訳
├── evaluation.ts      # セグメント評価
├── evaluate-only.ts   # 評価専用スクリプト
├── digest.ts          # ダイジェスト生成
└── speed.ts           # 速度変更ツール
```

## TypeScript規約

### 型定義
- 明示的な型定義を優先
- `any`の使用は避ける
- インターフェースで構造を明確化

```typescript
// ✅ 推奨
interface ProcessOptions {
  input: string;
  output: string;
  speed: number;
}

async function processVideo(options: ProcessOptions): Promise<void> {
  // ...
}
```

### Null/Undefined処理
- Optional Chainingを活用: `object?.property`
- Nullish Coalescingを活用: `value ?? defaultValue`

```typescript
// ✅ 推奨
const importance = beat.importance ?? 0;
const speaker = beat.speaker || 'Unknown';
```

## エラーハンドリング

### 原則
- すべての非同期処理に適切なエラーハンドリングを実装
- ユーザーにわかりやすいエラーメッセージを表示
- 処理が中断されても途中結果を保存（増分保存）

```typescript
// ✅ 推奨
async function processSegment(segment: Segment): Promise<Beat | null> {
  try {
    const result = await heavyProcess(segment);
    return result;
  } catch (error) {
    console.error(`Failed to process segment: ${error.message}`);
    return null;
  }
}
```

## コメント規約

### JSDoc
- 公開関数には必ずJSDocを記述
- パラメータと戻り値を明記

```typescript
/**
 * 動画の再生速度を変更
 * @param inputPath 入力動画ファイルのパス
 * @param outputPath 出力動画ファイルのパス
 * @param speed 再生速度（1.0=通常、1.5=1.5倍速、2.0=2倍速）
 */
export async function changeVideoSpeed(
  inputPath: string,
  outputPath: string,
  speed: number
): Promise<void> {
  // ...
}
```

### インラインコメント
- 複雑なロジックには説明を追加
- 「なぜ」を説明する（「何を」はコードで明確に）

## Git規約

### コミットメッセージ
- 簡潔で明確な説明
- プレフィックスを使用
  - `feat:` 新機能
  - `fix:` バグ修正
  - `refactor:` リファクタリング
  - `docs:` ドキュメント更新
  - `chore:` その他

例：
```
feat: add speed change functionality for videos
fix: resolve caching issue in evaluation
docs: update README with lang parameter usage
```

## パフォーマンス

### ファイルI/O
- 大量のファイル操作は並列処理を検討
- ストリーミング処理が可能な場合は活用

### API呼び出し
- 可能な限りキャッシュを活用
- バッチ処理で呼び出し回数を削減
- レート制限に注意

## テスト

### 手動テスト
- 新機能追加時は必ずテストモードで確認
- `npm run start:test`でクイックテスト

### エッジケース
- 空のファイル
- 非常に短い/長い動画
- 特殊文字を含むファイル名

## 依存関係

### 新しいパッケージ追加時
1. 必要性を確認
2. メンテナンス状況を確認
3. ライセンスを確認
4. package.jsonに適切に追加

## その他

### ログ出力
- 進捗状況をわかりやすく表示
- 絵文字を適度に使用（視認性向上）
- エラーは`console.error()`で明確に

### ファイル命名
- kebab-case: `evaluate-only.ts`
- 機能が明確な名前を使用
- 省略形は避ける

## レビューチェックリスト

新しいコードを追加する際の確認事項：

- [ ] 関数は20行以内
- [ ] `const`を優先して使用
- [ ] `for`ループを関数型アプローチに置き換え
- [ ] `async/await`を使用（`.then()`は避ける）
- [ ] 適切なエラーハンドリング
- [ ] JSDocコメントを記述
- [ ] TypeScriptの型を明示
- [ ] README更新（必要な場合）

## リファクタリング優先事項

既存コードで改善が望ましい箇所：

1. 長い関数（20行超）を分割
2. `let`を`const`に変更（可能な場合）
3. `for`ループを`forEach`/`map`に置き換え
4. `.then()`を`async/await`に変換

---

このガイドラインに従うことで、保守性が高く、読みやすいコードを維持できます。