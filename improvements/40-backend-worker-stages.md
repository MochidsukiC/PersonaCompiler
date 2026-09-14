# 40 — Backend workerの異常終了直前のテストを記録

[39](39-production-late-start-interrupt.md)でRPC workerが`3221226505`で終了しました。Vitestの`during started state`はworkerの稼働状態で、テスト開始前を意味しません。最後に到達したテスト段階を次の調査で確認できるよう、任意の診断設定を追加しました。native異常終了自体は未解決です。

## 変更と試し方

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.backend-stages.config.ts
# RPCの7件だけを確認
node node_modules/vitest/vitest.mjs run --config vitest.backend-stages.config.ts tests/backend/rpc.test.ts
```

リポジトリルートで実行すると、起動時に表示する`.local/backend-stages-*`へJSONLを保存します。記録内容はworker PID・UTC時刻・ファイル内連番・テストファイル・テスト名と、setup/beforeAll/beforeEach/afterEach/afterAllへの到達です。既存のnative診断とPIDで対応付けられます。[診断手順](../diagnostics/README.md)に併用コマンドを記載しました。

通常のbackend設定を引き継ぎ、対象・並列数・制限時間を維持します。通常の`npm test`や配布アプリには追加しません。特定のゲーム形式やモデルには依存しません。

`afterEach`は失敗後にも呼ばれるため、成功判定にはVitestの結果と終了コードを使います。突然のworker終了で記録が途切れた位置は手がかりであり、そのテストがnative例外の原因だとは断定できません。setup前の異常終了では記録を作れず、afterAllもプロセス終了完了を意味しません。同期書き込みやデバッガーは実行タイミングに影響します。

## 検証

対象状態はこの変更後、作業場所はリポジトリルートです。ログと一時fixtureは`.local/polish-20260914/`に保存しました。

| command / 対象 | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `backend-stages-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `backend-stages-lint.log` |
| `npm run build` | 0 | 成功。既存のzod内注釈に関するRollup警告あり | `backend-stages-build.log` |
| `npm test` | 0 | 通常の単体68・backend166件PASS | `backend-stages-default-test.log` |
| 診断設定でRPC単独 | 0 | 7件PASS・17段階記録 | `backend-stages-rpc.log` |
| 診断設定でbackend全体を単独実行 | 0 | 17ファイル・166件PASS、50.37秒 | `backend-stages-all.log` |
| 隔離した意図的失敗fixture | 1（期待どおり） | 1件PASS・1件FAIL。失敗後のafterEach/afterAllも記録 | `backend-stages-failure-isolated.log` |
| 同fixtureのworker自己終了 | 1（期待どおり） | unhandled error 1件。最後に開始したテスト名を保持 | `backend-stages-abrupt.log` |
| `node .local/polish-20260914/verify-backend-stages.mjs` | 0 | 下記4組のJSONLをassertで照合 | `backend-stages-record-verification.log` |

記録の照合では連番・PIDとファイル名の一致・UTC時刻の解釈・テストパス・開始と終了のテスト名の一致を確認しました。

- `.local/backend-stages-PL20oS`: RPC 1ファイル・7件・17記録。
- `.local/backend-stages-BYRmgN`: backend 17ファイル・166件・383記録。
- `.local/backend-stages-ZkTeYX`: 意図的な失敗を含む2件・7記録。失敗を成功扱いしていません。
- `.local/backend-stages-mIsa8Y`: worker自己終了。5記録で途切れ、最後の`beforeEach`が対象テスト名を保持しました。runnerへ結果が届かないため、先行テストのhook到達をPASS件数とは数えていません。

最初の一時fixture設定で`mergeConfig`を使うとinclude配列が追加され、意図せず通常backendも対象に入りました。native診断の全体実行と重複し、通常側のDEV最終チェックポイントとnative側のDEV巻き戻しが、それぞれ既存の20秒制限で失敗しました。前者は166件PASS・2件FAIL（うち1件は意図的失敗）、後者は165件PASS・1件FAILで、いずれもexit 1です（`backend-stages-failure.log`、`backend-stages-native.log.stdout.log`）。nativeログは`root-exit=00000001 captured=0 timeout=0`でした。これらを全体成功とは扱いません。

一時fixture設定を明示的な対象置換に修正し、fixture単独、診断設定の全体単独、通常の`npm test`で再検証しました。制限時間・テストのassertionや対象除外は変更していません。二重実行と計測の負荷が時間切れに影響した可能性はありますが、時間切れの直接原因とnative異常終了の原因を同一とは扱いません。

今回の変更は任意のテスト診断設定だけで、アプリ動作・画面・CLI・保存契約の変更はありません。そのためElectron E2E・CLI接続・保存の検証は再実行していません。直前の実行結果は[39](39-production-late-start-interrupt.md)の30・8・4件PASSです。実モデル推論・APIキー使用・既存ワールド変更はありません。

## 戻し方

`git log --oneline -- improvements/40-backend-worker-stages.md`でコミットを確認し、`git revert <commit>`で戻せます。データ移行やアプリの再buildは不要です。
