# 38 — 保存待ち中に停止した制作処理を新たに開始しない

Compilation入力を保存している間に一時停止しても、保存が完了すると親の生成要求を新たに開始する競合を修正しました。不要な試運転を避けたい場合にも影響する、非同期処理の開始境界の不具合です。

## 原因と変更

親の制作処理は、開始可否の確認→親Conversationの状態取得→入力保存→操作記録の保存→入力hashの再確認→`runtime.startTurn`の順に動きます。従来は開始可否を最初にしか確認せず、その後の非同期I/O中に一時停止しても古い判定を使っていました。

開始可否を確認する同期callbackを`ParentProduction`へ渡し、処理の入口と`runtime.startTurn`を呼ぶ直前に実行します。書き込み可否・接続と認証・停止要求には、既存のBackendEngineの判定を使います。出生とCompilationの共通処理として適用し、ゲームのジャンルや終了条件の解釈は追加しません。

停止中の未送信要求は送信前の失敗として記録し、turnIdはnullのままです。送信結果不明の要求と混同せず、エラーを残します。既に成功した成果物は保持し、自動再送は追加しません。これは開始前の境界の修正であり、既に開始を依頼した推論を未送信へ戻す処理ではありません。

## 検証

修正前のBackendEngine fixtureでは、制作入力の書き込みを待機させて一時停止し、その後に保存を完了すると`npc0`への生成要求が1件発生しました。期待は0件で、検証はexit 1でした（`.local/polish-20260914/production-pause-before.log`）。

修正後はアプリ終了を呼ぶ前にCompilationが待機状態へ戻ること、生成要求0件、対象タスクに停止理由が残ることを確認します。出生・Compilationの両方では、入口で停止している場合の拒否、操作記録後に停止した場合の拒否、停止解除後の明示要求の成功も検証します。既存の入力hash検証、結果不明時の自動再送禁止、正常な出生・パッケージ生成は維持します。

作業ディレクトリーはプロジェクトルート、ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `production-pause-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `production-pause-lint.log` |
| `npm test` | 0 | 単体68・backend157件PASS | `production-pause-test.log` |
| `npm run test:e2e` | 0 | build成功・Electron 30件PASS（3.4分） | `production-pause-e2e.log` |
| `npm run test:connection` | 0 | 実CLI＋localhost fixture 8件PASS | `production-pause-connection.log` |
| `npm run test:persistence` | 0 | 保存worker 4件PASS | `production-pause-persistence.log` |

合計267件PASSです。既知のnative異常終了は今回の検証では再発していませんが、今回の修正による解決とは扱いません。

実モデル推論・APIキー使用・既存ワールドの変更はありません。外部操作の開始前に既存の権限判定を再確認する変更で、許可条件・保存形式・生成プロンプト・依存関係は変更していません。

## 試し方・戻し方

タイミング依存のため、`npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts`でローカルfixtureを実行すると確認できます。手動では制作入力保存中に一時停止した場合、未送信の制作処理が停止理由付きで残ります。必要なら停止が確定してから「再生成」で別のCompilationを作成します。

`git log --oneline -- improvements/38-production-pause-boundary.md`でコミットを確認し、`git revert <commit>`で戻せます。再buildは`npm run build`です。データ移行はありません。
