# 47 — 比較候補欠落の監視経路を追加調査

これは原因調査の記録です。アプリ本体への修正や加点機能の追加ではありません。[46](46-world-view-run-boundary.md)で取得した「実ディスクにあるmanifestが公開一覧とfileVersionsにない」という不具合は未解決です。

## 記録した経路

インストール済みchokidar 5.0.0のコードを読み、Electronで実際に動く監視について、raw event・ファイル監視開始・通知の試行・アプリへ送ったall event・削除判定・内部エラー・保留中の書き込みを記録しました。

最初は専用のElectron起動用fixtureから同期ファイルへ記録しました。その後、同期書き込みによるタイミングへの影響を減らすため、メモリ内へ記録し、監視終了時に保存する方式でも確認しました。どちらも診断のフックによってタイミングは変わり得ます。

診断ファイルは`.local/polish-20260914/watch-electron-entry.mjs`・`watch-runtime.mjs`です。全体診断と連続書き込み診断では、生成済み`out/main/index.js`へ診断モジュールのimportを一時追加し、`PERSONA_WATCH_TRACE=1`を持つ検証用アプリでだけ計測しました。ソースと依存パッケージは変更していません。実行コマンドのfinallyで元のbuildへ戻しています。

## 実行結果

プロジェクトルートで実行しました。以下のログは`.local/polish-20260914/`にあります。

| 対象・command | exit | 結果 | log |
|---|---|---|---|
| `node node_modules/@playwright/test/cli.js test --config .local/polish-20260914/watch-electron.config.ts --repeat-each 10 --max-failures 1` | 0 | Codex側の比較10回PASS、46.7秒。同期記録を使用 | `watch-electron-final.log` |
| `node node_modules/@playwright/test/cli.js test`（メモリ内監視記録を一時的に有効化） | 0 | 前回と同じ全体順序の34件PASS、5.1分 | `watch-full-order.log` |
| `node node_modules/@playwright/test/cli.js test --config .local/polish-20260914/watch-batches.config.ts`（同じ監視記録を有効化） | 0 | 1テスト内で100バッチ・1,500ファイルを書き、各バッチの全パスが公開一覧に反映されることを5秒以内に確認。約1分 | `watch-batches.log` |
| `node .local/polish-20260914/verify-watch-observations.mjs` | 0 | 1,500個の期待パスすべてについてadd通知を確認。監視エラー0、compilationの保留0 | `watch-observations-verification-final.log` |

初回の起動用fixtureでは、Electronのevaluate内のdynamic importが使えず診断結果の保存に失敗しました（exit 1、`watch-electron-fixture-error.log`）。ファイル保存をテスト側へ移し、アプリ終了をfinallyで行うようにしてから上記10回を実行しました。

結果照合スクリプトも、最初は「終了時の保留がすべて0」を期待して失敗しました（exit 1、`watch-observations-verification-initial.log`）。記録を確認すると、保留は終了時の保存で生じた`persistence/snapshot-b.json`と`persistence/manifest.json`の2件でした。比較対象のcompilationの保留と区別して検証し、2件のパスと時刻は`watch-observations-summary.json`へ残しています。元の失敗ログも保持しています。

## 取得できた事実と限界

正常なCodex側比較では、baseline manifestについて`initialAdd: false`で監視が始まり、add通知の試行から約139ms後にall/addが出ていました。記録は`.local/e2e/package-comparison-mAitww/watch-runtime-23828.json`です。今回の欠落で同じ経路のどこが止まるかは、再発しなかったため確認できませんでした。

連続作成の記録は`.local/e2e/watch-batches-Lo1o2f/watch-runtime-23360.json`です。1,500件のadd通知が期待パスと一致しています。ただし、100バッチの成功はWindows上のすべてのファイル作成・監視順序を保証しません。

上流にはWindowsでadd通知が欠けた[過去の報告 #552](https://github.com/paulmillr/chokidar/issues/552)もありますが、2016年の異なる環境の報告です。今回と同じ原因だという根拠にはしていません。通知の保留・取り消し経路は調査候補のままで、推測によるretryや全体再走査は追加していません。

診断下の全34件は成功しましたが、46の通常実行の33件PASS・1件FAILを取り消すものではありません。既知のnative異常終了も未解決です。実モデル推論・APIキー使用・既存ワールド変更はありません。

## 復元・次の確認

診断後の`out/main/index.js`は、診断前のコピーとSHA-256が一致しました（`D2CD77576BEC4F27C6EC72E4FDCBF8825A2C6E9BFEAC9DE728723C2EE168F4CB`）。診断用の起動ファイル名に一致する残存Electronプロセスはありませんでした。

通常の比較E2Eは`npm run build`後に`node node_modules/@playwright/test/cli.js test tests/e2e/package-comparison.spec.ts`で実行できます。再発時は45のattachmentを確認し、監視側の記録と照合します。今回作ったローカル診断は通常のテスト・アプリ起動では有効になりません。

このコミットで管理対象に加えたのは調査記録だけです。`git log --oneline -- improvements/47-workspace-watch-observations.md`でコミットを確認し、`git revert <commit>`で文書変更を取り消せます。アプリのデータや実装は変わりません。
