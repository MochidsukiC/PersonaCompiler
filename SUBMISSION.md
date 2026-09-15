# Persona Compiler 提出版

> 以下は受領した提出版の記録です。記載の検証件数は提出時点のもので、本WTへの合流後の検証結果とは区別してください。

提出日: 2026-09-15

## 内容

AIによってNPCの人物情報、生活、会話、記憶、関係、世代交代を扱い、RPG等のゲーム開発で利用できるNPCデータを生成・検証するデスクトップツールです。

この提出物には以下を含みます。

- Electron/React製の設定・観察UI
- NPC生活シミュレーションHarness
- Tier別Scheduler
- 会話演出プロファイルと表現強度
- 固定・半固定・自由生成台詞
- クエスト段階・発火条件・場所固定
- 固定台詞の直接発話保証
- 半固定台詞のFact・証拠語検査とfallback
- 発話範囲、複数人会話、記憶、関係、世代交代
- 永続化・復元
- Unit、Backend、Electron E2Eテスト

## 起動準備

Node.jsを導入後、展開したディレクトリで次を実行します。

```powershell
npm install
npm run dev
```

## 検証

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

提出直前の検証結果:

- TypeScript型検査: 成功
- ESLint: 成功
- Unit: 38/38成功
- Backend: 116/116成功
- Electron E2E: 13/13成功
- Production build: 成功

## 主要資料

- `README.md`: プロジェクト概要と操作
- `PROJECT_MASTER.md`: 全体仕様
- `QUEST_GAME_ADAPTER.md`: ゲーム本体とのクエスト連携契約
- `LIFECYCLE.md`: 世代交代・生活周期
- `MEMORY.md`: 記憶システム
- `PERSISTENCE.md`: 保存・復元
- `IMPROVEMENT_REPORT.md`: 今回の改善内容、評価、保留事項

## 提出物から除外したもの

容量と再現性のため、以下の生成物はZIPに含めていません。

- `node_modules`
- `out`
- `test-results`
- ローカル実行状態
- パッケージマネージャーのキャッシュ

依存バージョンは`package-lock.json`に保存されています。

## 現状の位置づけ

ゲーム統合可能なHarnessと編集UIまで実装されています。Unity・Unreal等の個別ゲームエンジン用アダプターは、対象エンジン決定後に追加する想定です。
