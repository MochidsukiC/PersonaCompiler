# 46 — ワールド切替時に地図・施設の選択状態を初期化

施設内部を開いたまま、同じ施設IDを含む別ワールドのsnapshotへ切り替えると、旧ワールドの施設選択・住宅選択・声量プレビュー・高さ設定が引き継がれていました。ワールド名やデータは切り替わっているのに、直前の閲覧状態が残る不具合です。DEV分岐のように、既存の地図を持つ別runへ切り替える経路に関係します。

## 修正

`WorldView`を`world:${runId}`で識別し、runIdが変わったときに地図・関係・施設の選択状態と配下の表示用コンポーネントを初期化します。同一runのmap revisionやシミュレーション更新では初期化しません。

施設の名前・種類・NPCのID形式には依存しません。同じIDを別ワールドで再利用しても、閲覧状態を混同しないための境界です。保存データ・モデル設定・分岐処理は変更していません。

## 再現と修正中の確認

既存の3D画面E2Eに、施設・住宅・住民・声量・高さを選択し、同一runの更新後はその状態を保持する確認と、別runへ切り替えた後の初期化確認を追加しました。分岐後も同じ施設・住民IDを使います。

修正前は、新しいワールド名が表示されても`facility-interior`が1件残り、0件を期待するassertionで失敗しました（exit 1、`world-view-boundary-before.log`、traceは`world-view-boundary-before.zip`）。

修正途中でkeyをrunIdだけにした際、隣の`BackendPanel`のkeyと重複させてしまいました。設定パネルが更新のたびに重複して残り、地図の高さが0になる症状をE2Eで検出しました（`world-view-boundary-after.log`）。ローカルのlayout診断でも再現し、祖先要素の寸法と画像を確認しています（`world-layout-diagnostic.log`・`world-layout-report.json`・`world-layout-results/`）。`world:`を付けてkeyを区別した最終実装では、同じE2Eが成功しました。この途中の実装はコミットしていません。

## 検証

プロジェクトルートで実行しました。ログと画像は`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 最終実装で成功 | `world-view-boundary-typecheck-final.log` |
| `npm run lint` | 0 | 最終実装で警告0・成功 | `world-view-boundary-lint-final.log` |
| `npm run build` | 0 | 最終実装で成功。既存のzod注釈に関するRollup警告あり | `world-view-boundary-build-final.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/life.spec.ts` | 0 | 既存の3D・声の範囲・端末・出来事の操作と、追加したrun境界の1件PASS、8.8秒 | `world-view-boundary-after-final.log` |
| `npm test` | 0 | 単体71件・backend170件PASS | `world-view-boundary-test.log` |
| `node node_modules/@playwright/test/cli.js test` | 1 | ワールド切替を含む33件PASS・比較候補欠落で1件FAIL、5.2分 | `world-view-boundary-e2e.log` |

全画面回帰で、44で発生したCodex側の比較候補欠落が再発しました。今回のワールド切替テストは成功していますが、全体をPASSとは扱いません。45で追加した診断により、今回は次の実状態を取得できました。

- 実ディスクには`compilation/baseline/npcs/npc0/manifest.json`が存在しています。
- backendの公開一覧にはbaselineの他の4ファイルがあり、manifestだけがありません。対応する`fileVersions`の項目もなく、workspace errorはnullです。
- 画面の比較候補は未選択option 1件だけで、公開一覧と整合しています。

したがって、調査対象はファイル監視通知からbackendの一覧反映までの経路です。画面が候補を勝手に除外したという証拠はありません。監視自体が通知しなかったのか、その後の処理なのかは未確定です。今回のrun境界修正とは別の既存不具合として引き続き調べます。同じ全体テストの単純な再実行で解決扱いにはしていません。

今回のtraceは`world-view-boundary-package-failure.zip`です。4種のattachmentが入っており、JSONは`package-recurrence-*.json`、画像は`package-recurrence.png`へ取り出しました。今回の検証でnative異常終了は再発していません。

最終画像`world-view-boundary-final.png`を開き、分岐後のワールド名と、開き直した施設の高さ上限2・中声量・住宅と住民の未選択状態を確認しました。元の住民データと施設は保持しています。

今回の分岐操作はIPC fixtureによる画面検証です。実ワールドでの分岐やモデル推論は実行していません。保存・CLI実装は変更していないため、専用の接続8件・保存4件は再実行していません。比較候補欠落と既知のnative異常終了を、この変更で解決したとは扱いません。

## 試し方・戻し方

`npm run build`後、上記のlife E2Eで認証・推論なしに確認できます。通常のアプリでは施設内部を開いてDEVで別runへ分岐した際、新しいrunの地図へ戻り、施設は改めて選択できます。同じrun内の通常更新では閲覧設定が維持されます。

`git log --oneline -- improvements/46-world-view-run-boundary.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
