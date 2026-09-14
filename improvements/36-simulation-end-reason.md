# 36 — 保存された終了理由を概要にも表示する

シミュレーションが初期世代の全員死亡・全住民死亡で終了した場合も、上部概要に「ターン上限に到達しました」と表示する不具合を修正しました。

## 原因と変更

概要は`stage === 'ended'`だけを見て、終了理由を固定文字列で表示していました。一方、住民パネルは保存された`lifecycle.endReason`を表示しており、同じ画面の中で説明が食い違っていました。

終了理由の表示を共通化し、概要も保存値を使います。

| 保存値 | 表示 |
|---|---|
| `turn_limit` | 指定ターンに到達 |
| `generation_zero_extinction` | 初期世代の全員死亡 |
| `population_extinction` | 全住民死亡 |
| 終了理由なし・lifecycleのない旧形式 | シミュレーションが終了しました |

時刻・人口・設定された終了条件から理由を推測する処理は追加していません。シミュレーションが終了する条件や、ゲーム内のルールは変更していません。旧形式に存在しない理由を補完するデータ移行もありません。

## 検証

最初のE2Eでは初期画面の読み込みが完了する前にfixtureを配信し、表示対象が見つかりませんでした（exit 1、`end-reason-before.log`）。初期画面を待つよう検証を修正した後、実際に「全住民死亡」の入力に対して「ターン上限に到達しました」と表示されることを再現しました（exit 1、`end-reason-before-ready.log`）。

追加した画面検証では、3種類の理由と、終了理由null・lifecycleなしの2ケースを順に表示します。概要と住民パネルの文言の一致、理由なしで推測を表示しないことを確認します。

変更後の状態をプロジェクトルートで検証しました。ログは`.local/polish-20260914/`に保存しています。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `end-reason-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `end-reason-lint.log` |
| `npm test` | 0 | 単体63・backend154件PASS | `end-reason-test.log` |
| `npm run test:e2e` | 0 | build成功・Electron 28件PASS（3.1分） | `end-reason-e2e.log` |

合計245件PASSです。終了理由のスクリーンショットも確認し、概要と住民パネルの「全住民死亡」が一致しています（`simulation-end-reason.png`）。以前のnative異常終了は今回再発しませんでしたが、この表示修正によって解消したとは扱いません。

実モデル推論・APIキー使用・既存ワールド変更はありません。設定画面のレビューから見つかった表示不具合であり、試運転は行っていません。通信・保存処理は変更していないため、[33](33-rpc-response-validation.md)で成功した実CLI接続8件と保存4件は今回は再実行していません。

## 試し方と戻し方

終了済みのワールドを開くと、接続・認証済みの概要に保存された終了理由が表示されます。モデルを使わず確認する場合は、build後に`npx playwright test tests/e2e/simulation-end-reason.spec.ts`を実行できます。

`git log --oneline -- improvements/36-simulation-end-reason.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
