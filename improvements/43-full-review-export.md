# 43 — 読み込み済みの制作レビュー全体を持ち出す

`review.md`はCompilation時に保存されるレポートで、`review.json`を外部編集しても更新されません。また、既存の検索レポートは設定と根拠の抜粋で、Runtime向けの指針・Runtime Promptは含みません。ゲームへの組み込み時に、いま確認している設定と実行用の文面を一緒に渡せるようにしました。

## 追加した操作

制作レビュー上部の「制作レビュー全体をコピー」で、検索中でも全設定・全根拠資料・Runtime向けの指針・Runtime PromptをMarkdownとJSONでコピーできます。元ファイルのパスとSHA-256、ワールドID、採取時刻を付けます。

区分名や根拠IDにゲーム固有の制約を追加せず、空の区分・同名の区分・未引用の資料も保持します。ジャンルやゲームエンジンへの変換は行いません。形式名は`persona-review-full/v1`です。

コピー対象は読み込み済みの制作レビューです。コピー時の再読み込みや、生成時の`review.md`の上書きは行いません。画面の案内も「review.mdは生成時のレポート」と明示しました。JSONは検証済みの既知の項目を収録し、元ファイルの整形や未知の項目は保持しません。hashは元ファイル全体の値です。

## 起床後の試し方

1. `npm run demo:review`で認証不要の合成デモを開きます。
2. 制作レビューの上部へスクロールし、「制作レビュー全体をコピー」を押します。
3. テキストエディターへ貼り付け、設定・根拠・指針・Promptと末尾のJSONを確認します。
4. 検索で0件に絞って再度全体コピーしても、全項目を収録します。検索結果だけが必要な場合は、既存の「設定の検索レポートをコピー」を使います。

外部編集を試す場合は、デモの`compilation/current/npcs/sample/review.json`の設定やPromptを編集し、画面の更新を確認してコピーしてください。生成時の`review.md`はそのまま残ります。デモの保存先は起動時に表示され、実行ごとに隔離します。

## 検証

作業場所はプロジェクトルート、ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 最終状態で成功 | `review-full-typecheck-final.log` |
| `npm run lint` | 0 | 最終状態で警告0・成功 | `review-full-lint-final.log` |
| `npm run build` | 0 | 最終状態で成功。既存のzod注釈に関するRollup警告あり | `review-full-build-final.log` |
| `npm test` | 0 | 単体71・backend170件PASS | `review-full-test.log` |
| `node node_modules/vitest/vitest.mjs run` | 0 | 改行処理の最終調整後、単体71件PASS | `review-full-unit-all-final.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/review-full-report.spec.ts` | 0 | Demo/Codexの2件PASS、16.7秒 | `review-full-e2e-focused.log` |
| `node scripts/review-demo.mjs --check`（最終build） | 0 | 全体・レビュー比較・成果物照合・ファイル比較の4レポートを実クリップボードで検証 | `review-full-demo-check.log` |
| `node node_modules/@playwright/test/cli.js test`（最終build） | 0 | 全34件PASS、4.7分 | `review-full-e2e-final.log` |

最終状態は単体71・backend170・Electron E2E34の計275件PASSに加え、デモの4レポート検証が成功しました。今回はnative異常終了は再発しませんでしたが、過去の異常終了の解消を証明する結果ではありません。

追加した単体3件は、全項目と空・重複区分・未引用資料の保持、空のレビュー、任意のメタデータ・見出し・根拠ID・Promptに含まれるHTML/Markdown/CR改行の引用とJSONへの値の保持を確認します。外部の文字列は固定見出しの下で引用し、JSONはコードブロック内に保存します。新たな外部通信・ファイル保存権限・依存追加はありません。

最初の単体実行は2件PASS・1件FAILでした（`review-full-unit.log`）。`<img src=x`という部分文字列の禁止判定が、正しくエスケープされた`\<img src=x`にも一致したためです。禁止対象を完全な未エスケープのHTMLタグへ修正し、エスケープ後の引用形式とJSONの厳密一致も確認して3件PASSとなりました（`review-full-unit-final.log`）。最終的にCRだけの改行も引用範囲から外れないよう処理し、単体全71件を再検証しました。

画面の追加2件では、検索0件での全項目コピー、外部編集後の設定・根拠・Promptと新しいhash・採取時刻、元の`review.md`を保持すること、コピー失敗の表示と再試行、不正JSONでコピーを表示しないことを確認します。最初の画面とレポートは`review-full-demo.png`/`.md`、`review-full-codex.png`/`.md`へ保存し、Demo画像を開いて確認しました。

最終buildの画面とレポートは`review-full-demo-final.png`/`.md`、`review-full-codex-final.png`/`.md`です。Codex側の最終画像も開き、全体コピーと検索レポートの操作が区別できることを確認しました。

最終デモ検証の成果物は`.local/review-demo-barEd6/`にあり、`persona-review-full.md`へ全体コピーの実出力を保存しました。全内容と元資料のhashを照合しています。

実モデル推論・APIキー使用・既存ワールド変更はありません。CLI・保存実装は変更していないため、専用の接続8件・保存4件は今回再実行していません。過去のnative異常終了をこの機能で解決したとは扱いません。

## 戻し方

`git log --oneline -- improvements/43-full-review-export.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
