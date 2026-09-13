# 14 — 起動待ちの端末を正しいPIDで停止する

端末の起動直後にアプリ終了や接続の切り替えが重なると、PIDが未確定のまま`process.kill(0)`を呼び得る不具合を修正しました。起動完了または起動失敗を待ってから、通常の終了手順に進みます。

## 原因と変更

node-ptyのWindows端末は、出力workerとの接続が完了するまでPIDが`0`です。これまでの`PtyTerminals.dispose()`は、終了要求の送信から1.5秒経過すると、そのPIDを確認せず`process.kill`へ渡していました。起動を1.9秒遅らせたモックでは、実際に`process.kill(0)`へ到達しました。OSへPID 0のシグナルを送る実験は行っていません。

各端末に、最初の出力または終了通知で解決する起動待ちのPromiseを追加しました。PIDがまだ正の値でなければ、この通知を最大6秒待ちます。利用中のnode-ptyには出力worker接続の5秒タイムアウトがあり、その結果の通知も受け取るための待機です。待機後もPIDが未確定なら、明示的な起動未確認エラーを返して端末の状態を保持します。

起動を確認してから既存の終了要求を送り、1.5秒の通常終了待ちを設けます。終了しない場合は確定した端末のPIDを停止し、終了通知を確認します。起動前に終了通知が届いた場合も待機を終えます。再接続時には起動待ちのPromiseを新しい端末のものへ更新します。

新しい依存・保存形式・モデル設定の変更はありません。特定のゲームエンジンやゲームジャンルにも依存しません。

## 試し方

`npx vitest run --config vitest.backend.config.ts tests/backend/terminals.test.ts`で以下の4件を確認できます。PTY生成と`process.kill`はモック化し、実モデルや実プロセスへのシグナルは使用しません。

- 起動が1.9秒遅れても、PID 0へシグナルを送らず通常終了できる。
- 起動を確認できない場合はエラーを返し、端末状態を保持する。
- PID確定前に起動失敗の終了通知が届けば、停止処理を完了できる。
- 通常終了しない端末は、自分が保持する正のPIDで停止する。

実Codex端末の接続・再接続は、`npm run test:connection`のlocalhost Responses fixtureで検証できます。アプリは`npm run build`、`npm start`で起動します。

## 検証

ログは`.local/polish-20260914/`、実行ディレクトリはリポジトリルートです。修正前の対象4件は2件失敗・2件成功（exit 1、`pty-startup-before.log`）、修正後は4件成功（exit 0、`pty-startup-after.log`）でした。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `pty-startup-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `pty-startup-lint.log` |
| `npm test` | exit 0、単体46・backend129件PASS | `pty-startup-test.log` |
| `npm run test:connection` | exit 0、8件PASS | `pty-startup-connection.log` |
| `npm run test:persistence` | exit 0、4件PASS | `pty-startup-persistence.log` |
| `npm run test:e2e` | exit 0、build・Electron E2E18件PASS | `pty-startup-e2e.log` |

最終ソースで計205件PASSです。対象4件の再実行は重複計上していません。実モデル試運転・APIキー使用・既存ワールド削除は行っていません。既存のテスト対象・閾値・警告設定も変更していません。

停止処理とその呼出元を読み、PIDがUIやモデル入力から直接指定されず、生成したPTYから取得されることを確認しました。未確定PIDを拒否する境界はモックで検証し、実CLIとの通常接続は別の統合テストで確認します。OSがPID 0を受け取った場合の影響は実験していないため、特定のOSで別プロセスが終了したという主張はしていません。

## 戻し方

`git log --oneline -- improvements/14-terminal-startup-shutdown.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。ワールドデータは変更していません。戻した場合、起動が遅い端末の停止処理で未確定PIDを使用する可能性が再発します。
