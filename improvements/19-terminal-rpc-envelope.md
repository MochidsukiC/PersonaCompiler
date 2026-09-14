# 19 — 不正なRPC受信で端末中継が未処理例外になる不具合を修正

端末中継がJSONとしては有効な`null`を受信すると、`message.params`または`message.method`の参照で未処理例外になっていました。端末からの入力とApp Serverからの応答の両方をローカルWebSocketで再現し、受信境界で形式を検証するよう修正しました。

## 修正内容

JSONの構文だけでなく、最上位がオブジェクトであること、存在する`id`が文字列または数値、`method`が文字列であることを確認します。端末からの`params`はオブジェクト・null・省略を許可します。App Server側の`params`や`result`などの本文には新しい制約を加えません。

端末からの不正メッセージは当該接続をコード1007で終了し、上流へ転送しません。App Serverからの不正メッセージは具体的な接続エラーを通知し、その接続を終了します。診断用の`cause`を保持し、ユーザー向けエラーに受信本文は含めません。別の正常な接続は引き続き利用できます。

既存のZodを使い、未知の追加フィールドは正常メッセージ内に保持します。認証、閲覧専用の制約、モデル・effort固定、終了時の処理待ちは維持しています。ゲーム形態・NPC属性・Tool固有の内容には依存しません。依存追加・保存形式変更はありません。

## 試し方

リポジトリルートで`npx vitest run --config vitest.backend.config.ts tests/backend/terminal-relay.test.ts`を実行します。localhostのサーバーとテスト用トークンで完結するため、実モデルやユーザー認証情報は不要です。

端末側9種類・上流側7種類の不正メッセージを送り、未処理例外を起こさず接続を終了することを確認します。対象には壊れたJSON、null、配列、真偽値、文字列、不正なID・method、端末側の不正なparamsを含みます。その後の正常接続では追加フィールドを含むメッセージを往復させます。既存の認証・モデル固定・終了待ちの検証も実行します。

## 検証記録

実行ディレクトリはリポジトリルート、ログは`.local/polish-20260914/`です。

修正前は4件中2件失敗・2件成功、未処理のTypeErrorが2件（exit 1、`relay-envelope-before.log`）。修正後の対象4件は成功（exit 0、`relay-envelope-after.log`）。その後、エラー原因の保持を追加した最終ソースでも正式backend検証を通しています。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `relay-envelope-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `relay-envelope-lint.log` |
| `npm test` | exit 0、単体53・backend131件PASS | `relay-envelope-test.log` |
| `npm run test:connection` | exit 0、CLI/TUI接続8件PASS | `relay-envelope-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `relay-envelope-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全18件PASS | `relay-envelope-e2e.log` |

最終ソースで計214件PASS。CLI/TUIの実プロトコルで正常なメッセージが通ることも確認しています。今回の正式検証ではnative異常終了は再発しませんでした。

## native異常終了との区別

今回のTypeErrorは[17](17-workspace-dot-prefix.md)のnative終了コード`3221226505`とは別の再現済み不具合です。native異常終了の解消とは扱いません。

native調査では、失敗したfixtureの保存Conversationから83記録・`getSituation`呼出し3回・完了イベント5回・compaction1回を確認しました。最後の記録は再接続後のTool処理完了で、`probe.json`は未生成でした。集計は`native-failed-fixture-stage.json`に保存しています。どのnative処理で停止したかは、この記録だけでは断定できません。

モデル・Codex CLIを使わないcmd.exe端末の作成と同時終了を、[18](18-native-crash-diagnostics.md)のデバッガー配下で20回×9端末検証しました。180件すべて終了コード0、ホストもexit 0、native例外採取0でした（`native-pty-churn-debug.log`・`native-pty-churn-progress.log`）。デバッガーのタイミング差を含め、native問題は引き続き未解決です。

実モデル推論・APIキー使用・既存ワールドの変更や削除は行っていません。

## 戻し方

`git log --oneline -- improvements/19-terminal-rpc-envelope.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ変換は不要ですが、不正RPC受信時の未処理例外も戻ります。
