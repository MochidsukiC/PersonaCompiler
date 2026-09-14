# 28 — DEV検証で初期チェックポイントの保存を待つ

DEV操作のE2Eが、初期チェックポイントの保存前に配列の先頭を読み、`undefined.runId`で失敗する競合を修正しました。アプリ本体は変更していません。

`enableDev()`はDEV状態を作って保存した後、`captureDev('DEV開始地点')`を非同期で実行します。既存テストは「DEV ON」の表示直後に`devPanel().checkpoints[0]`を取得していたため、保存完了前の空配列を取得する場合がありました。

初期チェックポイントのselectに、プレースホルダーと保存地点の計2項目が表示されることを待ってから取得するようにしました。待ち時間を固定で延長せず、検証する対象そのものの存在を確認します。プロンプト適用・実験分岐・過去の版への復元の既存assertionは維持しています。

## 検証

`.local/polish-20260914/readiness-e2e.log`で修正前の全体検証がexit 1、22件PASS・DEV1件FAILでした。失敗の詳細とtraceは`dev-checkpoint-race-error.md`・`dev-checkpoint-race-trace.zip`へ保存しています。

- `npx playwright test tests/e2e/dev.spec.ts`: exit 0、1件PASS、`dev-checkpoint-wait.log`
- `npm run typecheck`: exit 0、`readiness-final-typecheck.log`
- `npm run lint`: exit 0、警告0、`readiness-final-lint.log`

検証はローカルfixtureのみです。アプリの新しいbuildはこのテストだけの変更に不要で、失敗した全体検証と同じbuildを使用しました。別途作業中のHTTP本文解放の修正は、このコミットには含めていません。

## 戻し方

`git log --oneline -- improvements/28-dev-checkpoint-test-wait.md`でコミットを確認し、`git revert <commit>`で戻せます。アプリの保存データには影響しません。
