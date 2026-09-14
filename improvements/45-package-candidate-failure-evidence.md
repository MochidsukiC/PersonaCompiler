# 45 — 比較候補が欠けたときの画面・一覧・ディスクを記録

[44](44-current-relation-evidence.md)の全体E2Eで、Codex側の比較候補が期待した2件に対して1件のままになりました。再実行では成功しましたが、初回traceにElectron画面のsnapshotがなく、実ファイルの欠落・backendの一覧欠落・画面への反映漏れを切り分けられませんでした。

## 変更

既存のパッケージ比較E2Eで、比較候補の件数assertionが失敗した場合に次の4点をPlaywrightのattachmentへ保存します。

- `workspace-file-state`: backendから取得したroot・runId・version・ファイル一覧・fileVersions・workspace error。
- `comparison-options`: 実際のselect要素の候補値・表示名・選択状態。
- `compilation-disk-paths`: 合成workspaceのcompilation以下に実在するパス。
- `comparison-failure-screen`: 失敗時のElectron画面。

ファイル本文や認証設定はJSONへ収録しません。各記録の取得が失敗した場合はannotationへ記録し、元の件数assertionを再throwします。通常の比較処理、5秒のassertion期限、テストの期待値は維持しています。アプリ本体・保存形式・モデル設定は変更していません。

## 検証

プロジェクトルートで実行しました。ログ・診断用fixtureは`.local/polish-20260914/`です。アプリ本体は44で検証済みの同じbuildを使用しています。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `package-capture-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `package-capture-lint.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/package-comparison.spec.ts` | 0 | 正式なDemo・Codexの2件PASS、28.1秒 | `package-capture-e2e.log` |
| `node node_modules/@playwright/test/cli.js test --config .local/polish-20260914/package-capture.config.ts` | 1（期待した失敗） | 公開snapshotから基準候補を意図的に除外。元の件数assertionで1件FAIL、4種のattachmentを取得 | `package-capture-intentional-failure.log` |
| `node node_modules/vitest/vitest.mjs run --config .local/polish-20260914/workspace-watch.config.ts` | 0 | 1テスト内で独立したworkspaceを30回作成し、公開一覧の全パスと実ディスクを照合、13.01秒 | `workspace-watch-final.log` |
| `node .local/polish-20260914/verify-package-captures.mjs` | 0 | 元の失敗・4種の記録・一覧にない基準manifestのディスク上の存在・30回の全パス一致を検証 | `package-capture-verification-final.log` |

最初の監視診断はmanifest 3件が揃った時点で採取していました。後から全パスを照合したところ、30回中1回で`unregistered.txt`の通知が未反映で、照合スクリプトがexit 1になりました。初回記録は`workspace-watch-records-initial.json`、失敗ログは`package-capture-verification-initial.log`へ保持しています。採取条件を全パスの一致へ強め、5秒の期限を変えず再実行しました。この採取時点の不一致を、前回の比較候補欠落の原因とは断定していません。

意図的な失敗のJSON reportは`package-capture-report.json`、attachment入りtraceは`package-capture-results/package-capture-diagnostic-a10da-oth-sides-without-inference/trace.zip`です。JSON reporterの相対出力先がconfigディレクトリ基準だったため、元の`.local/polish-20260914/.local/polish-20260914/package-capture-report.json`から上記へコピーしました。画像を`package-capture-failure.png`として取り出して開き、候補がない表示を確認しました。

今回はテストの失敗時記録と文書のみの変更なので、アプリ全体のbuild・単体/backend・全34画面・CLI接続・保存テストは再実行していません。正式な比較E2Eの正常経路と、追加した失敗時記録を対象に検証しました。実モデル推論、APIキー使用、既存ワールド変更はありません。

## 結論と次の切り分け

比較候補欠落そのものは未解決です。30回のファイル監視診断では全パス一致が確認でき、実際の再発状態は取得できませんでした。今回の意図的な候補除外は記録手段の検証です。既知のnative異常終了も未解決のままです。

正式E2Eで再発したら、まず4点を照合します。ディスクに基準manifestが存在して公開一覧にない場合は監視・一覧更新の経路、公開一覧に存在して候補にない場合は候補抽出・画面更新の経路を調べます。採取中にも更新は進み得るため、4点を同時刻のatomic snapshotとは扱いません。

## 試し方・戻し方

アプリをbuildした後、上記の正式比較E2Eを実行します。候補数のassertionが失敗すると、テスト結果のtrace attachmentに診断資料が残ります。意図的な失敗を試す場合は、上記のローカル診断configを使います。

`git log --oneline -- improvements/45-package-candidate-failure-evidence.md`でコミットを確認し、`git revert <commit>`で取り消せます。アプリの再buildやデータ移行は不要です。
