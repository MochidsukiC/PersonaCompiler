# 18 — native異常終了の例外地点を採取する診断手段

[17](17-workspace-dot-prefix.md)で再発したCLI workerの終了コード`3221226505`（`C0000409`）について、次の再発時に例外地点を取得する診断ツールを追加しました。原因を特定・修正したという変更ではありません。

## 追加内容

[診断ツールと手順](../diagnostics/README.md)は既存のVisual Studio C++ tools・Windows SDKだけを使います。指定したテストプログラムを新しく起動し、その子プロセスからnative例外コード、例外引数、stack、ローカルdump、標準出力を採取します。実行中のユーザーアプリへattachする機能はありません。

診断ツールをアプリ、配布物、通常のテスト設定には組み込んでいません。新しい依存、システムのクラッシュ設定、テスト除外、自動リトライは追加していません。デバッガー配下ではタイミングが変わるため、成功を不具合解消の証明とは扱いません。

## 確認できたこと

- PATH上にもWindows SDK内にも`cdb`・`windbg`の実行ファイルはありませんでしたが、MSVCとDbgHelpは利用可能でした。新しい診断製品のダウンロード・インストールは行っていません。
- 意図的なfail-fast fixtureから`C0000409`、引数7、`failFixture`の関数名と呼び出しstackを取得し、dump作成成功を確認しました。
- 正常なNode fixtureの終了コード0と固定標準出力を取得できました。
- CLI全8件と保存4件の並行診断、問題のCLIテスト最大5回とElectron E2E18件の並行診断では、問題のnative例外は再発しませんでした。

初回の単独CLI診断はプロセス終了0・例外採取0でしたが、標準出力を採取できていませんでした。診断プログラムの標準ハンドルを明示し、その後の検証ではテスト件数と結果もログで確認しています。初回をテスト成功件数に加えていません。

## 検証記録

実行ディレクトリはリポジトリルート、ログ・バイナリ・dumpは`.local/polish-20260914/`です。ソースは`diagnostics/native-debugger.cpp`、実行したビルド手順はログと同フォルダーの`build-native-debugger.cmd`に残しています。リポジトリに保存したソースとビルドに用いたソースのSHA-256一致も確認しています。

| 検証 | 結果 | log |
|---|---|---|
| MSVC x64ビルド | exit 0 | `native-debugger-build-final.log` |
| `--fixture-crash` | 診断ツールexit 1（期待値）、5つの採取項目のassertion成功 | `native-debugger-selftest-final.log` |
| Node `console.log(12345)` | exit 0、標準出力一致・例外採取0 | `native-debugger-output-check.log`と`.stdout.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.connection.config.ts`を診断配下で実行 | exit 0、8件PASS・例外採取0 | `native-connection-debug.log`と`.stdout.log` |
| 上記と並行した`npm run test:persistence` | exit 0、4件PASS | `native-diagnostic-persistence.log` |
| `life-tools.test.ts`を最大5回、最初の失敗で止める診断 | exit 0、5回各1件PASS・例外採取0 | `native-life-tools-repeat-debug.log`と`.stdout.log` |
| 上記と並行した`npx playwright test` | exit 0、18件PASS | `native-diagnostic-e2e.log` |

今回は診断ツールと文章の追加だけで、アプリのソース・設定・依存に変更はありません。アプリのbuild・typecheck・lint・単体・backendの証拠は[17](17-workspace-dot-prefix.md)の同一ソースに対する結果を維持しています。実モデル推論・APIキーの使用はありません。

## 残る調査

実際の異常終了についてnative stackが未取得で、原因は未確定です。前回の失敗ログを保持し、不具合を未解決として扱います。次に再発した場合、この診断手段で例外発生モジュールとstackを取得して原因箇所へ遡ります。通常実行と診断実行のタイミング差にも留意します。

## 戻し方

`git log --oneline -- improvements/18-native-crash-diagnostics.md`でコミットを確認し、`git revert <commit>`で診断ツールと記録を戻せます。アプリの再ビルドやデータ変換は不要です。
