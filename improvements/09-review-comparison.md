# 09 — 再生成したNPCの変更を制作レビューで比較

制作レビューに「別の出力と比較」を追加しました。同じワールド・同じNPCの別Compilationを基準に選び、開いている出力へ何が変わったか確認できます。再生成の前後で人物設定と根拠を確認する工程を短くします。

## 試し方

1. 同じNPCについて、2つ以上のCompilationの`review.json`を用意します。すでに出力があれば、新たなモデル推論は不要です。
2. ファイル一覧から比較したい出力の`compilation/<id>/npcs/<npcId>/review.json`を開きます。
3. 「別の出力と比較」を展開し、「比較の基準」で別のCompilationを選びます。基準側から開いている出力への追加・削除・根拠変更と、設定一致の件数が表示されます。
4. 「両側の根拠を見る」で基準・現在の引用資料を読みます。Runtime Promptや指針、生成モデルなどの変更も展開して確認できます。

同じ設定文でも引用先や引用資料の本文が違えば根拠変更です。引用の並び順や重複だけの違いは変更に数えません。同じ文の設定が複数ある場合も件数を保持し、完全一致する設定から対応付けます。ファイルの外部変更は監視通知で再読込します。「基準を再読み込み」でも明示的に更新できます。

## 抽象化と比較範囲

ゲームエンジン・ジャンル・座標・時間・戦闘・会話UIの仕様に依存せず、レビューの設定文・引用資料・指針を比較します。「工房で働く」から「宇宙船を修理する」への変更も、ゲーム固有の意味を推測せず扱います。モデルの追加呼び出し、依存追加、データの自動変換はありません。

文章が変わった設定は削除と追加として表示します。文章の意味的な同一性や品質向上を判定する機能ではありません。記憶と関係はレビューに記載された件数の比較であり、`memories.json`・`relationships.json`の全内容比較ではありません。完全なファイル一致の確認には「成果物を照合」を利用してください。

対象は同じワールド内に保存した同じNPCの制作レビューです。別ワールドの同名NPCを同一人物とみなすことはしません。レビューのない既存出力を自動で再生成することもありません。保存形式は変更していません。

## 入力とエラー

ファイル一覧から候補を選び、既存の`preview` IPCで読み取ります。既存のメインフレーム制限、ワークスペース内のrealpath検証、20MB上限を保持しています。JSON・レビューSchema・NPC IDを検証し、不正な基準では比較結果を表示せずエラーを示します。切替や再読込で以前のリクエストが遅れて返っても採用しません。モデル由来の文字列はReactのテキストとして表示し、HTMLやコマンドとして実行しません。

## 検証

`npx vitest run tests/unit/review-comparison.test.ts`で3件の比較ロジックを確認できます。`npm run build`後、`npx playwright test tests/e2e/review-comparison.spec.ts`で旧形式デモと現在の保存方式の2ケースを実ディスク・IPCで確認できます。後者もCodexへの接続・推論を開始しません。

追加時の対象検証で、ファイル単位のrevisionがない旧形式Workspaceの変更を読み直さない問題を発見しました。既存プレビューと同じくWorkspace全体の変更番号にも対応させています。初回FAILのログは`comparison-targeted.log`。次の検証では複数箇所に同じ根拠文が表示されるためテストlocatorを対象カード内に絞りました（`comparison-targeted-v2.log`）。修正後は対象2件PASS、exit 0（`comparison-targeted-v3.log`）です。

ログの保存先は`.local/polish-20260914/`。テスト除外・閾値・警告設定は変更していません。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `comparison-layout-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `comparison-layout-lint.log` |
| `npm test` | exit 0、単体43・backend124件PASS | `comparison-test.log` |
| `npm run test:e2e` | exit 0、build・18件PASS | `comparison-e2e.log` |
| `npm run build`と`npx playwright test tests/e2e/review-comparison.spec.ts tests/e2e/lifecycle.spec.ts` | exit 0、折りたたみ表示への変更後に影響する3件PASS | `comparison-layout-build.log`、`comparison-layout-e2e.log` |

今回の検証は185件PASS（対象再実行は重複計上していません）。変更のないCLI接続7・保存4件については[07](07-package-inspection.md)の成功した検証証拠を使用し、全体の対象は196件です。実モデルの試運転・APIキー使用はありません。画面画像`review-comparison.png`を目視し、既存CSSとの名前衝突を修正後に再確認しました。[06](06-relationship-evidence.md)のnative終了は引き続き原因未確定で、今回の変更による解決とは扱いません。

## 戻し方

`git log --oneline -- improvements/09-review-comparison.md`で機能のコミットを確認し、`git revert <commit>`してください。比較は読取専用のため、既存の生成物を元に戻す作業は不要です。
