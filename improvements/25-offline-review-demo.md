# 25 — モデルなしで制作レビューの比較と照合を試す

`npm run demo:review`でビルドし、合成の制作資料を用意して、NPCの比較画面まで自動で開きます。起床後の確認やデモの操作練習に、ワールドの生成や認証を待つ必要がありません。既存のPlaywright・Electron・Zodを使い、依存は追加していません。

## 試し方

1. `npm run demo:review`を実行します。名前に「合成資料・モデル未使用」と表示された案内役の比較が開きます。
2. 「追加1件・削除1件・根拠変更1件」を確認します。「合意を大切にする」は文面が同じでも根拠の出来事が違う例です。「両側の根拠を見る」を開くと確認できます。
3. 下へスクロールし、Runtime向けの指針とRuntime Promptの変更を開きます。「比較レポートをコピー」で資料と参照hashを持ち出せます。
4. 左のファイル一覧で`compilation/current/npcs/sample/manifest.json`を選びます。5ファイルが一致し、「照合レポートをコピー」で照合結果を持ち出せます。
5. ウィンドウを閉じるとコマンドも終了します。再実行すると別のデモを作ります。

資料は`.local/review-demo-*/<runId>/`、Electronのprofileは同じデモ用ディレクトリの`electron-profile/`に保存します。正確な保存先はコンソールに表示します。既存ワールドを読み込まず、前のデモも上書き・削除しません。通常のデモ起動はクリップボードへ自動コピーしません。

実装は既存のレビュー・manifestスキーマとMarkdown出力を利用します。例の人物像をアプリの仕様にせず、ゲームのジャンル・座標系・組み込み先を制限するルールを追加していません。5ファイルはレビュー操作用の資料一式で、実際のCompilationが出力する完全なNPCパッケージではありません。`sample-input.json`と`sample-instructions.md`も手書きの例であり、実際にモデルへ送信した入力ではないと明記しています。manifestの入力・プロンプトhashは、その合成資料の実際のバイト列から計算します。

実際のAI生成、生活シミュレーションの品質、出来事QAのデモはこのコマンドに含みません。既存DemoEngineを使うため、認証・Codex CLI・モデル推論・APIキーは使用しません。

## 検証記録

対象はこの変更のスクリプト・npmコマンド・説明文です。ログは`.local/polish-20260914/`です。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0。既存TypeScript対象を検査 | `review-demo-typecheck.log` |
| `npm run lint` | exit 0、警告0。新しいmjsも対象 | `review-demo-final-lint.log` |
| `npm test` | exit 0、単体55・backend139件PASS | `review-demo-test.log` |
| `npm run test:review-demo` | exit 0、build成功、専用Electronシナリオ1件PASS | `review-demo-isolated-check.log` |
| `npm run demo:review` | exit 0、通常表示からウィンドウを閉じて正常終了 | `review-demo-isolated-visible.log` |

専用シナリオはprofileとワールドの保存先、差分3種類、比較レポートの実クリップボードJSONと両側の資料の一致、5ファイルの照合結果、照合レポートの実クリップボードJSON、rendererエラー0件を確認します。検証時はクリップボードを書き換えます。レポートと目視確認した画像は`.local/review-demo-cjDFzg/`の`persona-review-comparison.md`・`persona-package-inspection.md`・`review-demo.png`です。通常表示の検証資料は別の`.local/review-demo-Am2d7G/`へ作られました。

初回検証では、末尾に区切り文字を含む絶対パスをElectron起動引数に渡して起動が進まず、所有する検証プロセスだけを終了しました。作業ディレクトリと引数を分け、起動・操作の待ち時間にも上限を設定しています。次の検証では古いクリップボード内容を読んでassertionが失敗しました。アプリのコピー成功表示を待ってから読み取るよう修正しました。これらは失敗として`review-demo-check.log`・`review-demo-check-final.log`に残しています。初回lintの未定義globalも明示importなどで解消しています。

アプリ本体・IPC・CLI・保存処理は変更していないため、直前の[24](24-package-inspection-report.md)で通過したCLI接続8・保存復元4・既存Electron19件は再実行していません。既知の元のCLI native異常終了は未解決のままです。

## 戻し方

`git log --oneline -- improvements/25-offline-review-demo.md`でコミットを確認し、`git revert <commit>`で専用スクリプト・npmコマンド・説明を戻せます。既存のレビュー・比較・照合機能や保存形式には影響しません。作成済みの合成資料はGit管理外の`.local/`に残ります。
