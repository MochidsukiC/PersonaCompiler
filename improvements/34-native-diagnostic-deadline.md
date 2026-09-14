# 34 — 全画面検証をnative診断で追跡できるようにする

[33](33-rpc-response-validation.md)では、Playwrightのworkerも終了コード`3221226505`で異常終了しました。既存の診断ツールは180秒で固定終了し、約3分かかる全画面検証に余裕がありませんでした。診断用の期限を明示指定できるようにしました。

## 変更内容

`native-debugger.exe --timeout-ms 600000 <log> <dump-directory> <program> <args...>`のように、先頭で期限を指定できます。省略時は従来の180秒、指定可能な範囲は1〜900000ミリ秒です。選択値を診断ログへ記録し、不正値では対象プロセスを起動しません。

期限を超えた後に子プロセスの作成通知を受けた場合も、そのプロセスを終了対象に含めます。管理する対象は、この診断ツールが新規起動・追跡したプロセスだけです。ユーザーの既存アプリへattachする機能はありません。

配布アプリ、通常のテスト期限、依存関係、Nodeのインストール状態は変更していません。実際のnative異常終了を修正した変更ではありません。

## 検証

既存MSVC x64でビルドし、リポジトリのソースとビルドに使ったコピーのhash一致を確認しました。ログ・バイナリ・dumpは`.local/polish-20260914/`へ保存しています。

| 検証 | 結果 | 記録 |
|---|---|---|
| MSVCビルド | exit 0 | `native-timeout-build-final.log` |
| 期限省略・通常終了 | exit 0、既定180000ms・標準出力12345 | `native-timeout-default.log`と`.stdout.log` |
| 10000ms指定・引数保持 | exit 0、空白・末尾backslashを含む引数の一致 | `native-timeout-explicit.log`と`.stdout.log` |
| 意図的なfail-fast | 期待どおりexit 1、C0000409・引数7・failFixtureのstack・dump採取成功 | `native-timeout-crash.log` |
| 500ms期限・親子プロセス | 期待どおりexit 124、Node親・Node子・console hostが全て終了 | `native-timeout-owned.log` |
| 0・負数・非数・上限超過・巨大な整数 | 各exit 2、対象未起動 | `native-timeout-invalid-errors.log` |

9ケースの終了コードは`native-timeout-results.json`、内容のassertion成功は`native-timeout-assertions.log`に記録しています。最初の親子プロセス検証では総数を2件と仮定して失敗しました。実際にはconsole hostも作成・終了していたため、Nodeが2件であることと、追跡した全プロセスの終了を確認する条件に修正しました。製品のテスト除外やassertion削除は行っていません。

期限600000msで`node node_modules/@playwright/test/cli.js test`を診断配下から実行し、全27件PASS（3.7分）、診断ツールexit 0、`root-exit=00000000 captured=0 timeout=0`でした。従来の180秒を超える全体検証を最後まで追跡できました。ログは`native-full-e2e.log`と`.stdout.log`、完了とプロセス終了記録の確認は`native-full-e2e-audit.json`です。

今回はnative異常終了が再発せず、例外のstackは採取できませんでした。デバッガーは実行タイミングを変えるため、不具合を解消したとは扱いません。前回のPlaywright worker異常終了と、過去のCLI worker異常終了の原因・同一性は未確認です。

今回の編集は診断C++と文書のみです。アプリのbuild・typecheck・lint・単体・backend・CLI・保存の証拠は[33](33-rpc-response-validation.md)の同一ソースに対する結果を維持しています。実モデル推論・APIキー使用・既存ワールド変更はありません。

## 試し方と戻し方

[診断手順](../diagnostics/README.md)のビルドを実施し、期限指定のコマンドを使ってください。配布アプリから使う機能ではありません。

`git log --oneline -- improvements/34-native-diagnostic-deadline.md`でコミットを確認し、`git revert <commit>`で戻せます。ローカル診断バイナリを使う場合は戻したソースから再ビルドしてください。ワールドの移行は不要です。
