# 22 — Compilation生成中の入力変更でmanifestの根拠hashがずれる不具合を修正

Compilationは生成開始前に入力hashを検証していましたが、manifestを書き出す際に入力ファイルを読み直してhashを採っていました。この間に入力を外部編集すると、古い入力で生成した成果物に、新しい入力のhashを記録してしまいました。

## 修正内容

実際に読み込み・検証した入力のhashを生成処理内で保持し、manifestへその値を書き込みます。生成が戻った段階でも入力を再検証し、生成中に変更されていれば、そのNPCのCompilationを具体的な入力変更エラーで停止します。結果が不整合なパッケージを完成扱いにせず、他NPCの正常な成果物は維持します。

検証後に行う個々の成果物保存中に外部編集が入っても、manifestのhashは実際の生成入力から変わりません。入力ファイル全体を外部編集からロックする変更ではありません。やり直す場合は既存の明示的な再生成操作を使い、世界の資料から新しい入力を作ります。手編集した入力ファイルを次の生成へ採用する機能ではありません。

形式固有の分岐やゲームジャンルの条件は追加していません。入力と成果物の対応を保持する共通処理です。保存形式・依存・モデル設定は変更していません。

## 試し方

リポジトリルートで`npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts`を実行します。モデルを呼ばず、通常のBackendEngineと保存処理を使ったfixtureで確認できます。

新しい2ケースは、①生成開始後、②最初の成果物保存中に入力ファイルの人物名を変更します。①は対象NPCだけが失敗し、manifestが公開されず、他4人のCompilationが成功することを確認します。②は成果物が元の人物名を保持し、manifestのinputHashが生成開始時の入力hashと一致することを確認します。

## 検証記録

ログは`.local/polish-20260914/`にあります。修正前は11件中2件失敗・9件成功（exit 1、`compiler-input-provenance-before.log`）。生成中の変更を成功扱いにすること、保存中の変更後のhashをmanifestへ書くことをそれぞれ再現しました。修正後は対象11件すべて成功（exit 0、`compiler-input-provenance-after.log`）。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `compiler-provenance-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `compiler-provenance-lint.log` |
| `npm test` | exit 0、単体53・backend135件PASS | `compiler-provenance-test.log` |
| `npm run test:connection` | exit 0、CLI/TUI接続8件PASS | `compiler-provenance-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `compiler-provenance-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全18件PASS | `compiler-provenance-e2e.log` |

最終ソースで計218件PASS。実モデル・APIキー・既存ワールドは使用していません。今回の検証ではnative異常終了は再発しませんでしたが、[21](21-native-node-shutdown.md)の元のCLI異常終了は未解決です。この修正による解消とは扱いません。

## 戻し方

`git log --oneline -- improvements/22-compilation-input-provenance.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ変換は不要ですが、生成中に入力を編集した際の誤ったmanifest記録も戻ります。
