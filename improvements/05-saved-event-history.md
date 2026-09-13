# 05 — 過去の全保存履歴から出来事を検索

直近200件から消えた出来事も、「出来事」画面の「保存済み履歴を検索」で調べられます。NPCが序盤に交わした約束や、声が誰にも届かなかった場面を、保存済みの全期間から検索できます。追加のモデル推論はありません。

## 試し方

1. 保存形式version 2の生活ワールドで「出来事」を開きます。接続前・閲覧専用状態でも使えます。
2. 住民・種別・ターン・本文を指定して「保存済み履歴を検索」を押します。複数条件はANDで適用します。ターン0も指定できます。
3. 100件ずつ「次の100件」「前の100件」で移動します。最初の検索時の保存revisionを維持するため、実行中に保存が増えても重複・欠落しません。
4. 条件変更後や最新の保存を調べたい場合は再検索します。「直近の出来事に戻る」で自動更新の表示へ戻ります。

確定保存された出来事が対象です。未保存の出来事は直近表示で確認するか、既存の「今すぐ保存」を使用してください。現在の住民名・施設名で照合します。受信対象は既読・記憶化の保証ではありません。

## 実装・互換性

既存の保存manifestと履歴segmentを読取専用で参照します。保存形式や既存データ、推論、配信は変更しません。IPCは既存のメインフレーム制限と入力Schema検証を通り、任意のファイルパスは受け付けません。runId・履歴hash・revision・出来事連番の不一致は明示的に失敗します。

検索は全対象segmentを走査し、画面へ返す出来事は100件に制限します。大規模履歴では走査時間が増えます。入力中にはディスク検索せず、検索ボタンで実行します。画面を離れた後の遅い応答は表示に反映しません。

## 検証

cwdはリポジトリルート。変更後ソースで実行し、以下すべてexit 0。ログは`.local/polish-20260914/history-*.log`。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | PASS | `history-typecheck.log` |
| `npm run lint` | PASS、警告0 | `history-lint.log` |
| `npm test` | 単体40・backend120件PASS | `history-test.log` |
| `npm run test:connection` | localhost fixtureで7件PASS | `history-connection.log` |
| `npm run test:persistence` | native Worker 4件PASS | `history-persistence.log` |
| `npm run test:e2e` | build・Electron 14件PASS | `history-e2e.log` |

合計185件PASS。240件の履歴と追加保存を使い、固定revisionで全ページを結合して重複・欠落がないこと、古い発話・受信対象・ターン0の複合検索、改変拒否をbackendで確認しました。画面では検索・ページ送り・閲覧専用・失敗表示・遅い応答の無視を確認し、スクリーンショットを目視しました。

## 戻し方

`git log --oneline -- improvements/05-saved-event-history.md`でこの機能のコミットを確認し、`git revert <commit>`してください。元の直近200件の出来事表示へ戻ります。
