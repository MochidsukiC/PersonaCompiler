# 15 — NPCの比較結果を制作記録へ持ち出す

「別の出力と比較」に「比較レポートをコピー」を追加しました。設定と根拠の変更、Runtime Promptの差分、両側の資料の参照情報をMarkdownへまとめます。再生成したNPCを採用する前の確認結果を、任意の制作記録へ残せます。

## 試し方

1. 同じNPCの制作レビューが2つ保存されているワールドで、`compilation/.../npcs/.../review.json`を開きます。
2. 「別の出力と比較」を開き、基準にするCompilationを選びます。
3. 比較結果を確認し、「比較レポートをコピー」を押してMarkdown文書へ貼り付けます。

基準が未選択・読み込み中・読み込みエラーの間は、コピー操作を表示しません。コピー失敗時はエラーを表示して再操作できます。別のNPCや壊れたJSONは既存の比較処理と同じく拒否します。比較自体やレポート作成にモデル接続・推論は不要です。

## 記録するもの

- ワールドID、NPC ID、採取時刻、比較方向（基準 → 現在）
- 両側のファイルパスと読み込み時のSHA-256、名前・世界revision・生成モデル
- 設定の追加・削除・根拠変更と件数、両側の根拠本文
- 変更されたメタデータ、Runtime向け指針、Runtime Prompt
- 比較結果と読み込み済みの両側の制作レビューを含むJSON

形式識別子は`persona-review-comparison/v1`です。元ファイルのhashと、レポート内のJSONは区別しています。JSONにはスキーマ検証済みの制作レビューを収録し、元ファイルの空白・キー順・未知の項目は保持しません。読み込み後にディスク上のファイルが変更されている可能性があるため、最新版を保証した記録とは扱いません。

既存の比較規則を使い、文章が変わった設定は削除と追加として記録します。意味の同一性・解釈の妥当性・品質は判定しません。採用記憶と関係は件数のみの比較です。

## 抽象化

レポートの生成はcoreの純粋関数に分け、ゲーム固有の座標・職業・イベントやエンジン形式へ変換しません。コピーの進行表示・成功・失敗処理は、既存の出来事QAレポートと共通のUI部品にまとめました。レポート内容の組み立ては、それぞれの用途に分けています。

本文・根拠・プロンプトのMarkdownやHTMLは引用としてエスケープし、JSON内では文字列として保存します。コピーはユーザーのボタン操作だけで行い、外部サービスには自動送信しません。依存パッケージ・IPC・バックエンド・ワールド保存形式の変更はありません。

## 検証

単体では比較方向・hashと資料の対応・変更内容・同一レビュー・異なるNPCの拒否・Markdown/HTML/コードフェンスを含む文章を検証します。Electronでは実クリップボードを読み、ファイルのSHA-256との一致、基準ファイル更新後の差分、コピー失敗後の再操作を確認します。共通化した出来事QAのコピーも既存E2Eで確認します。

対象だけを試す場合は、`npm run build`後に`npx playwright test tests/e2e/review-comparison.spec.ts tests/e2e/event-history.spec.ts`を実行します。合成fixtureを使うため、実モデル推論はありません。

ログは`.local/polish-20260914/`、実行ディレクトリはリポジトリルートです。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `comparison-report-typecheck-final.log` |
| `npm run lint` | exit 0、警告0 | `comparison-report-lint-final.log` |
| `npm test` | exit 0、単体49・backend129件PASS | `comparison-report-test.log` |
| `npx playwright test tests/e2e/review-comparison.spec.ts` | exit 0、demo・codexの2件PASS | `comparison-report-e2e-final.log` |
| `npm run test:e2e` | exit 0、build成功・全18件PASS | `comparison-report-e2e-all-final.log` |

今回の最終検証は単体49・backend129・Electron E2E18の計196件PASSです。バックエンド・端末・保存処理の変更はないため、[14](14-terminal-startup-shutdown.md)で成功したCLI接続と端末回帰8・保存4件の結果を再利用しています。この12件は今回再実行していません。

初回のE2Eは16件成功・比較2件失敗でした（exit 1、`comparison-report-e2e.log`）。Windowsクリップボードで改行がCRLFへ変換され、テストのLF限定のJSON抽出が失敗したためです。実クリップボードの本文を保存して原因を確認し、テストをLF/CRLF両対応に修正しました。JSONが1ブロックであること、内容とhashが一致することの検証は維持しています。

実クリップボードから保存した合成fixtureのレポート例`comparison-report-example.md`と画面`comparison-report.png`をログフォルダーに残し、内容と表示を確認しました。実モデル推論・APIキー使用・既存ワールド削除は行っていません。

## 戻し方

`git log --oneline -- improvements/15-review-comparison-report.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。コピー済みの文書とワールドデータには影響しません。
