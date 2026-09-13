# 13 — 端末終了後のworkerと入力ソケットを解放

端末を終了・再接続するたびにWindowsの出力workerが残る不具合を修正しました。終了済み端末の入力ソケットを閉じ、出力workerを既存のdrain処理で停止します。ゲーム形式、保存データ、Conversationの内容やモデル設定は変更しません。

## 原因と変更

node-ptyの通常のWindows終了経路は、出力の到着が止まってから`_cleanUpProcess()`で出力ソケットを破棄します。しかし、入力ソケットと`ConoutConnection`のworkerを解放していませんでした。アプリは自然終了した端末にも再接続できるため、再接続で古いworkerが残り続けます。

9端末を5回閉じる既存の回帰テストにリソース確認を追加すると、開始時0個だった`MessagePort`が終了後45個となり、5秒待っても戻らず失敗しました。単体のNodeスクリプトも端末の終了通知後に残留していました。

パッチは`node-pty/lib/windowsPtyAgent.js`の終了処理に、`_inSocket.destroy()`と`_conoutSocketWorker.dispose()`の2行を追加し、終了した端末のリソースを解放します。出力flushを待つ既存の順序は維持します。アプリが使用していない`useConptyDll: true`経路には変更を加えません。

配布版への差分は`patches/node-pty+1.2.0-beta.15.patch`で管理し、`patch-package 8.0.1`と`postinstall`を追加しました。`npm ci`で自動適用し、適用に失敗した場合は`--error-on-fail`で終了コード1を返します。node-pty本体は[12](12-native-terminal-exit.md)で固定したbeta版のままです。patch-packageに伴う49パッケージを追加し、既存依存のバージョン変更は0件です。

[上流issue #887](https://github.com/microsoft/node-pty/issues/887)にもWindowsのworker残留が報告されていますが、この2行は本プロジェクトで検証した修正であり、上流で採用済みの修正とは扱いません。[patch-packageの公式手順](https://github.com/ds300/patch-package)に従って差分を保存しています。

## 試し方

1. このプロジェクトのアプリを終了し、`npm ci`を実行します。`node-pty@1.2.0-beta.15 ✔`というパッチ適用結果を確認します。
2. `npx vitest run --config vitest.connection.config.ts tests/connection/pty-lifecycle.test.ts`で、Windowsの45端末が終了し、`MessagePort`が開始時の個数へ戻ることを検証します。
3. `npm run test:connection`で、localhostのResponses fixtureを使った実Codex端末の終了・再接続を検証できます。実モデル推論はありません。
4. `npm run build`、`npm start`で起動します。

今後node-ptyを更新するときはパッチの適用状況と回帰テストを確認してください。`npm ci --ignore-scripts`ではパッチが適用されないため、通常のインストール手順を使用します。検証OSはWindows 11、Node 24.15.0、Electron 44.3.0です。他OSや別のConPTY経路は未検証です。

## 検証

ログは`.local/polish-20260914/`、コマンドはリポジトリルートで実行しています。

| command | 結果 | log |
|---|---|---|
| `npm ci --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000` | exit 0、patch適用成功 | `pty-clean-install.log` |
| `npm run typecheck` | exit 0 | `pty-resource-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `pty-resource-lint.log` |
| `npm test` | exit 0、単体46・backend125件PASS | `pty-resource-test.log` |
| `npm run test:connection` | exit 0、8件PASS。CLI再接続後のworker解放を含む | `pty-resource-connection.log` |
| `npm run test:persistence` | exit 0、4件PASS | `pty-resource-persistence.log` |
| `npm run test:e2e` | exit 0、build・Electron E2E18件PASS | `pty-resource-e2e.log` |

クリーンインストール後の状態で計201件PASSです。最小試験`node .local/polish-20260914/pty-exit-repro.cjs .local/polish-20260914/pty-exit-repro-cleanup.log`もexit 0です。20回・180端末の終了通知が揃い、前回と異なりホストNodeも手動停止せず自然終了しました。

修正前の回帰失敗は`pty-resource-before.log`（exit 1、期待0・実際45）、修正直後の成功は`pty-resource-after.log`（exit 0）に記録しています。最小試験や対象テストの再実行は通常のテスト件数に加算しません。実モデル推論・APIキー使用・既存ワールド削除は行っていません。

## 戻し方

`git log --oneline -- improvements/13-terminal-resource-cleanup.md`でコミットを確認し、`git revert <commit>`、`npm ci`、`npm run build`の順で戻せます。起動中のアプリを終了してから依存を再構成してください。ワールドデータは変更していません。パッチを戻すと端末終了後のworker残留が再発します。
