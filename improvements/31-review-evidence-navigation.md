# 31 — 同じ根拠を再選択したときも資料へ移動する

制作レビューで根拠を開き、設定一覧へスクロールで戻った後、同じ根拠を押しても資料へ移動しない不具合を修正しました。別の設定が参照する同じ資料でも、同じボタンの再選択でも、根拠の位置へ移動します。

## 原因と変更

従来は選択した資料IDが変わったときだけスクロールしていました。同じIDの再選択ではReactのstateが変わらず、資料は一覧の下に表示されたまま、画面外に残っていました。

選択状態をクリックごとに更新し、資料の表示が反映された後に既存のスクロール処理を実行します。資料IDの命名規則や、ゲームの種類・場面に応じた条件分岐は追加していません。保存資料の構造、検索条件、モデル呼び出しは変わりません。

## 試し方

設定の多い制作レビューを開いて「根拠」を押し、資料を表示します。設定一覧の上へスクロールで戻り、同じ資料を参照する根拠ボタンを押してください。再び資料へ移動します。同じボタンを繰り返し押した場合も確認できます。

`npx playwright test tests/e2e/review-evidence-navigation.spec.ts`で、Demo・Codex両モードの隔離した合成資料から再現できます（先に`npm run build`）。36件の設定が共通の`script:Route-A/phase-9`を参照するfixtureを使い、初回表示、別の設定からの再選択、同じボタンの再選択、閉じる操作を検証します。判定には資料見出しが画面内に入ることを使います。

## 検証記録

ログは`.local/polish-20260914/`です。修正前は両モードとも再選択後の資料見出しが画面外に残り、2件FAILでした（exit 1、`evidence-navigation-before.log`）。修正後は同じ検査で2件PASSです（exit 0、`evidence-navigation-after.log`）。

`evidence-navigation-demo.png`、`evidence-navigation-codex.png`を目視し、再選択後に資料の題名・ID・本文と閉じるボタンが画面内に表示されることも確認しました。

| command | 結果 | log |
|---|---|---|
| `npm run build` | exit 0 | `evidence-navigation-build.log` |
| `npm run typecheck` | exit 0 | `evidence-navigation-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `evidence-navigation-lint.log` |
| `npm test` | exit 0、単体55・backend145件PASS | `evidence-navigation-test.log` |
| `npx playwright test` | exit 0、Electron全25件PASS | `evidence-navigation-e2e.log` |

最終コードの同じビルドで画面検証を実施し、今回の全体回帰は計225件PASSでした。既存の検索・比較・プレビュー・保存終了の画面検証も含みます。

実モデル推論・APIキー使用・既存ワールド変更はありません。認証・保存・CLI接続処理は変更していないため、直前の[30](30-relay-disconnected-ack.md)で成功したCLI接続8件・保存4件は今回は再実行していません。

## 戻し方

`git log --oneline -- improvements/31-review-evidence-navigation.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
