# 24 — NPCパッケージの照合結果をMarkdownとJSONでコピー

成果物の照合画面に「照合レポートをコピー」を追加しました。ファイルをゲームへ組み込む担当者や実装用agentへ、何を・いつ照合し、どのファイルに差異があったかを渡せます。既存のSHA-256照合結果を使うため、追加のモデル推論は不要です。

## 含まれる情報

- ワールドID、NPC ID、世界revision、生成モデル、照合時刻
- 照合したmanifestの相対パスと、読み込んだバイト列のSHA-256
- manifestに記録された入力・プロンプトのhash
- 全ファイルの相対パス、一致／内容変更／欠損、期待hash、実際のhash、byte数
- 同じ照合結果を取り込める`persona-package-inspection/v1`のJSON

人が読めるMarkdownと機械処理用JSONを一つのレポートに含めます。ファイル本文はコピーしません。ファイル名・拡張子・ゲームエンジンを固定せず、manifestの項目をそのまま扱います。外部送信はせず、ユーザーの操作でクリップボードへコピーします。

コピーするのは表示中の照合結果です。最新状態を確認するときは先に「もう一度照合」を押します。再照合中と照合失敗時には古い結果のコピーボタンを表示しません。コピー失敗は既存の共通コントロールで明示します。

各ファイルは順番に読むため、全ファイルの同時刻snapshotではありません。入力・プロンプトのhashはmanifestの記録値で、その元資料を今回照合したという意味ではありません。manifestの真正性や生成内容の意味的な品質の評価とも区別しています。

## 試し方

1. 更新したアプリで、生成済みNPCの「成果物を照合」を開くか、ファイル一覧から`compilation/<id>/npcs/<npcId>/manifest.json`を選びます。
2. 照合が完了したら「照合レポートをコピー」を押し、テキストエディターへ貼り付けます。
3. 各ファイルの結果と、末尾のJSONを確認します。外部編集後は「もう一度照合」してから再度コピーします。

実モデルなしで試す場合は`npm run build`の後に`npx playwright test tests/e2e/package-inspection.spec.ts`を実行します。demo・codex両モードのfixtureが実IPCとElectronのクリップボードを操作し、正常結果・外部変更・欠損・不正manifestを確認します。実際のClipboard内容からJSONを復元して値を照合します。

## 検証記録

ログは`.local/polish-20260914/`にあります。単体検証では、異なるファイル形式の結果を情報を落とさずJSONへ収録することと、改行・Markdown・HTMLを含む文字列を本文で引用扱いにしつつ、JSONには元の値を残すことを確認します。backend検証では、実際に読んだmanifestのhash・入力hash・プロンプトhash・ワールドIDを確認します。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `package-report-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `package-report-lint.log` |
| `npm test` | exit 0、単体55・backend139件PASS | `package-report-test.log` |
| `npm run test:connection` | exit 0、CLI/TUI接続8件PASS | `package-report-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `package-report-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全19件PASS | `package-report-e2e.log` |

計225件PASS。新しいコピーボタン・成功表示・変更と欠損の一覧について、demo・codex両方のスクリーンショットを目視確認しました。画像は`package-report-demo.png`・`package-report-codex.png`、実クリップボードから取得したレポート例は`package-report-example.md`に保存しています。

実モデル推論・APIキー使用・既存ワールドの変更や削除は行っていません。今回の検証ではnative異常終了は再発しませんでしたが、[21](21-native-node-shutdown.md)の元のCLI異常終了は未解決です。

## 戻し方

`git log --oneline -- improvements/24-package-inspection-report.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。パッケージやワールドの保存形式は変更していないため、データ変換は不要です。既存の成果物照合機能は維持されます。
