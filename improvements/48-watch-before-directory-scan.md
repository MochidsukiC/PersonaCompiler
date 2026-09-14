# 48 — 新しいディレクトリの列挙前に監視を開始する

chokidar 5.0.0は、新しいディレクトリの中身を列挙し終えてから、そのディレクトリの監視を開始していました。列挙が終わった後、監視が始まるまでに作られたファイルは、初回一覧にも追加通知にも入らない競合があります。

このタイミングを固定するテストで、`compilation/baseline/npcs/npc0/manifest.json`と`assets/dialogue.txt`が実在しても、Workspaceの公開一覧に含まれないことを再現しました。単なる待ち時間の延長では検出できず、別の変更が届くまで欠けたままになる経路です。

## 修正

chokidarの`_handleDir`で、ディレクトリ監視を初回列挙より先に開始します。同時に監視ハンドルを既存の終了管理へ登録し、列挙中に閉じられても列挙完了を待たずに解放します。呼出元での二重登録は行いません。

`patches/chokidar+5.0.0.patch`で管理し、既存の`patch-package`のpostinstallへ組み込みます。パッケージのバージョン変更や依存の追加はありません。未修正のhandlerへ戻したうえで`npm run postinstall`を実行し、検証した修正と同じSHA-256になることを確認しました。

ゲームや成果物の形式に依存せず、新しく作られるすべての監視対象ディレクトリに適用します。既存のsymlinkを追わない設定・除外条件・パス解決・書き込み完了待ちは維持します。

## 再現と検証

`tests/unit/workspace-watch-startup.test.ts`で、実際のchokidarとWorkspaceを使用します。初回列挙の完了直後にファイルを作ることで競合の順序を固定し、一覧とfileVersionsへの反映を確認します。モックの通知を直接Workspaceへ渡すテストではありません。

修正前は2件とも一覧欠落で失敗しました（exit 1、`watch-startup-before.log`）。修正後はその2件と、初回列挙中に閉じた監視ハンドルが1回だけ解放される検証の計3件が成功しました。

最初の修正案は列挙完了後に閉鎖を確認する実装でした。その状態で全体検証は成功しましたが、レビューで列挙待ち中の解放が遅れることに気付き、テストを列挙完了前の解放確認へ変更しました。2件PASS・終了の1件FAILで再現（exit 1、`watch-startup-close-before.log`）し、終了管理への登録を前倒しした最終版で3件PASSになりました。以下は最終版の検証です。

プロジェクトルートで実行しました。ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `node node_modules/vitest/vitest.mjs run tests/unit/workspace-watch-startup.test.ts` | 0 | 3件PASS、1.24秒 | `watch-startup-close-after.log` |
| `npm run postinstall` | 0 | 未修正のchokidarへパッチ適用成功。既存node-ptyパッチも成功 | `watch-startup-patch-final.log` |
| `npm run typecheck` | 0 | 成功 | `watch-startup-final-static.log` |
| `npm run lint` | 0 | 警告0・成功 | `watch-startup-final-static.log` |
| `npm run build` | 0 | 診断モジュールを含まない通常buildで成功。既存のzodに関するRollup警告あり | `watch-startup-final-build.log` |
| `npm test` | 0 | 単体74件・backend170件PASS | `watch-startup-final-test.log` |
| `npm run test:connection` | 0 | 実CLI接続8件PASS、71.60秒。localhostのResponses fixture、5.6 Luna/lowのbindingを使用 | `watch-startup-final-connection.log` |
| `npm run test:persistence` | 0 | 保存・終了・復元の4件PASS、114.09秒 | `watch-startup-final-persistence.log` |
| `node node_modules/@playwright/test/cli.js test` | 1 | 通常buildで33件PASS・保存エラー後の復元操作で1件FAIL、5.3分。成果物比較はDemo/CodexともPASS | `watch-startup-final-e2e.log` |

最終版の正式検証は計289件PASS・1件FAILです。対象3件は単体74件に含まれ、重複加算していません。実モデルの推論・APIキーの使用はありません。比較画面の画像を`watch-startup-package-comparison.png`へ保存し、目視確認しました。

失敗は`tests/e2e/persistence.spec.ts:14`です。後片付けの42行で`persistence`から`obstruction.txt`へのrenameがENOENTになり、元の失敗が上書きされています。失敗後のディスクには`persistence`と`saved-persistence`の両ディレクトリ、`obstruction.txt`が存在しました。最初のrename後・復元完了前に失敗したことは分かりますが、元のエラーと再作成の順序は未採取です。監視変更との因果関係も未確定です。`watch-startup-persistence-failure.zip`にtraceを保存し、成功するまでの再実行は行っていません。全体検証完了とは扱わず、保存テストの後片付けで元エラーが隠れる問題から継続調査します。過去のnative異常終了も未解決です。

適用後の`node_modules/chokidar/handler.js`のSHA-256は`87E612A4598C10DE2BEB5B667AE7C1DC44A61E356A2D6A77AF35FB02060C7F80`です。`npm ci`全体の再実行は行っていません。パッチ適用手順と最終ファイルの一致を検証しました。

## 過去の候補欠落との関係

46で採取した「manifestはディスクに存在するが、公開一覧とfileVersionsにはない」という症状を生む競合を再現・修正できました。ただし、過去の自然発生時に列挙と監視開始の間で作成されたことを示す直接のタイミング記録は取得できていません。過去の失敗がすべて同じ原因だったとは断定しません。

修正前には、監視中の処理を変えず終了時の状態だけを採取する診断も行いました。比較をDemo→Codexの順で10組、計20件実行しましたが再発しませんでした（exit 0、3.8分、`watch-close-comparison.log`）。その後、コードで見つけた競合を順序固定テストで再現しています。一時的な計測用buildは復元し、通常buildし直しました。

## 試し方・戻し方

通常は`npm ci`のpostinstallでパッチが適用されます。既存環境では`npm run postinstall`後に上記の再現テストを実行できます。通常の成果物比較は`npm run build`後に`node node_modules/@playwright/test/cli.js test tests/e2e/package-comparison.spec.ts`で推論なしに試せます。

`git log --oneline -- improvements/48-watch-before-directory-scan.md`でコミットを確認し、`git revert <commit>`で管理ファイルを戻せます。既に適用した依存パッチはGitのrevertだけでは外れないため、`npm ci`で依存を再インストールして未修正のchokidarへ戻し、`npm run build`を実行してください。データ移行は不要です。
