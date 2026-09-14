# 21 — Nodeの終了競合を分離再現し、CLIテストの段階記録を追加

未解決のCLI worker異常終了を調査する中で、開発環境のNode 24.15.0単体でも`C0000409`が発生する条件を確認しました。今回はアプリの修正ではなく、原因を切り分けるための診断と再現記録です。

## 新しく確認したこと

[Node issue #56645](https://github.com/nodejs/node/issues/56645)と[修正PR #61999](https://github.com/nodejs/node/pull/61999)を参照し、localhostのHTTPリダイレクトが上限に達した後、`process.exit(0)`を呼ぶ最小fixtureを作りました。Codex CLI・node-pty・アプリのコードは使用しません。

Node 24.15.0では、[診断ツール18](18-native-crash-diagnostics.md)で`C0000409`、fast-fail引数7、`uv_async_send`を含むstack、dump成功を確認しました。標準エラーには`UV_HANDLE_CLOSING`のassertionが残ります。アドレスから近い公開シンボルしか得られないframeもあるため、全frameの関数名を確定したとは扱いません。

上流の修正は、終了済みのDelayedTaskSchedulerへ新しい遅延タスクを投入しないための状態確認です。[Node 24.21.0のソース](https://github.com/nodejs/node/blob/v24.21.0/src/node_platform.cc)にも該当処理があります。公式配布のWindows x64実行ファイルを`.local/`へ保存し、[公式SHA256一覧](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt)と一致することを確認して比較しました。システムにインストールされたNode、PATH、package.json、依存バージョンは変更していません。

同じ最小fixtureは比較用Node 24.21.0で正常終了しました。さらに同梱Electron 44.3.0のNodeモード（Node 24.20.0、libuv 1.52.1）でも正常終了しました。これはElectronアプリ全体の検証を代替するものではありません。

**元のCLI異常終了の原因を確定したわけではありません。** 過去の失敗時にはこのassertionやstackが採取されていないため、終了コードの一致だけで同一原因とは判断しません。開発用Nodeの再現可能な不具合と、元の未解決問題を区別して残します。

## CLI fixtureの段階記録

`tests/connection/life-tools.test.ts`は、fixtureの`stages.jsonl`にUTC時刻・worker PID・処理名だけを同期追記します。再接続、再開、Tool完了待ち、最終assertion、レポート保存、リソース終了をbegin/endで記録します。過去の失敗では`probe.json`の書出し前に停止していたため、これより前の記録も残せるようにしました。

endがない段階は停止区間を絞る手がかりです。同時進行するnative処理の原因を確定するものではなく、記録によるタイミング差もあります。既存アサーション、終了処理、タイムアウト、成功判定は維持しました。例外を捕捉して成功扱いにする処理や自動再試行は追加していません。

## 試し方と検証

通常のCLI fixtureは`npm run test:connection`で実行できます。対象だけなら`npx vitest run --config vitest.connection.config.ts tests/connection/life-tools.test.ts`です。`.local/tests/life-tools-*/stages.jsonl`を確認してください。テスト失敗時のstdoutにも保存先を出力します。

最小再現コードは`diagnostics/node-fetch-exit-probe.mjs`です。[診断手順](../diagnostics/README.md)に従って、比較するNode実行ファイルを明示指定できます。意図的にprocess.exitを使う診断fixtureであり、通常のテストゲート・アプリ起動には組み込んでいません。

実行ディレクトリはリポジトリルート。以下のログは`.local/polish-20260914/`にあります。

| 対象・command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `native-stages-typecheck.log` |
| `npm run lint`（最終コード） | exit 0、警告0 | `native-stages-lint-verified.log` |
| `npm run test:connection`（通常Node 24.15.0） | exit 0、8件PASS | `native-stages-connection.log` |
| 比較用Nodeを明示指定した`vitest run --config vitest.connection.config.ts` | exit 0、8件PASS | `native-node-comparison-connection.log` |
| 最小fixture／Node 24.15.0 | 診断exit 1、対象`C0000409`、例外・dump各1件 | `native-node-fetch-exit-verified.log`と`.stdout.log` |
| 最小fixture／Node 24.21.0 | 診断exit 0、対象exit 0、例外0件 | `native-node-fetch-exit-fixed-verified.log`と`.stdout.log` |
| 最小fixture／ElectronのNodeモード | 完了ログの対象exit 0、例外0件、最小条件の実行markerあり | `native-electron-fetch-exit.log`と`.stdout.log` |
| 段階記録・native採取ログの照合 | exit 0、33記録・15組のbegin/end・cleanup完了を確認 | `native-stages-inspection.json` |

Electron診断直後のログ参照は共有違反でexit 1でした。その時点で再起動せず同じプロセスとログを確認し、後から終了ログとstdoutを読み取りました。診断開始コマンド自体がexit 0だったとは報告しません。

比較用Nodeの実行ファイルSHA256は`BA4E6D110E8C1592A1ECD390F6B05F3DA124B13871A5BE62B341A07A853C6C32`。照合記録は`native-node-comparison-download.json`です。最終lint前にはJSのglobal参照に3件のエラーがあり、明示的なprocess importとglobalThis.fetchで修正して再検証しました。

アプリ本体は`a94eee2`から変更していません。[20](20-rpc-failed-connection.md)のbuild・単体53・backend133・保存4・Electron E2E18件の検証を引き継ぎ、今回変更したCLIテスト8件とtypecheck・lintを実行しました。比較用Nodeでアプリ全体の全ゲートを実行したとはしていません。実モデル・APIキー・既存ワールドは使用していません。

## 戻し方

`git log --oneline -- improvements/21-native-node-shutdown.md`でコミットを確認し、`git revert <commit>`で段階記録と追加診断を戻せます。アプリの再buildやデータ変換は不要です。既存の診断ツール18は維持されます。
