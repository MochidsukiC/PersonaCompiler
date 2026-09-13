# 01 — ファイル再選択の修正と初回監査

## 変更・試し方

同じファイルを一覧から2回選ぶと内容が消え、「読み込み中…」のままになる不具合を修正しました。同じ選択では取得済み内容を保持します。別ファイルへの切り替え、対象ファイルの外部更新による自動再取得は維持します。

アプリで任意のファイルを開き、左の同じファイルをもう一度クリックしてください。プレビューが残ることを確認できます。

## 監査結果

- 着手点: `051ef09`、未コミット・未追跡変更なし。
- Computer Useで既存アプリのturn 29の入場位置エラーを確認。保存履歴と該当NPCの実Conversationを照合し、`setInitialPosition`の依頼に対して`moveToFacility`を呼び、拒否後に応答を終了していたことを確認しました。
- この停止は未確定の座標で生活を進めないための設計上の動作です。自動retryや座標の補完は追加していません。既存ワールドは操作・再送せず、そのまま保持しています。
- 未設定NPCだけを手動再開で配置し、他NPCの座標とターンを保持するbackend回帰テストを追加しました。モデルが今後必ず正しいToolを選ぶことや、実モデルでの長時間運転を保証する検証ではありません。

## 検証

cwdはすべてリポジトリルート。完全ログは`.local/polish-20260914/`に保存しています。

| command | 対象 | exit | 結果 | log |
|---|---|---|---|---|
| `npm run typecheck` | 修正後 | 0 | PASS | `typecheck-fix.log` |
| `npm run lint` | 修正後 | 0 | PASS、警告0 | `lint-fix.log` |
| `npm test` | 修正後 | 0 | 単体35・backend117件PASS | `test-fix.log` |
| `npm run test:e2e` | 修正後 | 0 | buildと13件PASS | `e2e-fix.log` |
| `npm run test:connection` | 着手時、接続実装は未変更 | 0 | 7件PASS、localhost fixture | `connection-baseline.log` |
| `npm run test:persistence` | 着手時、保存実装は未変更 | 0 | 4件PASS | `persistence-baseline.log` |

追加操作テストでは修正前にプレビュー要素の消失を再現しました（`preview-reproduction.log`、exit 1）。最初の通常sandbox実行はesbuildの親ディレクトリー読み取り制限で起動失敗し、承認済みの制限外ローカル実行で正式な検証を行いました。

## 戻し方

このファイルを追加したコミットを`git log --oneline -- improvements/01-file-preview.md`で確認し、必要なら`git revert <commit>`してください。既存ワールドの保存形式は変更していません。
