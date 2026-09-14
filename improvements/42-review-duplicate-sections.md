# 42 — 同名の区分がある制作レビューで検索対象外の設定が残る不具合を修正

制作レビューの形式では同じ見出しの区分を複数保存できますが、画面は見出しをReactの識別子にしていました。重複した見出しがある資料を検索すると、件数は正しく「1 / 3件」へ変わる一方、対象外の設定が画面に残ることを両モードで再現しました。

## 変更

区分の識別に、読み込んだ資料内の位置を使います。検索で空になった区分も元の位置を保って処理し、対象の設定だけを描画します。見出しの一意性を要求したり、同名の区分を統合したりしません。ゲームごとの独自の分類や、複数経路で同じ見出しを使う資料も、そのまま扱えます。

保存形式・検索条件・レポート形式・根拠のIDは変更していません。

## 再現と検証

合成資料に「判断」「判断」「台詞」の3区分を置き、「台詞」の設定だけに一致する語で検索しました。修正前は「観察して待つ」が余分に残り、「補助の返答を使う」と合わせて2件表示されました。Demo/Codexとも同じassertionで失敗し、exit 1でした（`review-duplicate-sections-before.log`）。この失敗はnative異常終了ではなく、画面の内容の不一致です。

修正後は同じ2件がPASS・exit 0です。検索条件の変更、同名区分だけの表示、1件ずつの絞り込み、0件、全件への復帰で、画面本文・表示件数・実クリップボードのJSONを突き合わせました。根拠資料からの検索と、正しい資料を開く操作も確認しています。

対象状態は本変更後、実行場所はプロジェクトルート、ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `review-duplicate-sections-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `review-duplicate-sections-lint.log` |
| `npm run build` | 0 | 成功。既存のzod注釈に関するRollup警告あり | `review-duplicate-sections-build.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/review-duplicate-sections.spec.ts` | 0 | 2件PASS、25.6秒 | `review-duplicate-sections-after.log` |
| `npm test` | 0 | 単体68・backend170件PASS | `review-duplicate-sections-test.log` |
| `node node_modules/@playwright/test/cli.js test`（同じbuild） | 0 | Electron全32件PASS、4.7分 | `review-duplicate-sections-e2e.log` |

最終状態は計270件PASSです。既存の比較・検索・根拠への移動・外部変更の反映・照合・保存・端末の画面操作も含む全体回帰が成功しました。今回の実行ではnative異常終了は再発しませんでしたが、過去の異常終了を解消した証明とは扱いません。

修正前のtraceは`review-duplicate-sections-before-demo.zip`と`review-duplicate-sections-before-codex.zip`、修正後の画面は`review-duplicate-sections-demo.png`と`review-duplicate-sections-codex.png`へ保存しました。Codex側の画像を開き、1件の表示と対応する根拠を確認しました。

実モデル推論・APIキー使用・既存ワールド変更はありません。CLI・保存実装は変更していないため、専用の接続8件・保存4件は今回再実行していません。過去のnative異常終了は、この描画修正で解決したとは扱いません。

## 試し方・戻し方

`npm run build`の後、上記のE2Eコマンドで合成資料を使って確認できます。通常の操作では、同名の区分がある`review.json`を開いて一部の設定だけを検索し、件数・画面・「設定の検索レポートをコピー」の内容が一致することを確認してください。

`git log --oneline -- improvements/42-review-duplicate-sections.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
