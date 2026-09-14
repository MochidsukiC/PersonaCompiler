# Windows native例外のローカル診断

`native-debugger.cpp`は、Windows x64で指定したプログラムを新規起動し、その子プロセスの未処理例外と`C0000409`を採取する診断ツールです。既存プロセスにattachする機能はありません。アプリの依存・自動テスト・配布物には組み込みません。

既存のVisual Studio C++ toolsとWindows SDKを使います。Microsoftの[デバッグイベント処理](https://learn.microsoft.com/en-us/windows/win32/debug/writing-the-debugger-s-main-loop)、[StackWalk64](https://learn.microsoft.com/en-us/windows/win32/api/dbghelp/nf-dbghelp-stackwalk)、[例外情報の渡し方](https://learn.microsoft.com/en-us/windows/win32/api/minidumpapiset/ns-minidumpapiset-minidump_exception_information)に基づき、例外発生時に停止したスレッドからcontextを取得します。シンボル検索先は空文字列で指定し、このツールからシンボルサーバーへのURLは設定しません。

## ビルド

Visual Studioの **x64 Native Tools Command Prompt** を開き、リポジトリルートで実行します。

```bat
mkdir .local\native-diagnostics
cl /nologo /std:c++20 /EHsc /Zi /Od diagnostics\native-debugger.cpp /Fo.local\native-diagnostics\native-debugger.obj /Fd.local\native-diagnostics\compile.pdb /Fe.local\native-diagnostics\native-debugger.exe /link dbghelp.lib /DEBUG /PDB:.local\native-diagnostics\native-debugger.pdb
```

## 採取機能の確認

リポジトリルートのPowerShellで実行します。

```powershell
$diagnosticExe = (Resolve-Path .local/native-diagnostics/native-debugger.exe).Path
& $diagnosticExe .local/native-diagnostics/selftest.log .local/native-diagnostics $diagnosticExe --fixture-crash
$LASTEXITCODE
Get-Content .local/native-diagnostics/selftest.log
```

この自己テストでは新しいfixtureプロセスが意図的にfail-fastします。期待する診断ツールの終了コードは **1** です。ログに`code=C0000409`、`parameter[0]=7`、`symbol=failFixture`、`success=1`のdump記録があれば、例外とstackを採取できています。通常終了の確認では次を使い、終了コード0と標準出力`12345`を確認します。

```powershell
$nodeExe = (Get-Command node.exe).Source
& $diagnosticExe .local/native-diagnostics/normal.log .local/native-diagnostics $nodeExe -e 'console.log(12345)'
$LASTEXITCODE
Get-Content .local/native-diagnostics/normal.log.stdout.log
```

## CLI fixtureの診断

```powershell
& $diagnosticExe .local/native-diagnostics/life-tools.log .local/native-diagnostics $nodeExe node_modules/vitest/vitest.mjs run --config vitest.connection.config.ts tests/connection/life-tools.test.ts
$LASTEXITCODE
Get-Content .local/native-diagnostics/life-tools.log
Get-Content .local/native-diagnostics/life-tools.log.stdout.log
```

このfixtureはローカルのResponsesサーバーを使い、実モデル推論は行いません。指定したプログラムの動作自体はデバッガーがネットワーク制限するものではありません。

ログにはプロセスの実行ファイル名・PID・終了コード、例外コード・引数・stackを記録します。引数や環境変数の一覧は出力しません。標準出力と標準エラーは`.stdout.log`へまとめます。dumpはローカルの`.local/`に保存し、Gitへ追加・外部送信しません。dumpには対象プロセスのメモリ内容が含まれるため、実ユーザーデータや認証情報を持たないfixtureを対象にしてください。

終了コードは、通常完了0、native例外検出または対象プログラムの失敗1、引数・起動・イベント待受処理の失敗2、診断期限超過124です。診断期限の既定値は180秒です。例外検出後のcontext・dump・symbol採取の失敗はログに個別に記録するため、終了コードだけで採取成功とは判断しないでください。期限超過時は、この診断で起動・追跡しているプロセスだけを終了します。期限超過後に作成通知が届いた子プロセスも終了対象です。通常のテスト設定・タイムアウトは変更しません。

約3分かかる全体E2Eなどでは、先頭に`--timeout-ms`と期限を指定できます。値は1〜900000ミリ秒の整数です。不正値は対象プログラムを起動せずexit 2で拒否します。選択した期限は診断ログの先頭に記録します。

```powershell
# 先にnpm run buildを完了させ、同じビルドで全体E2Eを追跡する例
& $diagnosticExe --timeout-ms 600000 .local/native-diagnostics/e2e.log .local/native-diagnostics $nodeExe node_modules/@playwright/test/cli.js test
$LASTEXITCODE
Get-Content .local/native-diagnostics/e2e.log.stdout.log
Get-Content .local/native-diagnostics/e2e.log
```

デバッガーはタイミングを変えるため、再発しなかったことは修正の証明になりません。シンボルがないモジュールは名前とオフセットまでの記録になり、関数名を保証しません。アプリ固有の意図的なbreakpointを検証する用途は対象外です。

## 処理段階とNode自体の終了競合

### Backend workerのテスト段階

通常のbackend設定を引き継ぎ、worker PID・テストファイル・テスト名・UTC時刻を同期記録する任意の診断設定です。リポジトリルートで実行します。

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.backend-stages.config.ts
# RPCだけを調べる場合
node node_modules/vitest/vitest.mjs run --config vitest.backend-stages.config.ts tests/backend/rpc.test.ts
```

出力先は毎回新しい`.local/backend-stages-*`で、起動時に絶対パスを表示します。各setup実行につき`<PID>-<UUID>.jsonl`を作り、`setup`・`beforeAll`・`beforeEach`・`afterEach`・`afterAll`のhook到達時に追記します。ファイル内の`sequence`は1から連続します。テスト情報をまだ取得できない段階は`null`です。テスト名・パス以外の引数、環境変数一覧、テストの出力や認証情報は記録しません。テスト名自体に秘密情報を含めないでください。

`afterEach`は失敗時にも呼ばれます。段階記録は成功判定ではなく、Vitestの結果・終了コードと併せて読みます。突然のworker終了では終了直前のテスト名を確認できますが、同時進行するnative処理の原因までは特定できません。`setup`より前の異常終了では記録を作れず、`afterAll`もプロセス終了完了を意味しません。通常の`npm test`には組み込まず、テスト対象・並列数・制限時間も変更しません。同期書き込みは実行タイミングに影響します。

既存のnative診断と組み合わせる場合も、対象configだけを置き換えます。PIDで段階記録とnativeログを対応付けられます。

```powershell
& $diagnosticExe --timeout-ms 180000 .local/native-diagnostics/backend-stages.log .local/native-diagnostics $nodeExe node_modules/vitest/vitest.mjs run --config vitest.backend-stages.config.ts
```

### CLIの処理段階とNode終了競合

`life-tools.test.ts`は、fixtureの`stages.jsonl`へUTC時刻・worker PID・処理名を同期追記します。再接続・再開・Tool完了待ち・最終assertion・レポート保存・各リソース終了のbegin/endを確認できます。実行中の異常終了では、endがない処理名が停止区間を絞る手がかりです。非同期native処理は同時進行するため、その処理が原因だと断定する記録ではありません。記録自体もタイミングに影響します。

`node-fetch-exit-probe.mjs`は、[Node issue #56645](https://github.com/nodejs/node/issues/56645)と[修正PR #61999](https://github.com/nodejs/node/pull/61999)の条件をlocalhostだけで試す比較用fixtureです。ローカルのリダイレクト上限到達後、意図的に`process.exit(0)`を呼びます。通常のアプリ起動・テストゲートには組み込んでいません。

```powershell
& $diagnosticExe .local/native-diagnostics/node-fetch-exit.log .local/native-diagnostics $nodeExe diagnostics/node-fetch-exit-probe.mjs
$LASTEXITCODE
Get-Content .local/native-diagnostics/node-fetch-exit.log
Get-Content .local/native-diagnostics/node-fetch-exit.log.stdout.log
```

既知の競合が発生した場合は診断ツールがexit 1となり、対象Nodeの`C0000409`、`uv_async_send`を含むstack、標準エラーの`UV_HANDLE_CLOSING` assertionを確認できます。競合が発生しなければexit 0です。Node 24.15.0での再現と24.21.0の比較結果は[調査記録21](../improvements/21-native-node-shutdown.md)に記載しています。元のCLIテストのnative異常終了との同一性はまだ確認できていません。
