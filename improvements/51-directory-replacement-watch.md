# 51 — ディレクトリ復元後も子ファイルを監視・表示する

50で再現した、ディレクトリを退避し、同名の一時ファイルを挟んで元へ戻した後に子ファイルが一覧から欠ける経路を修正しました。監視ライブラリの種類変更と通知順序、Workspaceの一覧反映を合わせて扱います。文章・バイナリー・後から追加したファイルを対象にしており、ゲームやNPCの形式には依存しません。

## 変更

- chokidarの書き込み完了待ちでファイルがディレクトリへ変わった場合、古いファイル監視を閉じ、元のWatchHelperとdepthで監視を開始し直します。追加待ち・変更待ちの両方を扱い、置換前のlistenerが後から新しい監視を削除しないようにします。
- 同名ファイルの削除通知がatomic処理で遅延している場合、ディレクトリ追加より先に削除を通知します。復元した一覧を遅れて来た削除で消さないようにします。
- 追加通知の処理時に項目が既に移動・削除済みでENOENTになった場合、現在の削除状態を一覧へ反映します。権限エラーなど、ENOENT以外の例外は既存のエラー表示へ渡します。
- 親ディレクトリの削除で一覧から消えた子に`change`が届いた場合も、現在のmetadataから子を一覧へ戻します。chokidarが短時間のunlink/addをchangeへまとめるためです。
- 走査中にディレクトリがファイルへ変わって`ENOTDIR`になった場合も、走査の抑制状態を解放し、待機中のPromiseを完了させます。エラーは既存の診断処理へ渡します。
- 追加通知が書き込み完了を待っている間にファイルを削除した場合、通知を取り消してから監視と管理エントリーも解放します。未通知の追加に対する削除通知は出しません。古い監視が復元先に干渉する原因を取り除きます。

既存の`patches/chokidar+5.0.0.patch`へ追加し、JavaScriptと型定義を揃えました。48の監視開始順序の修正も含みます。依存の追加・バージョン変更はありません。`npm ci`のpostinstallで適用され、起動し直したアプリで有効になります。

## 再現と検証

`tests/unit/workspace-directory-replacement.test.ts`に10件の回帰検証を追加しました。復元後のファイル一覧、後から作った子・孫ファイル、既存ファイルの更新、tmpの除外、追加待ち・変更待ちでのdepth維持、通知順序、移動済み項目、権限エラー、changeへ統合された再追加、走査エラー後の解放、追加待ち中の監視解除を確認します。通知順序と統合のテストではchokidarへ通知を与えて順序を固定し、実Workspaceの一覧を検証します。ファイル移動や後続ファイルの確認は実ファイルシステムを使います。

修正前の種類変更4件は3件FAIL・1件PASS（`directory-replacement-unit-before.log`）、削除通知順の1件もFAIL（`directory-replacement-order-before.log`）、移動済み項目の2件は1件FAIL・1件PASS（`directory-stale-add-before.log`）、changeに統合される子の再追加1件もFAIL（`directory-child-change-before.log`）でした。すべて元のassertionを保って修正しています。

途中版の対象8件と48の開始・終了3件は計11件PASS（`directory-replacement-eleven-after.log`）、50の独立診断2件もPASSでした（`directory-replacement-reconciled-diagnostic.log`）。しかし、実画面で復元後の`manifest.json`表示を確認すると失敗したため、検証を追加しました。走査エラー後の抑制解除1件（`directory-scan-error-before.log`）と追加待ち中の監視解除1件（`directory-pending-add-before.log`）はいずれも修正前にFAILになっています。

最終の対象10件と48の開始・終了3件は計13件PASSです（exit 0、3.41秒、`directory-pending-add-after.log`）。計測コードを入れない通常Electronでの保存先復元も5件すべてPASSし、保存済み表示と`manifest.json`の復帰を確認しました（exit 0、16.2秒、`directory-pending-add-ui.log`）。実画面の表示確認は通常の`persistence.spec.ts`へ追加しています。

