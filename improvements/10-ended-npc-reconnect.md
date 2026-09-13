# 10 — 終了済みワールドのNPC端末を再接続しない

シミュレーション終了後のNPCは閲覧専用ですが、`terminalReconnect`コマンドには終了状態の確認がなく、NPCのConversation再開と端末起動まで実行できました。通常画面では再接続ボタンが無効なため、バックエンドの直接呼出しを使った回帰テストで再現しました。

再接続の前に、NPCかつワールド終了済みの場合は明示的に拒否します。既存の死亡済みNPCの判定も保持します。端末表示・入力と同じ閲覧専用の境界になり、親端末はNPCパッケージの制作操作のために再接続できます。

これはバックエンドの入口での拒否漏れです。終了後のNPCが実モデル推論を実行できることまで再現したわけではありません。既存の端末Relayにも推論を禁止する方針があり、今回の修正は不要なConversation再開・PTY起動自体を防ぎます。

## 確認方法

`npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts -t "rejects terminal reconnection"`で実モデルを使わずに確認できます。

- 終了済みワールドのNPCへの再接続: 閲覧専用エラー、Runtime.resumeも端末attachも0回
- 同じNPCの端末表示・入力: 既存どおり拒否
- 制作を終えた親端末への再接続: resume・attach各1回

既存の保存データ、モデル、Prompt、ゲームの時間や行動形式は変更していません。

## 検証

修正前ソースでは対象1件FAIL・対象外8件skip、exit 1。ログは`.local/polish-20260914/ended-reconnect-reproduction.log`です。

追加テストの型と、既存の端末表示エラー文に関する期待値を修正しました（初回`ended-reconnect-typecheck.log`はexit 2、`ended-reconnect-test.log`は単体43・backend124件PASS、追加1件FAILでexit 1）。期待値の修正後、Compiler関連9件PASS・exit 0を確認しました（`ended-reconnect-compiler-final.log`）。

リポジトリルートで最終ソースの全ゲートを確認しました。ログは`.local/polish-20260914/`です。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `ended-reconnect-typecheck-final.log` |
| `npm run lint` | exit 0、警告0 | `ended-reconnect-lint-final.log` |
| `npm test` | exit 0、単体43・backend125件PASS | `ended-reconnect-test-final.log` |
| `npm run test:e2e` | exit 0、build・Electron E2E18件PASS | `ended-reconnect-e2e.log` |
| `npm run test:connection` | exit 0、localhost fixtureで7件PASS | `ended-reconnect-connection.log` |
| `npm run test:persistence` | exit 0、native保存4件PASS | `ended-reconnect-persistence.log` |

合計197件PASS。Compiler対象再実行9件は重複計上していません。実モデル推論・APIキー使用はありません。native検証は互いに重ねず実行し、テスト除外・閾値・警告設定は変更していません。[06](06-relationship-evidence.md)で記録したnative異常終了の原因は未確定のままです。

## 戻し方

`git log --oneline -- improvements/10-ended-npc-reconnect.md`でコミットを確認し、`git revert <commit>`してください。
