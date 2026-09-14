# 30 — 切断した端末の返答待ちをすぐエラー終了する

端末から送ったCLI要求の返答を受け取る前に接続が切れた場合、終了操作が一律30秒待っていた処理を修正しました。返答を受け取れない接続だと確定した時点で、要求のmethodとIDを含むエラーを返します。

## 原因と範囲

終了処理は、CLIの変更要求に対する返答を確認してから保存へ進みます。従来の中継処理は、接続が閉じたことを待機中の終了処理へ伝えていませんでした。そのため、返答が来る可能性のない接続でも30秒の期限まで待っていました。

今回、未返答の要求へ接続終了を記録し、待機中の終了処理を起こします。終了操作より前に切断した場合にも、同じ具体的なエラーを返します。要求の本文や認証情報はエラーに含めません。

返答不明の要求は保持します。終了をキャンセルして入力を再開しても、不明な要求を完了扱いにしません。接続が生きている場合の返答待ちと30秒の期限は従来どおりです。ゲーム形式やゲーム内の行動には依存しない、通信と保存の共通処理です。

## 試し方

`npx vitest run --config vitest.backend.config.ts tests/backend/terminal-relay.test.ts`で、localhostのWebSocket fixtureから確認できます。終了操作の前・途中で返答前の接続を切り、即時のエラー、要求ID、保存成功としないこと、入力再開後も未確定状態が残ることを確認します。実モデル推論は不要です。

通常の利用では、CLI要求の返答前に端末接続が切れた際の終了エラーが早く表示されます。終了エラーが出た場合の既存の操作手順は変わりません。

## 検証記録

ログは`.local/polish-20260914/`です。修正前は追加した2件が失敗し、既存4件は成功しました（exit 1、`relay-disconnect-before.log`）。修正後は対象6件が成功しました（exit 0、`relay-disconnect-after.log`）。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `relay-disconnect-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `relay-disconnect-lint.log` |
| `npm test` | exit 0、単体55・backend145件PASS | `relay-disconnect-test.log` |
| `npm run test:connection` | exit 0、実CLI接続8件PASS | `relay-disconnect-connection.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全23件PASS | `relay-disconnect-e2e.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `relay-disconnect-persistence.log` |

最終コードで計235件PASS。実CLI接続検証の推論先もlocalhostのResponses fixtureです。実モデル推論・APIキー使用・既存ワールド変更はありません。以前のnative異常終了は今回再発していませんが、[21](21-native-node-shutdown.md)に記載した原因の未確認部分は残っています。

## 戻し方

`git log --oneline -- improvements/30-relay-disconnected-ack.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。ワールドや認証情報の移行は不要です。
