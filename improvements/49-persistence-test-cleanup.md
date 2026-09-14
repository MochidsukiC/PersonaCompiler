# 49 — 保存テストの元エラーと後片付けを保持する

48の通常E2Eでは、保存先の復元中に失敗した後、後片付けでも同じファイル移動を実行してENOENTになりました。この後片付けの例外が元のエラーを上書きし、続く`app.close()`にも到達していませんでした。

## 変更

`tests/e2e/persistence.spec.ts`の実worker保存テストで、ディスク状態を「元の状態」「退避済み」「障害物設置済み」に分け、各ファイル操作が成功した時点で更新します。復元途中で失敗した場合は、未完了の工程だけを後片付けで試みます。障害物の作成自体に失敗した場合も、退避済みディレクトリを戻せます。

テスト本体・復元・終了の例外をそれぞれ保持し、最後に元の例外をcauseとするAggregateErrorで失敗させます。各例外のstackと工程を出力します。復元に失敗してもアプリ終了を試みます。その場合に限り、隔離した検証用アプリの保存失敗ダイアログを「保存せず終了」にして、終了取り消しの待機を残さないようにします。

正常な検証経路の「終了を取り消す」確認、保存の再試行、保存manifestのdirty判定、再起動後の復元確認は維持します。アプリ本体や保存形式は変更していません。ゲーム形態やデータ内容に依存する分岐も追加していません。

## 原因について分かった範囲

本変更前に、後片付け前のエラーを別ファイルへ記録する診断を10回実行しましたが、自然発生した元の失敗は再発しませんでした（exit 0、10件PASS、58.2秒、`persistence-original-error.log`）。保存先の復元失敗そのものの原因は未確定です。後片付けの状態管理とエラーが隠れる問題を修正したもので、48の元の失敗や過去のnative異常終了が解消したとは扱いません。

## 検証

プロジェクトルートで実行しました。ログ・隔離fixtureは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `persistence-cleanup-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `persistence-cleanup-lint.log` |
| `node node_modules/@playwright/test/cli.js test --config .local/polish-20260914/cleanup-fault.config.ts` | 1 | 意図的な障害2件が想定どおり失敗。元のエラーと復元時のエラーを保持 | `persistence-cleanup-intentional-final.log` |
| `node .local/polish-20260914/verify-cleanup-faults.mjs` | 0 | 2種類の障害の記録・復元状態・Electron exit 0を照合 | `persistence-cleanup-fault-verification-final.log` |
| `node node_modules/@playwright/test/cli.js test` | 0 | 通常の全34件PASS、5.1分。前回失敗した保存ケースを含む | `persistence-cleanup-e2e.log` |

通常E2Eは既存の順序で1回実行し、全34件が成功しました。保存再試行後の画面も`persistence-cleanup-saved.png`に保存し、保存済みrevision 2/2の表示を目視確認しました。意図的な障害2件は通常の成功件数に加算していません。

意図的な障害は、退避直後で障害物の作成前に例外を投げるケースと、障害物を移動した直後に退避先を別名へ移して復元をENOENTにするケースです。前者は元のディレクトリへ戻し、元の例外1件を保持して正常終了しました。後者は完了済みの障害物移動を繰り返さず、テスト本体と復元のENOENTを2件とも記録して正常終了しました。後者の退避データは`preserved-fixture-backup`へ残しています。記録は`persistence-cleanup-fault-summary.json`です。

最初の診断fixtureは、Electron終了後に`app.process()`を呼んでTypeErrorになりました（`persistence-cleanup-intentional.log`）。プロセス参照を起動直後に取得するように直し、再検証しました。また、最初の集計は`runs`内の管理ファイルまでrunとして数えたため失敗しました（`persistence-cleanup-fault-verification.log`）。実在するrunディレクトリだけを数え、manifestのdirty=falseも確認しています。これらは診断コードの問題であり、正式な検証の成功件数に含めていません。

テストと記録のみの変更のため、アプリのbuild、単体・backend、CLI接続、保存専用テストは再実行していません。48で検証した通常buildを使用しています。実モデル推論・APIキー使用はありません。

## 試し方・戻し方

`npm run build`後に`node node_modules/@playwright/test/cli.js test tests/e2e/persistence.spec.ts`で、保存画面の3件をモデル推論なしで確認できます。失敗時には`test`・`restore`・`close`の該当工程と元のstackを確認してください。意図的な失敗fixtureはGit管理外で、通常の検証対象には入りません。

`git log --oneline -- improvements/49-persistence-test-cleanup.md`でコミットを確認し、`git revert <commit>`で取り消せます。依存の再インストールやデータ移行は不要です。
