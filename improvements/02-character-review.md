# 02 — NPC制作レビュー

## 目的

生成NPCをゲームに採用する前に、人格・話し方・行動・予定の根拠を確認できるようにしました。手書きの設定作成だけでなく、生成後のレビュー工程までつなぐTrack 2向けの改善です。期待する貢献は実用性と完成度で、審査の加点を保証するものではありません。

## 試し方

1. 更新後に生成されたCompilationのNPCから「制作レビュー」を開きます。
2. 「人格」「約束」などで設定を検索します。
3. 「根拠 1」などをクリックすると、Compilation時点の出来事・記憶・方向別関係・Conversationを表示します。
4. 下部の「Runtime向けの指針」「Runtime Prompt」を開いて、採用する人物設定と照合します。
5. 保存フォルダーの`review.md`でレポートを持ち出せます。

実モデルを使わず動作を確認するコマンド: `npm run build`の後に`npx playwright test tests/e2e/lifecycle.spec.ts`。人物・資料は明示的なfixtureです。E2Eの画像は`test-results/lifecycle-shows-ages-decea-97282-atically-generated-packages/compiled-lifecycle.png`に出ます。

## 保存・互換性

- 従来の6成果物に`review.json`と`review.md`を追加し、既存manifestのhash対象に含めます。
- 追加のAI推論はありません。検証済みのCompilation結果と本人の保存資料から機械的に作ります。
- 引用された根拠だけを収録し、Runtime向け指針は観測事実と分けて表示します。
- 旧パッケージはそのまま開けます。レビューのない既存出力へボタンを表示せず、保存状態の自動移行・既存成果物への追記はしません。
- 参照の存在を確認しても、文章と根拠の意味的な一致は保証できません。画面にもこの区別を表示します。

## 検証・自己レビュー観点

cwd: リポジトリルート。ログ: `.local/polish-20260914/`。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | PASS | `typecheck-review.log` |
| `npm run lint` | 0 | PASS、警告0 | `lint-review.log` |
| `npm test` | 0 | 単体38・backend117件PASS | `test-review.log` |
| `npm run test:e2e` | 0 | build・13件PASS | `e2e-review.log` |

基盤の接続7件・保存4件は01の検証を継承します。新規IPC、認証、外部通信、保存Workerの変更はありません。追加テストは根拠と資料の一致、欠損・重複参照の拒否、生成ファイルのhash、検索、根拠表示、破損JSONの明示、HTMLを実行しない表示を確認します。Markdown出力もHTMLとMarkdown構文をescapeします。E2Eスクリーンショットを目視確認しました。

## 戻し方

`git log --oneline -- improvements/02-character-review.md`でこの機能のコミットを確認し、`git revert <commit>`してください。生成済みレビューはディスク上に残り、従来の人物・記憶・関係・行動・予定・Promptファイルは利用できます。
