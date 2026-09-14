# 20 — RPCの異常受信後に後続処理が続く不具合を修正

RPCクライアントは不正なメッセージを検出すると待機中の要求を拒否していましたが、WebSocketを維持していました。このため、接続失敗を通知した後にも通知・Tool要求を処理し、新しい要求を送信できる状態でした。

## 修正内容

接続失敗時は現在の接続参照を解除してWebSocketを終了し、待機中の要求をエラーで完了させます。切断したソケットから後続メッセージが届いても処理しません。古いソケットのerror・closeイベントが別の接続を失敗扱いにしないよう、現在の接続との一致も確認します。

自動再試行は追加せず、明示的な接続操作で復帰できます。不正なRPCの診断用causeと既存のエラー表示を維持します。既に開始したTool処理の取消しを保証する変更ではありません。ゲーム形態やToolの内容に固有の条件は追加していません。依存追加・保存形式変更はありません。

## 試し方

リポジトリルートで`npx vitest run --config vitest.backend.config.ts tests/backend/rpc.test.ts`を実行します。ローカルWebSocketとテスト用トークンで完結し、実モデルやユーザー認証情報は不要です。

新しい2ケースは、nullまたは壊れたJSONに続けて通知とTool要求を送ります。接続終了、後続処理の拒否、エラー通知が1回であること、新規要求の拒否、同じクライアントで明示的に再接続した後の正常応答を確認します。既存のRPC相関・認証エラーの秘匿・非同期Tool応答・中断確認も検証します。

## 検証記録

実行ディレクトリはリポジトリルート、ログは`.local/polish-20260914/`です。修正前は接続が残ることで5件中2件失敗・3件成功（exit 1、`rpc-failed-connection-before.log`）。修正後は対象5件すべて成功（exit 0、`rpc-failed-connection-after.log`）。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `rpc-failure-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `rpc-failure-lint.log` |
| `npm test` | exit 0、単体53・backend133件PASS | `rpc-failure-test.log` |
| `npm run test:connection` | exit 0、CLI/TUI接続8件PASS | `rpc-failure-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `rpc-failure-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全18件PASS | `rpc-failure-e2e.log` |

最終ソースで計216件PASS。実モデル推論・APIキー使用・既存ワールドの変更や削除は行っていません。今回の検証ではnative異常終了は再発しませんでしたが、[17](17-workspace-dot-prefix.md)で発生した終了コード`3221226505`は引き続き未解決です。この修正で解消したとは扱いません。

## 戻し方

`git log --oneline -- improvements/20-rpc-failed-connection.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ変換は不要ですが、異常受信後にも接続と後続処理が残る挙動も戻ります。
