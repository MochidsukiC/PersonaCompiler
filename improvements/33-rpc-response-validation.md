# 33 — 結果のないRPC応答を完了扱いにしない

IDだけを持ち、結果もエラーもないRPC応答を受けたとき、要求を完了扱いにする不具合を修正しました。結果とエラーの両方を持つ応答も不正として接続を終了します。

## 原因と変更

RPCクライアントは`result`を任意として読み込み、エラーがなければ要求を成功扱いにしていました。端末中継もIDとmethodだけを検証し、対応するIDがあれば終了時の返答待ちから要求を消していました。そのため`{"id":7}`のような不完全な応答で、確認すべき要求が未確定の一覧から消える経路がありました。

[JSON-RPCの応答仕様](https://www.jsonrpc.org/specification#response_object)は、応答にresultまたはerrorのどちらか一方を含めるよう定めています。RPCクライアントと端末中継の共通schemaで、応答ID・結果とエラーの排他性・エラーの基本形を検証します。`null`・`false`・`0`・空文字の正常な結果は保持します。

端末中継では、不正応答で接続を終了した後に同じ接続から届くフレームも処理しません。不正応答の直後に正常そうな応答が続いても、未確定の要求は保持し、正常終了とは扱いません。新たな推論や自動再送は追加していません。

接続先・認証・モデル設定は変更していません。App Serverで既に使われている、jsonrpcフィールドを省いたメッセージ形式も引き続き受け入れます。JSON-RPC仕様全体への準拠を新たに強制する変更ではありません。ゲーム内の行動やゲーム形式に依存する処理も追加していません。

## 試し方

`npx vitest run --config vitest.backend.config.ts tests/backend/rpc.test.ts tests/backend/terminal-relay.test.ts`で、localhostのWebSocket fixtureから確認できます。

追加した拒否ケースは、RPCクライアントで結果欠落・両方ありの2件、端末中継で結果欠落・両方あり・不正なエラー型の3件です。中継では後続の応答も送り、未確定要求が残ることを確認します。既存の返答待ち検証は正常な結果5種へ広げました。

通常の利用では操作変更はありません。不正な応答を受けた場合は接続エラーとして明示し、要求結果を推測して保存を進めません。

## 検証記録

ログは`.local/polish-20260914/`です。修正前は追加5件FAIL・既存11件PASSでした（exit 1、`rpc-response-before.log`）。修正後は16件PASSでした（exit 0、`rpc-response-after.log`）。その後、正常結果5種を確認する4ケースを増やし、全体回帰へ含めました。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `rpc-response-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `rpc-response-lint.log` |
| `npm test` | exit 0、単体61・backend154件PASS | `rpc-response-test.log` |
| `npm run test:connection` | exit 0、実CLI接続8件PASS | `rpc-response-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `rpc-response-persistence.log` |
| `npm run test:e2e`のbuild部分 | build成功。初回のE2E失敗は下記 | `rpc-response-e2e.log` |
| 同一ビルドで`npx playwright test` | exit 0、Electron全27件PASS | `rpc-response-e2e-final.log` |

最終コードで計254件PASSを確認しました。初回の全体E2E失敗を取り消す意味ではなく、native異常終了は以下の未解決記録として残しています。実CLI接続の推論先はlocalhostのResponses fixtureです。

初回の全体E2Eでは26件PASS・1件FAILでした（exit 1、`rpc-response-e2e.log`）。`review-evidence-navigation.spec.ts`のDemoケースが0msの時点で、Playwright workerの終了コード`3221226505`（`C0000409`）により失敗しました。直前の比較2件は成功し、次のCodexケース以降は別workerで成功しました。RPC拒否のassertion失敗ではありませんが、RPC修正と無関係だと証明できたわけでもありません。

直前の比較と根拠移動の4件を既存native診断配下で実行した結果は4件PASS・exit 0、`root-exit=00000000 captured=0 timeout=0`でした。ログは`rpc-response-native-e2e.log`と`.stdout.log`です。実ユーザーアプリへattachしていません。今回の例外のstackは取得できず、以前のCLI worker異常終了と同一原因かは未確認です。診断で再発しないことを修正の証明とはしません。

非信頼のRPCメッセージを受信してから、要求の確定・終了待ちに反映するまでの経路をレビューしました。検証失敗の説明に受信本文や認証情報を埋め込まず、不正応答を無視して処理を続けるfallbackも追加していません。

実モデル推論・APIキー使用・既存ワールド変更はありません。以前のnative異常終了は別件として、[21](21-native-node-shutdown.md)に記載した未確認部分が残ります。

## 戻し方

`git log --oneline -- improvements/33-rpc-response-validation.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。ワールドの移行は不要です。
