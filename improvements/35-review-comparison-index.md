# 35 — 長い根拠を含む制作レビュー比較の計算を削減する

再生成前後の制作レビュー比較で、同じ根拠の本文を何度もJSON化し、設定一覧を繰り返し走査する処理を削減しました。画面の比較と比較レポートの両方に使う共通処理です。

## 原因と変更

従来は設定の対応候補を探すたびに、根拠のID・題名・本文をJSON化して比較していました。同文の設定が複数あり、根拠が変わった場合は候補を繰り返し調べるため、資料が長くなるほど計算量が増えていました。

今回、根拠の内容を比較処理内で一度ずつ索引へ登録し、設定も区分・本文・根拠の組み合わせで索引化しました。完全一致する設定を先に確定してから、同じ区分・本文の設定の根拠変更を対応付けます。重複設定の対応順、削除・根拠変更・追加の出力順は維持します。

判定は文字列と参照内容の一致です。ゲーム形式・資料IDの命名規則・ゲーム内の意味を判定する条件は追加していません。入力資料を変更せず、索引は比較処理内だけで使います。保存形式・比較結果の形式・モデル呼び出しは変更していません。

## 処理時間の確認

`node diagnostics/review-comparison-benchmark.mjs`で、ローカルの合成資料を使った比較計算を測れます。2条件を各3回実行し、全件が期待どおり根拠変更として返ることもassertします。性能の固定閾値や自動テストの除外は追加していません。

同じ最終計測コードを使い、import先だけを変更して修正前のHEADの関数と比較しました。Windows・Node v24.15.0での結果です。

| 合成資料 | 修正前の中央値 | 修正後の中央値 |
|---|---:|---:|
| 異なる本文の設定300件・根拠64KB | 52.337ms | 1.012ms |
| 同文の設定120件・根拠16KBが変更 | 203.540ms | 0.277ms |

記録は`.local/polish-20260914/review-comparison-performance-before-final.json`と`review-comparison-performance-after-final.json`です。これは同じ端末上の合成資料による比較関数の計測で、ファイル読み込み・React描画・モデル生成を含むアプリ全体の応答時間ではありません。実ワールドの作業時間短縮率とはしていません。

## 検証記録

既存の比較検証に加え、同文設定の完全一致を優先した対応付け・変更の並び順・入力を変更しないこと・区切り文字や`__proto__`を含む任意ID・根拠題名の変更を検証しました。

初回lintでは診断スクリプトのNode globalsが未定義となりました。Nodeのimportを明示し、計測対象外のfixture構築も調整して再検証しました。lintの設定は変更していません。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `comparison-index-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `comparison-index-lint-final.log` |
| `npm test` | exit 0、単体63・backend154件PASS | `comparison-index-test.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全27件PASS | `comparison-index-e2e.log` |

最終コードで計244件PASS。画面の比較、根拠の外部更新、比較レポートの実クリップボード、検索・移動などの既存E2Eも含みます。ログは`.local/polish-20260914/`です。今回の実行ではnative異常終了は再発しませんでした。

実モデル推論・APIキー使用・既存ワールド変更はありません。通信・保存処理は変更していないため、[33](33-rpc-response-validation.md)で成功した実CLI接続8件・保存4件は今回は再実行していません。native異常終了の未解決記録は[33](33-rpc-response-validation.md)・[34](34-native-diagnostic-deadline.md)に残しています。

## 試し方と戻し方

通常の「別の出力と比較」と「比較レポートをコピー」で使われます。既存の資料を再生成する必要はありません。計算量を確認したい場合は上記benchmarkを実行してください。

`git log --oneline -- improvements/35-review-comparison-index.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