全コマンドはプロジェクトルートで実行し、ログは`.local/polish-20260914/`へ保存しました。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run postinstall` | 0 | 未修正のchokidar配布ファイルへ適用し、4ファイルのhashが検証した内容と一致。node-ptyパッチも成功 | `directory-watch-final-patch.log` |
| `npm run typecheck` | 0 | 成功 | `directory-watch-final-static.log` |
| `npm run lint` | 0 | 警告0・成功 | `directory-watch-final-static.log` |
| `npm run build` | 0 | 通常build成功。既存のzodに関するRollup警告あり | `directory-watch-final-build.log` |
| `npm test` | 0 | 単体84件・backend170件PASS | `directory-watch-final-test.log` |
| `node node_modules/@playwright/test/cli.js test` | 0 | 通常Electronの全34件PASS、4.5分 | `directory-watch-final-e2e.log` |
| `npm run test:connection` | 0 | localhost fixtureの実CLI接続8件PASS、55.79秒 | `directory-watch-final-connection.log` |
| `npm run test:persistence` | 0 | 保存4件PASS、52.37秒 | `directory-watch-final-persistence.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.directory-replacement.config.ts` | 0 | 50の独立診断2件PASS、1.16秒 | `directory-watch-final-diagnostic.log` |

最終状態で通常の単体・backend・Electron・CLI・保存の計300件がPASSです。これとは別に、独立診断2件と復元ケースの5回検証も成功しました。実CLIはlocalhost fixtureに接続し、実モデル推論は行っていません。

途中版の全体検証では、通知順序の問題で単体77件PASS・1件FAIL（`directory-replacement-final-test.log`）、移動済み項目のENOENTで単体78件PASS・1件FAIL（`directory-replacement-complete-test.log`）がありました。どちらもbackendへ進む前に終了しています。修正を進めた版では単体81・backend170件が成功しましたが、その後の独立診断で子へのchange通知を反映できない別経路が1件FAILになりました（`directory-replacement-release-diagnostic.log`）。その記録では子の監視は存在し、通知も届いている一方、一覧に子がないと確認できたため、Workspaceのchange反映を修正しました。途中結果を最終版の検証とは扱いません。

子へのchange反映を加える前の通常E2Eは33件PASS・端末のコピー確認で1件FAILでした（exit 1、5.5分、`directory-replacement-release-e2e.log`）。対象の文字列がクリップボードへ入らず、原因は未確定です。`directory-replacement-clipboard-failure.zip`にtraceを保存しました。検証外のクリップボード本文はこの記録へ転載していません。

走査エラー後の解放だけを直した途中版でも、通常の保存画面3件は1件FAIL・2件PASS（`directory-scan-error-ui.log`）、計測付き復元5件は1件FAIL・4件PASSでした。失敗した`.local/e2e/persistence-2SOLl5/runs/watch-type-472.json`には、復元先の子の追加後に古い監視が親へのunlinkを送る順序が残っています。追加待ち中の監視解除を直した根拠であり、成功するまで同じテストを繰り返した結果とは扱いません。

調査中、ユーザーから`electron.exe / 0x80000003 / 0x00007FF7D731D9C9`の通知を受けました。sandbox内の診断ではGPU子プロセスが`C0000135`で繰り返し終了し、`GPU process isn't usable`で停止しました。診断器は次のアドレス`0x00007FF7D731D9CA`で`C000001D`を採取しています（`directory-type-ui-native.log`、`native-19884-162947515.dmp`）。制限外の同じ診断ではnative例外0・期限超過0で実画面へ進み、保存一覧のassertionで終了しました（`directory-type-ui-native-unrestricted.log`）。今回の起動失敗は実行環境の制限と関連すると判断していますが、過去の`C0000409`と同じ原因とは判断していません。診断用importは通常buildから取り外し、OSやGPU設定は変更していません。

パス境界は、引き続きWorkspaceの相対パス検証・realpathでの内外判定を通ります。監視し直す際も元の条件を引き継ぎます。追加した権限エラー検証に加え、既存のtraversal・外部junctionの読み書き拒否・内部junctionの保存検証も単体テストの対象です。`npm ci`全体は再実行していません。パッチの適用と結果のhash一致を検証しました。hash一覧は`chokidar-type-change-hashes.json`です。

48で自然発生した保存テストのrename失敗、その元エラーと今回の監視問題との同一性、過去のnative異常終了は引き続き未確定です。今回の修正でそれらすべてを解決したとは扱いません。実モデル推論・APIキー使用はありません。最終の通常画面検証で保存した`directory-watch-restored.png`でも、保存済み表示と復元した`persistence/manifest.json`を確認しました。

## 試し方・戻し方

通常は`npm ci`でパッチが適用されます。48の旧パッチを適用済みの環境から更新する場合も`npm ci`で依存を再インストールし、`npm run build`でアプリを作り直して起動してください。この作業環境には最終パッチを適用済みです。

旧パッチを適用した隔離コピーへ、新しいパッチを重ねる検証は適用失敗になりました（exit 1、`directory-replacement-patch-upgrade.log`）。そのため、旧環境に`npm run postinstall`を重ねるだけの手順は使いません。未修正の配布ファイルへ適用する手順は上表のとおり成功しています。対象検証は次で実行できます。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/workspace-directory-replacement.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.directory-replacement.config.ts
```

`git log --oneline -- improvements/51-directory-replacement-watch.md`でコミットを確認し、`git revert <commit>`で取り消せます。適用済みのnode_modulesはGitのrevertだけでは戻らないため、`npm ci`で48のパッチだけを適用した依存へ戻してから`npm run build`を実行してください。データ移行は不要です。
