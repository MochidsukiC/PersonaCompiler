# 08 — 端末の幅変更が1回の失敗で止まる不具合を修正

端末サイズの変更要求を順番に送るPromiseが、IPCの失敗後もreject状態のまま残っていました。エラーを閉じてもう一度幅を変えても、新しいサイズがバックエンドへ届かず、同じエラーだけが再表示されていました。

各要求のエラーを画面に報告したところでキュー内の処理を完了させ、次の幅変更を順番に送れるようにしました。失敗した要求の自動再送は行いません。モデル、ゲームのデータ形式、保存形式は変更していません。

## 確認方法

`npm run build`後、`npx playwright test tests/e2e/terminal-resize.spec.ts`で確認できます。実モデルや既存ワールドは使わず、隔離したElectronのデモで最初のサイズ変更IPCだけを失敗させます。

1. 端末境界をドラッグし、失敗が画面に表示されることを確認。
2. エラーを閉じ、もう一度ドラッグ。
3. 新しいサイズ変更IPCが届き、以前のエラーが再表示されないことを確認。

修正前ソースでは手順3で新しい列数が届かず、対象1件FAIL・exit 1となりました。ログ: `.local/polish-20260914/terminal-resize-reproduction-v2.log`。

初回の追加テストはIPC回数が1回になると仮定していましたが、エラーバナーの表示で端末の高さも変わるため、修正後は2回になって失敗しました（`terminal-e2e.log`、15件PASS・追加1件FAIL、exit 1）。判定を「次のドラッグで増えた列数が届く」に修正し、修正前ソースでも実際に失敗することを再確認しています。

## 検証

検証のcwdはリポジトリルート。ログは`.local/polish-20260914/terminal-*.log`に保存しています。CLI接続・保存処理には変更がないため、直前の[07](07-package-inspection.md)で成功したCLI7件・保存4件の検証を繰り返していません。

| command | 最終結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `terminal-typecheck-final.log` |
| `npm run lint` | exit 0、警告0 | `terminal-lint-final.log` |
| `npm test` | exit 0、単体40・backend124件PASS | `terminal-test.log` |
| `npm run test:e2e` | exit 0、build・Electron E2E16件PASS | `terminal-e2e-final.log` |

今回実行したテストは合計180件PASS。変更のないCLI7・保存4件の直前の証拠と合わせ、現在の検証対象は191件です。テスト除外・閾値・警告設定は変更していません。実モデル試運転・APIキー使用はありません。

[06](06-relationship-evidence.md)で記録したnative Worker異常終了と今回のUI不具合との関連は確認できていません。native終了は原因未確定のままで、今回の修正で解決したとは扱いません。

## 戻し方

`git log --oneline -- improvements/08-terminal-resize.md`で修正コミットを確認し、`git revert <commit>`してください。
