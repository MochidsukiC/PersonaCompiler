# 50 — ディレクトリを退避・復元した後の一覧欠落を再現する

保存テストの退避・復元操作を、実Workspaceとchokidarを使う2条件に切り出しました。`assets`ディレクトリを別名へ退避し、同じパスへ一時的なファイルを置き、そのファイルを移動してディレクトリを戻します。文章・バイナリー各1ファイルを使い、ゲーム形式やNPCのschemaに依存しない診断にしています。

**不具合は未修正です。** 中間状態の通知を待たずに操作すると、5秒後もディスクに存在する2ファイルが公開一覧から欠けました。中間状態が公開一覧へ反映されてから戻す条件では一致しました。通常テストとは別の明示的な診断コマンドとして再現手順を保存します。時間制限やassertionを緩めて成功扱いにはしていません。

## 確認した経路

失敗条件の記録では、`assets`を`_handleFile`がファイルとして扱い、ファイルの`add`を準備しています。その後、書き込み完了待ちの間にディレクトリへ戻りますが、通知の種類は`add`のまま、Statsだけがディレクトリになっています。chokidarの監視対象には`assets`ディレクトリがなく、子ファイルの追加通知もありません。

Workspaceは通知後のstatに従って`assets`というディレクトリを一覧へ載せますが、子ファイルを受け取れません。公開一覧のerrorもnullです。単に画面の描画が遅い状態ではありません。`_awaitWriteFinish`がファイルの種類変更を扱わず、ファイル用の監視からディレクトリ用の再帰監視へ切り替わらない経路まで絞れました。

[chokidarの説明](https://github.com/paulmillr/chokidar#readme)でも、`awaitWriteFinish`はファイルサイズの安定を待ってadd/changeを通知する機能とされています。上流の[issue 1464](https://github.com/paulmillr/chokidar/issues/1464)にはWindowsでディレクトリを同名ファイルへ置き換えた際の停止が報告されていますが、今回の「復元後の子ファイル欠落」と同じ原因だとは確認していません。

48の自然発生した保存テストのrename失敗の原因は、引き続き未確定です。今回の診断ではrename自体は成功しています。両者を同じ不具合として扱いません。過去のnative異常終了も未解決です。

## 実行と記録

プロジェクトルートで次を実行します。モデル推論・認証は不要です。

```powershell
node node_modules/vitest/vitest.mjs run --config vitest.directory-replacement.config.ts
```

対象は`tests/diagnostics/workspace-directory-replacement.test.ts`の2件だけです。通常の`npm test`には入りません。各実行の`.local/directory-replacement/case-*/observations.json`へ、公開一覧、監視通知、通知前の判定、終了直前の監視対象、実ディスクの一覧を記録します。記録ファイルは監視対象のworkspaceの外へ保存します。既存の通常データには触れません。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `directory-replacement-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `directory-replacement-lint.log` |
| 上記の独立診断 | 1 | 1件FAIL（子ファイル2件欠落）・1件PASS、5.94秒 | `directory-replacement-diagnostic.log` |
| `node .local/polish-20260914/verify-directory-replacement.mjs` | 0 | 2条件のディスク・公開一覧・型判定・監視対象を照合 | `directory-replacement-verification.log` |

ログは`.local/polish-20260914/`です。照合結果は`directory-replacement-evidence.json`にまとめています。診断の失敗を再現できたことと、アプリの検証成功は区別します。

調査用の初回2条件も1件FAIL・1件PASSでした（`workspace-directory-moves.log`）。通知記録を追加した実行も同じ結果です（`workspace-directory-moves-trace.log`、`workspace-directory-type-trace.log`）。親ディレクトリの再列挙時に種類の変化を検出する修正候補は改善しませんでした（`workspace-directory-moves-after.log`）。その候補は戻し、インストール済みhandlerが48で検証したSHA-256 `87E612A4598C10DE2BEB5B667AE7C1DC44A61E356A2D6A77AF35FB02060C7F80`と一致することを確認しています。

今回は診断と記録だけの変更です。アプリのbuild・単体/backend・CLI接続・保存・通常E2Eは再実行していません。49の通常E2E全34件PASSは、今回追加した種類変更の条件を網羅する証拠ではありません。

## 次の修正で確認すること・戻し方

書き込み完了待ち中にファイルがディレクトリへ変わった場合、古い監視を終了し、元の除外条件・深さ・symlink方針を保って再帰監視へ切り替える必要があります。単に通知名を変えるだけでは、後から作られる子ファイルを監視できません。この境界を修正してから本診断の成功と通常検証を確認します。

`git log --oneline -- improvements/50-directory-replacement-diagnostic.md`でコミットを確認し、`git revert <commit>`で診断と記録を取り消せます。依存やデータ形式の変更はありません。
