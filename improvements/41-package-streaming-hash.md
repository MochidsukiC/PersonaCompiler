# 41 — 大きな成果物を丸ごと保持せず照合

成果物照合は、manifestに登録された各ファイルを`readFile`で全量読み込んでからSHA-256を計算していました。256 MiBの合成バイナリー1個でも、照合中のバッファ使用量が約256 MiB増えることを測定しました。画像・音声など大きなアセットを含む制作物では、ファイルサイズに比例してメモリを要求する実装でした。

## 変更

登録された成果物をNodeのReadStreamで分割読み込みし、SHA-256と実際に読み取ったバイト数を逐次集計します。ファイル形式・ゲームジャンル・エンジンを判定する処理や、サイズ制限は追加しません。空ファイルやバイナリーも同じ仕組みで照合します。

返却する照合結果とレポート形式は同じです。ファイル欠損は従来どおり`missing`、それ以外の読み込み失敗はエラーとして伝えます。プロジェクト内のパス検証・パッケージ外のリンク拒否を通過してから読み込む順序も維持します。manifest自体のJSON読み込みは従来どおりです。

逐次読み込みは複数ファイルの同時点スナップショットではありません。照合中の外部編集に対する原子性は追加していません。

## メモリ測定

Windows、Node 24.15.0、256 MiBの合成バイナリー、実際の`inspectCharacterPackage`を呼ぶ隔離したVitest fixtureで各1回測定しました。生成時は1 MiBの固定ブロックを繰り返して保存し、照合中の`process.memoryUsage()`を1 ms間隔と照合直後に採取しています。全バイトのSHA-256とサイズは両実行でassertに成功しました。

| 測定 | 修正前 | 修正後 |
|---|---:|---:|
| 照合によるArrayBuffer増加の観測ピーク | 256.00 MiB | 55.08 MiB |
| RSS増加の観測ピーク | 256.52 MiB | 56.24 MiB |
| 照合時間 | 419.8 ms | 661.2 ms |

この条件ではメモリ増加が減り、処理時間は延びました。GC・OSキャッシュ・ホスト負荷・採取間隔に左右される1回ずつの測定であり、常にこのメモリ量に収まる保証や、速度向上の主張ではありません。ReadStreamのバッファ以外のメモリも測定に含まれます。

根拠は`.local/polish-20260914/package-memory-before.json`と`package-memory-after.json`、各同名`.log`です。fixtureは同ディレクトリの`package-memory.test.ts`、設定は`package-memory.config.ts`です。リポジトリルートから`node node_modules/vitest/vitest.mjs run --config .local/polish-20260914/package-memory.config.ts`で現在の実装を再測定でき、`package-memory-measurement.json`へ保存します。実行ごとに256 MiBの合成ファイルを新しい`.local/tests/package-memory-*`へ作ります。通常のテストにはこの大型fixtureを含めません。

## 検証

既存3件に加え、0・65,537・2,097,169 bytesの照合と同じサイズの途中編集を確認する3件、およびディレクトリを成果物として登録した際の`EISDIR`伝播1件を追加しました。文字コードへの変換や先頭だけの読み込みではなく、全バイトを計算することを確認します。

実行場所はリポジトリルート、対象は本変更後、ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `package-streaming-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `package-streaming-lint.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.backend.config.ts tests/backend/package-inspection.test.ts` | 0 | 7件PASS | `package-streaming-focused.log` |
| `npm test` | 0 | 単体68・backend170件PASS | `package-streaming-test.log` |
| 同じbuildで全体E2Eをnative診断 | 0 | Electron 30件PASS、5.0分。例外採取0・期限超過0 | `package-streaming-e2e-native.log`と同`.stdout.log` |

初回の`npm run test:e2e`はbuild成功後、29件PASS・1件FAIL・exit 1でした（`package-streaming-e2e.log`、4.4分）。Demo側のパッケージ比較が0 msの失敗として記録され、最終エラーは`worker process exited unexpectedly (code=3221226505, signal=null)`でした。Codex側の比較と両モードの照合は成功しましたが、全体成功とは扱いません。同時刻付近のWindows ApplicationログにはID 1000/1001の該当記録がありませんでした。

インストール済みPlaywrightの`lib/runner/index.js`では、worker異常終了時に実行中のテストがなければ、残るテストへ失敗を割り当てます（`onExit`→`_onDone`→`_massSkipTestsFromRemaining`）。したがって、0 msと表示されたテスト名だけでは、どの処理がnative例外を起こしたかは確定できません。

同じbuildで既存native診断から全30件を再実行し、30件PASS・exit 0・5.0分でした。nativeログ末尾は`complete root-exit=00000000 captured=0 timeout=0`です。診断ソースとbuild用コピーのSHA-256一致を確認し、実行したコマンドは`.local/polish-20260914/native-debugger.exe --timeout-ms 600000 <log> .local/polish-20260914 <node.exe> node_modules/@playwright/test/cli.js test`です。通常のNode・テスト対象・制限時間・retry設定は変更していません。

単体68・backend170・診断下E2E30の計268件の成功を確認しました。ただしデバッガーは実行タイミングを変えるため、診断下で再発しなかったことはnative問題解消の証明ではありません。通常E2Eの初回失敗を未解決として残します。

初回に成功した画面とレポートは`package-streaming-inspection-demo.png`/`.md`と`package-streaming-comparison-codex.png`/`.md`へ保存しました。2枚を開き、変更・欠損・両側のhash・コピー成功の表示を確認しています。

実モデル推論・APIキー使用・既存ワールド変更はありません。CLI接続・保存処理の実装は変更していないため、専用のCLI8件・保存4件は今回再実行していません。[39](39-production-late-start-interrupt.md)のnative異常終了は今回の変更で解決したとは扱いません。

## 試し方・戻し方

`npm run build`、`npm start`後、生成済みNPCの「成果物を照合」を使います。「別のパッケージとファイルを比較」も同じ分割読み込みを使用します。認証なしで試す場合は`npm run demo:review`で合成資料を開けます。

`git log --oneline -- improvements/41-package-streaming-hash.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
