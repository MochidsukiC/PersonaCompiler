# 12 — 複数端末の終了時に起きるnative crashを修正

`node-pty`を`1.1.0`から`1.2.0-beta.15`へ固定更新しました。複数のConversation端末を閉じる際に、Windowsのnative処理が同じ端末管理データを同時更新して壊す不具合の上流修正を適用します。アプリの終了手順・ゲームの保存形式・モデル設定は変更しません。

## 原因と再現

CLI接続テストと保存テストを同時実行すると、`life-world.test.ts`のWorkerが`3221225477`（`0xc0000005`）で終了しました。生活処理とアサーションを終えた`acceptance.json`が書かれており、その後の9端末を閉じる処理で停止しています。保存4件は成功し、CLIは6件成功・1件異常終了でした。

利用中のnativeソースでは、端末ごとの終了監視threadとJS threadが共有の`ptyHandles`を排他制御なしで読み書きしていました。[上流issue #921](https://github.com/microsoft/node-pty/issues/921)には同じ箇所の競合と同じアクセス違反コードが報告され、[PR #922](https://github.com/microsoft/node-pty/pull/922)でmutexによる同期が追加されています。インストール後のソースにもこの修正が含まれることを確認しました。

モデルもアプリも使わず、ローカルのcmd端末9個を一斉に終了させる最小試験でも、旧版は1回目で終了通知が8個までとなり、Microsoft Visual C++ Runtime Libraryのダイアログを持つNodeプロセスが残りました。ダイアログ本文とcrash stackは取得できていません。更新後は同じスクリプトで20回・180端末すべての終了通知を確認しました。

最小スクリプトのホストNodeプロセスは新版でも終了通知後に残り、専用コマンドラインで一意に識別して終了しました。これは自然終了成功として計上しません。標準のCLIテスト・回帰テスト・Electron終了の検証は、別途runnerの終了コードまで確認します。過去に発生した別の終了コード`3221226505`の直接のstackは未取得であり、過去の全異常終了を同一原因と断定しません。

## 依存の選択

2026-09-14のnpm配布情報では、`latest`は`1.1.0`、`beta`は`1.2.0-beta.15`です。[公式リリース](https://github.com/microsoft/node-pty/releases/tag/v1.2.0-beta.13)では競合修正がbeta.13に入り、採用したbeta.15にはその後のWindows接続・出力workerの修正も含まれます。修正済みの最新配布版をexact指定し、lockfileのURL・integrityも更新しました。更新されたパッケージはnode-ptyの1件だけです。

beta版を採用する変更です。Windows 11（10.0.26200）、Node 24.15.0、Electron 44.3.0で検証し、他OSとソースからのnative再ビルドは未検証です。公式同梱バイナリーを使い、ローカルのnativeコード改変やコンパイル時の警告・保護の無効化は行っていません。

## 試し方

1. 起動中のこのプロジェクトのアプリを終了し、`npm ci`でlockfileの依存を入れます。
2. `npx vitest run --config vitest.connection.config.ts tests/connection/pty-lifecycle.test.ts`を実行します。Windowsで9端末を5回、一斉に終了させ、45個すべての終了通知とコード0を検証します。モデルは使用しません。
3. `npm run test:connection`で実際のCodex CLIとlocalhostのResponses fixtureの接続を検証できます。実モデルの生成はありません。
4. `npm run build`、`npm start`でアプリを起動できます。

新しい回帰テストはWindowsのnative競合を対象とするため、他OSではこの1件だけskipします。既存テストの対象・閾値・警告設定は変更しません。通常の機能試運転を短縮する変更ではなく、モデルを使わない端末試験です。

## 検証

ログは`.local/polish-20260914/`、実行ディレクトリはリポジトリルートです。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `node-pty-typecheck-final.log` |
| `npm run lint` | exit 0、警告0 | `node-pty-lint-final.log` |
| `npm test` | exit 0、単体46・backend125件PASS | `node-pty-test.log` |
| `npm run test:connection` | exit 0、既存7・端末回帰1件PASS | `node-pty-connection.log` |
| `npm run test:persistence` | exit 0、4件PASS | `node-pty-persistence.log` |
| `npm run test:e2e` | exit 0、build・Electron E2E18件PASS | `node-pty-e2e.log` |
| `npx vitest run --config vitest.connection.config.ts tests/connection/pty-lifecycle.test.ts` | exit 0、最終テストコードで1件PASS | `node-pty-regression-final.log` |

計201件PASS。対象テストの再実行は重複計上していません。CLIと保存は旧版の失敗時と同じ並行条件で成功しました。追加テストの後片付けをlintに合わせて関数化した後、型検査・lint・該当回帰テストを再確認しています。Electron E2Eには実native PTYの起動・出力と、保存エラー時の終了取消・復元検証が含まれます。新規のWindows限定テストもこの環境ではskipせず実行しています。

更新前の並行実行失敗は`native-concurrent-connection.log`（exit 1）、同時の保存成功は`native-concurrent-persistence.log`（exit 0）です。最小試験の記録は`pty-exit-repro-before.log`と`pty-exit-repro-after.log`で、どちらもホストを明示終了したためexit -1です。これらは201件のPASS数には含めません。

実モデル推論・APIキー使用・既存ワールド削除は行っていません。端末終了の競合を修正する変更で、モデル生成品質や全native障害の解消を保証するものではありません。

## 戻し方

`git log --oneline -- improvements/12-native-terminal-exit.md`でコミットを確認し、`git revert <commit>`、`npm ci`、`npm run build`の順に実行します。アプリを終了した状態で依存を戻してください。旧版のnative競合も戻るため、この変更だけを戻した場合には端末の同時終了で再発する可能性があります。ワールドデータは変更していません。
