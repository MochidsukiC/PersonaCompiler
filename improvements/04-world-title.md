# 04 — サイドバーの町名を現在のワールドと一致させる

左サイドバーの町名が、どのワールドでも「木漏れ日の町」になる不具合を修正しました。地図と同じ現在の町名を表示し、地図未生成時は「新しいシミュレーション」と表示します。長い町名は省略表示し、ホバーで全文を確認できます。

別の名前のワールドを開き、ヘッダー・地図と左サイドバーの名前が一致することを確認してください。

保存・生成・モデル呼び出しの変更はありません。操作テストで修正前の名前不一致を再現しました（`.local/polish-20260914/world-title-reproduction.log`、exit 1）。

## 最終検証

cwd: リポジトリルート。すべて修正後の最終ソースで実行。ログ: `.local/polish-20260914/`。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | PASS | `typecheck-final.log` |
| `npm run lint` | 0 | PASS、警告0 | `lint-final.log` |
| `npm test` | 0 | 単体40・backend117件PASS | `test-final.log` |
| `npm run test:connection` | 0 | 7件PASS、localhost fixture | `connection-final.log` |
| `npm run test:persistence` | 0 | 4件PASS | `persistence-final.log` |
| `npm run test:e2e` | 0 | build・13件PASS | `e2e-final.log` |

合計181テストがPASSです。既存依存zodのRollup注釈警告は残っています。抑制・依存更新は行っていません。

## 戻し方

`git log --oneline -- improvements/04-world-title.md`でこの修正のコミットを確認し、`git revert <commit>`してください。
