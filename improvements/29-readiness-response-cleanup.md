# 29 — App Server起動確認のHTTP応答を解放する

App Serverの起動確認で、HTTP応答本文を消費・キャンセルせず捨てていた箇所を修正しました。起動未完了の応答も成功応答も、本文をキャンセルしてから次の起動確認やRPC接続へ進みます。

## 原因と範囲

従来は`fetch(...).ok`だけを参照していました。Nodeのfetch実装である[Undiciの公式説明](https://github.com/nodejs/undici#garbage-collection)は、接続資源の解放をGC任せにすると接続使用量や再利用に問題が起こり得るため、本文を消費するかキャンセルするよう求めています。起動確認では本文の内容を使わないため、明示的にキャンセルします。

本文なしの応答はそのまま扱います。本文キャンセルの失敗は呼び出し元へ伝え、既存の接続失敗時の処理でApp Serverを閉じます。接続拒否による再試行はfetch自体に限定しました。本文キャンセルが同じエラーコードを持っていても、接続待ちとして再試行しません。

起動確認先は従来どおり動的に予約したlocalhostポートの`/readyz`です。認証token、RPCの権限、接続先、モデル設定、リトライ回数・間隔、ワールドの保存形式は変更していません。依存追加やNodeの入れ替えも行っていません。

## native異常終了との関係

この処理は元のCLI検証でも通るfetch呼び出しです。ただし、[21](21-native-node-shutdown.md)のNode単体終了競合や、元のCLI worker異常終了との因果関係は確認できていません。この修正をnative異常終了の解決とはしていません。

最初の本文解放修正をnative診断配下で実行した際は、実CLI接続8件PASS、診断ツールexit 0、`root-exit=00000000 captured=0 timeout=0`でした。ログは`.local/polish-20260914/readiness-native.log`と`readiness-native.log.stdout.log`です。その後、キャンセル失敗とfetchの再試行対象を分離した最終コードでも、通常の実CLI接続8件が成功しました。

診断時の`life-tools-causfy`と最終通常実行の`life-tools-TcCUnH`の段階記録は、それぞれ33行・全beginに対応するendあり・最終行`fixture/cleanup-completed`でした。集計は同じログディレクトリの`readiness-stage-audit.json`です。

## 再現方法と試し方

`npx vitest run --config vitest.backend.config.ts tests/backend/runtime-readiness.test.ts`で確認できます。プロセス起動とRPC接続はfixtureに置き換え、実際の`Response`と`ReadableStream`で、未完了・成功の本文が次へ進む前にキャンセルされること、本文なしの応答、キャンセル失敗、接続拒否以外の通信エラーを確認します。実モデルや実CLIを使う検証ではありません。

通常の利用では接続操作を変える必要はありません。

## 検証記録

ログは`.local/polish-20260914/`です。修正前は本文解放とキャンセル失敗の2件が失敗し、本文なし・通常の通信エラーの2件は成功しました（exit 1、`readiness-before.log`）。初回修正ではキャンセル由来の`ECONNREFUSED`も接続待ちとして再試行していたため、これを検出するケースを加えて再現しました（exit 1、1件FAIL・3件PASS、`readiness-cancel-error-before.log`）。最終コードは4件PASSです（exit 0、`readiness-final-target.log`）。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `readiness-final-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `readiness-final-lint.log` |
| `npm test` | exit 0、単体55・backend143件PASS | `readiness-final-test.log` |
| `npm run test:connection` | exit 0、実CLI接続8件PASS | `readiness-final-connection.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全23件PASS | `readiness-final-e2e.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `readiness-final-persistence.log` |

最終コードで計233件PASS。途中の全体E2Eで見つかったDEVチェックポイントの検証競合は、[28](28-dev-checkpoint-test-wait.md)の別コミットで修正し、最終全体実行にも含めています。検証は合成資料とlocalhostのResponsesサーバーのみです。実モデル推論・APIキー使用・既存ワールド変更はありません。

## 戻し方

`git log --oneline -- improvements/29-readiness-response-cleanup.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。ワールドや認証情報の移行は不要です。
