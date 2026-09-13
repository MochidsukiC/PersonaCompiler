# 16 — 保存拒否時のワールド外ディレクトリ作成を修正

外部フォルダーを指すリンクの下に新しい成果物を保存すると、エラーで拒否した後にもリンク先に空ディレクトリが残る不具合を修正しました。

## 原因と修正

`Workspace.write`は相対パスを検査した後、保存先の親を再帰的に作成し、その後で`realpath`によるワールド内判定を行っていました。例えば`artifacts/linked`がワールド外を指すjunctionの場合、`artifacts/linked/new/nested/review.json`への保存は拒否されても、外部に`new/nested`が作成されていました。重要度はP2、成立条件は既存の外部ディレクトリリンクと、その下への保存操作です。

作成前に、保存先から既存の親ディレクトリまで遡って実体を取得し、ワールド内であることを確認します。作成後の実体確認も維持しました。ファイルの置き換え・書き込みキュー・エラー通知は従来の処理を使います。ワールド内を指すディレクトリリンクからの正常な保存は許可したままです。

呼出元には制作出力、準備資料、DEVチェックポイントと分岐復元が含まれます。特定のゲーム形式や成果物名に依存した許可リストは追加せず、共通の保存先境界で修正しました。依存追加・保存形式変更はありません。

この修正は保存時に存在するリンクによる境界越えを防ぎます。別プロセスが実体確認と書き込みの間にディレクトリを置き換える競合まで防ぐ仕組みではありません。

## 試し方

リポジトリルートで`npx vitest run tests/unit/workspace.test.ts`を実行します。テストが`.local/tests/`配下にワールドと外部役のフォルダーを新規作成します。Windowsではjunctionを使います。実際のユーザーデータにリンクを作る必要はありません。

- 外部リンクの下への保存を拒否し、未作成の子ディレクトリを残さない。
- 外部にある既存ファイルへの保存を拒否し、本文を保持する。
- 拒否後も、ワールド内への次の保存が成功する。
- ワールド内のリンク経由で入れ子の成果物を正常に保存できる。

## 検証

実行ディレクトリはリポジトリルート、ログは`.local/polish-20260914/`です。初回は8件中1件失敗・7件成功（exit 1、`workspace-boundary-before.log`）。外部役フォルダーの一覧に、作られるべきでない`new`が含まれることを確認しました。修正後の同じ8件は全件成功（exit 0、`workspace-boundary-after.log`）しています。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `workspace-boundary-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `workspace-boundary-lint.log` |
| `npm test` | exit 0、単体51・backend129件PASS | `workspace-boundary-test.log` |
| `npm run test:connection` | exit 0、CLI接続・端末回帰8件PASS | `workspace-boundary-connection.log` |
| `npm run test:persistence` | exit 0、保存・復元4件PASS | `workspace-boundary-persistence.log` |
| `npm run test:e2e` | exit 0、build成功・Electron全18件PASS | `workspace-boundary-e2e.log` |

最終ソースで計210件PASS。共通保存処理の変更のため、今回はCLI・保存の検証も再実行しました。E2Eには制作成果物、DEV分岐復元、保存エラーからの再操作、比較レポートの回帰を含みます。

実モデル推論・APIキー使用・既存ワールドの変更や削除は行っていません。

## 戻し方

`git log --oneline -- improvements/16-workspace-write-boundary.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。保存済みワールドの変換は不要ですが、この不具合も戻ります。
