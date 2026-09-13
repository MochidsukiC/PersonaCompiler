# 07 — ゲームへ渡す前に成果物の整合性を確認

生成済みNPCの「成果物を照合」から、manifestに記載された各ファイルのSHA-256を確認できます。「一致」「内容変更」「欠損」を区別して表示し、再照合で現在の状態を確認できます。

## 試し方

1. 生成済みNPCの「成果物を照合」を押すか、ファイル一覧で`compilation/<id>/npcs/<npcId>/manifest.json`を開きます。
2. 正常な出力では、manifest記載の全ファイルが一致します。各項目の詳細で期待hashと現在のhashを比較できます。
3. コピーした検証用パッケージの文章を外部編集し、「もう一度照合」を押すと、そのファイルが「内容が変更されています」になります。ファイルがなければ「ファイルが見つかりません」と表示します。
4. manifestが壊れている場合は照合エラーになり、成功として表示しません。

既存のパッケージにも利用できます。モデル推論・APIキー・追加の依存ライブラリーは不要です。

## 抽象化と範囲

ゲームエンジンやジャンル固有のデータ解釈を行わず、manifestとファイルのバイト列だけを扱います。特定のファイル名一覧に固定せず、相対的なサブフォルダーやバイナリー成果物も照合できます。人物のゲーム内行動、時間の変換、世界の座標系、会話システムの実装は規定しません。

照合は読取専用です。元データの修復、再生成、署名、外部公開は行いません。対象はmanifestに列挙されたファイルで、manifest自体の真正性や内容の意味的な品質を保証する機能ではありません。各ファイルの照合時点の状態を表示し、その後の編集は再照合してください。

IPCは既存のメインフレーム制限を利用します。パスの構造・manifestのSchema・NPC IDを検査し、ディレクトリ遡及やパッケージ外へ向くリンクを拒否します。

## 検証

単体・backendでは、文字列とバイナリーの一致、同じバイト長での内容変更、欠損、不正manifest、異なるNPC ID、ディレクトリ遡及、パッケージ外へのjunctionを確認します。Electronでは実IPCと実ディスクを使い、外部編集後の再照合、欠損表示、壊れたmanifestのエラー表示を検証します。

cwdはリポジトリルート。変更後ソースで以下を実行しました。ログは`.local/polish-20260914/`。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` | exit 0 | `package-typecheck.log` |
| `npm run lint` | exit 0、警告0 | `package-lint.log` |
| `npm test` | exit 0、単体40・backend124件PASS | `package-test.log` |
| `npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts` | exit 0、8件PASS。Compilerの実出力との結合assertion追加後の対象再検証 | `package-compiler-integration.log` |
| `npm run test:connection` | exit 0、7件PASS、localhost fixture | `package-connection.log` |
| `npm run test:persistence` | exit 0、native Worker 4件PASS | `package-persistence.log` |
| `npm run test:e2e` | exit 0、build・15件PASS | `package-e2e.log` |

合計190件PASS（結合assertionの対象再実行8件は重複計上していません）。実モデル試運転は不要な変更のため省略しました。画面は`.local/polish-20260914/package-inspection.png`を目視確認済みです。

## 戻し方

`git log --oneline -- improvements/07-package-inspection.md`でこの機能のコミットを確認し、`git revert <commit>`してください。パッケージの既存データは変更していません。
