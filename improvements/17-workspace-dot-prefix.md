# 17 — 正当なファイル名をワールド外と誤判定する不具合を修正

`..notes.md`や`..draft/review.md`をワールド内に保存しても、読み込みや保存が「プロジェクト外」と誤って拒否される不具合を修正しました。外部エディターで作った同名のファイルも、一覧から開き、変更を自動反映できます。

## 原因と修正

実体確認後の相対パスに対して`startsWith('..')`を使っていたため、親ディレクトリを表す`..`と、単にその文字で始まる名前を区別できていませんでした。root直下の`..notes.md`は保存できても読み込めず、`..draft`配下への保存も拒否されていました。前回の修正以前からある判定の問題です。

`Workspace.resolve`と`Workspace.write`の判定を、`..`そのもの、または`..`とOSのパス区切りで始まる場合に限定しました。絶対パス、`../`を含む入力、外部を指すjunction・symlinkは引き続き拒否します。既存のパッケージ照合と同じ区切り単位の判定です。

変更はファイル操作の共通部分のみです。ゲーム形態・成果物名のリスト・モデル選択・保存形式に依存する条件は追加していません。ワールド内のファイルに使える正当な名前を保持します。

## 試し方

1. 任意のワールドフォルダー内に`..draft`というフォルダーと、その中に`review.md`を外部エディターで作ります。
2. アプリのファイル一覧から`..draft/review.md`を開きます。
3. 外部エディターで本文を変更して保存し、プレビューが更新されることを確認します。

自動検証は`npx vitest run tests/unit/workspace.test.ts`で実行できます。隔離fixtureを自動作成するため、既存ワールドや実モデルは必要ありません。

## 検証

実行場所はリポジトリルート、ログは`.local/polish-20260914/`です。修正前は対象10件中2件失敗・8件成功（exit 1、`dot-prefix-before.log`）。`..notes.md`の読み込みと`..draft/review.md`の保存が誤拒否されることを再現しました。

新しい2ケースでは新規保存・読み込み・上書き・追記・プレビューのhash・ファイルツリーを確認しています。既存の外部リンク検証には読み込み・プレビュー・追記の拒否と元ファイルの保持も追加しました。Electronでは外部作成したファイルの一覧表示と、本文更新の自動反映を確認しています。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `dot-prefix-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `dot-prefix-lint.log` |
| `npm test` | exit 0、単体53・backend129件PASS | `dot-prefix-test.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `dot-prefix-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全18件PASS | `dot-prefix-e2e.log` |
| `npm run test:connection` 初回 | exit 1、7件PASS・worker異常終了1件 | `dot-prefix-connection.log` |
| `npx vitest run --config vitest.connection.config.ts tests/connection/life-tools.test.ts` 診断 | exit 0、1件PASS | `dot-prefix-life-tools-diagnostic.log` |
| `npm run test:connection` 単独診断 | exit 0、8件PASS | `dot-prefix-connection-diagnostic.log` |

### 残るnative異常終了

初回CLI検証では`life-tools.test.ts`のworkerが終了コード`3221226505`で異常終了しました。同時に実行していたE2Eと保存検証は成功しています。該当fixtureの`fixture.toml`は存在しましたが、`finally`で保存する`probe.json`は生成されていませんでした。直近20分のWindows Applicationログ（ID 1000/1001）には一致する記録がなく、PATH上に`cdb`・`windbg`・`procdump`も見つかりませんでした。native stackは未取得です。

変更した`Workspace`を直接呼ばないCLI/TUIのテストで発生し、同じ終了コードは過去にも観測していますが、発生原因はまだ特定できていません。該当テスト単独と正式CLI検証の単独再実行は成功しました。これにより全212件の成功結果は得られましたが、間欠的な異常終了が解消したことを示すものではありません。初回の失敗ログを保持し、テストの除外・自動リトライ・タイムアウト緩和は加えていません。次の調査は、該当workerのnative例外発生地点を取得することです。

実モデル推論・APIキー使用・既存ワールドの変更や削除は行っていません。

## 戻し方

`git log --oneline -- improvements/17-workspace-dot-prefix.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ変換は不要ですが、該当する名前のファイルは再び誤拒否されます。
