# 39 — 停止後に届いた親の開始応答を中断へつなぐ

[38](38-production-pause-boundary.md)の開始前チェックに続き、開始要求を出してからTurn IDが返るまでの間に停止した場合を修正しました。停止時点では親のTurn IDがまだなく、従来の停止処理はそのTurnを中断できませんでした。後から開始通知と応答が届いても、親の生成が実行中のまま残りました。

## 変更

親の制作処理も、通常のNPC生活処理と同様、開始応答と操作記録の保存が終わった時点で停止要求を確認します。停止中で、同じTurnの完了をまだ受け取っていなければ、返されたTurn IDを使って中断します。中断後は完了通知を待ち、確定した終了状態を記録します。

出生・Compilationで共通の仕組みです。ゲーム固有のルールやモデルによる推測を追加していません。

- 開始応答より先に完了した処理、または操作記録の保存中に完了した処理は、中断せず成果物を保持します。
- 別のTurnの完了通知を、この要求の完了として扱いません。
- 中断の応答が失われた場合は`uncertain`を残し、正常な中断や生成失敗と断定しません。
- 開始要求を再送する処理は追加していません。前の修正による未送信要求の停止チェックも維持します。

## 検証

修正前のfixtureでは、親の開始応答を待機させて一時停止し、その後に応答を返しても中断要求は0件でした。追加検証はexit 1で失敗しました（`production-late-start-before.log`）。同じ条件は修正後に成功しました（`production-late-start-after.log`）。

追加した9件は、BackendEngineを通した遅延応答の中断1件と、出生・Compilationそれぞれの「実行中」「応答前に完了」「操作保存中に完了」「中断応答不明」の8件です。終了状態・中断回数・開始要求1回・通知listenerの解放を確認します。Compiler関連27件は成功しました（`production-late-start-compiler.log`）。

最初の型検査は、テストRuntimeが返すUUID型に固定文字列のTurn IDを代入したため失敗しました（exit 2、`production-late-start-typecheck.log`）。fixtureも既存Runtimeと同じ`crypto.randomUUID()`を使うようにし、型検査を弱めず修正しています。

コマンドの実行場所はプロジェクトルート、ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `production-late-start-typecheck-final.log` |
| `npm run lint` | 0 | 警告0・成功 | `production-late-start-lint-final.log` |
| `npm test`（通常の再実行） | 0 | 単体68・backend166件PASS | `production-late-start-test-final.log` |
| `npm run test:e2e` | 0 | build成功・Electron 30件PASS（3.4分） | `production-late-start-e2e.log` |
| `npm run test:connection` | 0 | 実CLI＋localhost fixture 8件PASS | `production-late-start-connection.log` |
| `npm run test:persistence` | 0 | 保存worker 4件PASS | `production-late-start-persistence.log` |

最終状態は合計276件PASSです。初回の失敗とnative診断の結果は下記に分けて記録しています。

## native異常終了の記録

最初の`npm test`は単体68件が成功しましたが、backendでRPCテストのworkerが`3221226505`で異常終了し、159/166件PASS・unhandled error 1件・exit 1でした（`production-late-start-test.log`）。この実行は全体成功と扱いません。

既存のnative診断ツールから`tests/backend/rpc.test.ts`を起動したところ、7件PASS・exit 0、native例外採取0・期限超過0でした（`production-late-start-rpc-native.log`と同`.stdout.log`）。以前のCLI・Playwright異常終了と同じ終了コードですが、原因の同一性は未確認です。今回の親の中断修正によって解消したとは扱いません。

画面検証と並行してbackend全体もnative診断し、166件PASS・exit 0・例外採取0・期限超過0でした（`production-late-start-backend-native.log`と同`.stdout.log`、31.43秒）。診断コマンドは`.local/polish-20260914/native-debugger.exe --timeout-ms 180000 <log> .local/polish-20260914 <node.exe> node_modules/vitest/vitest.mjs run --config vitest.backend.config.ts`です。既存の診断ソースとbuild用コピーのSHA-256一致を確認し、インストール済みNodeは変更していません。デバッガーが実行タイミングを変えるため、再発しなかったことは原因解消の証明ではありません。

## 試し方・戻し方

`npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts`で、実モデルを使わず再現・正常系・異常系を確認できます。画面では生成開始の応答待ち中に停止した場合、後からIDを取得できればその親Turnを中断します。結果不明の処理はエラーとして残します。

実モデル推論・APIキー使用・既存ワールド変更はありません。権限・保存形式・生成プロンプトは変更していません。

`git log --oneline -- improvements/39-production-late-start-interrupt.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
