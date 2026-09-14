# 23 — 親へ渡す制作入力の変更を検出して、不整合な結果の採用を止める

[22](22-compilation-input-provenance.md)でCompilationの保存入力とmanifestの対応を修正した後、親へ実際に渡す`preparation/work/production/<id>/input.json`のコピーを調べました。このコピーは検証されておらず、送信前や生成中に変更しても結果を受理していました。出生とCompilationの両方で再現しました。

## 修正内容

親の制作処理を開始するときに入力を一度シリアライズし、そのhashを保持します。推論要求の直前と結果採用前にファイルを照合し、変更されていれば種類・対象ID・処理IDを含む具体的なエラーにします。エラー文へ入力本文は含めません。

送信前に検出した場合は推論要求を送らず、処理を`failed`にします。送信を試みた後で応答を失った場合は、従来どおり`uncertain`として自動再送しません。生成完了を確認した後に入力変更が分かった場合は、結果を返さず`failed`にします。失敗した処理を再実行する機能は追加しておらず、後から明示的に呼ぶ正常な制作処理は実行できます。

出生・Compilationが共有するJSON入力の内容だけを比較します。人物属性、ゲームジャンル、出力先エンジンに固有の条件は追加していません。保存形式、依存、モデル設定は変更していません。外部編集を常時ロックする変更ではなく、途中で変更して元のbyte列へ戻す行為の検出や、モデルが実際に資料を読んだことの証明までは行いません。

## 試し方

リポジトリルートで`npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts`を実行します。実モデルを呼ばず、ParentProduction・Workspaceとテスト用Runtimeで検証できます。

新しい4ケースは「出生／Compilation」×「送信前／生成中」です。不整合な結果を受理しないこと、送信前なら送信数0であること、失敗を未確定と誤分類しないこと、続く正常な制作要求が成功することを確認します。既存の応答喪失ケースも実行し、送信数1・未確定・自動再送なしを維持していることを確認します。

## 検証記録

ログは`.local/polish-20260914/`にあります。修正前の独立4ケースを含む検証は15件中4件失敗・11件成功（exit 1、`production-input-before-expanded.log`）。変更した入力でも結果を返してしまうことを再現しました。修正後は対象15件すべて成功（exit 0、`production-input-after.log`）。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `production-input-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `production-input-lint.log` |
| `npm test` | exit 0、単体53・backend139件PASS | `production-input-test.log` |
| `npm run test:connection` | exit 0、CLI/TUI接続8件PASS | `production-input-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `production-input-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全18件PASS | `production-input-e2e.log` |

最終ソースで計222件PASS。実モデル・APIキー・既存ワールドは使用していません。今回の正式検証ではnative異常終了は再発しませんでしたが、[21](21-native-node-shutdown.md)の元のCLI異常終了は未解決です。

## 戻し方

`git log --oneline -- improvements/23-production-input-integrity.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ変換は不要ですが、親へ渡す入力コピーが変更されても成果物を受理する挙動も戻ります。
