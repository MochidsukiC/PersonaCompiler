# 53 — 住民が組織・会社を設立する

AI住民へcreateOrganization、joinOrganization、leaveOrganizationを追加しました。会社・ギルド・研究会などの種別と目的は自由に指定できます。所在地は任意です。設立者が最初の構成員となり、その後は各住民が自分で参加・脱退します。設立者が脱退しても設立記録は残ります。亡くなった構成員は履歴として残し、画面で故人と表示します。

## 試し方

更新後に生成した住民の生活を開始し、端末で「仲間と活動する組織が必要なら、自分で設立してください」と伝えます。ツールの成否と組織IDが住民へ返り、getSituation.organizationsから公開された組織を確認できます。「組織」タブで名称・目的・設立者・構成員・所在地を確認し、人物名からConversationを開けます。「出来事」の種別「組織」でも設立・加入・脱退を検索できます。

モデルを使う試運転は全役割gpt-5.6-luna / low、通常3日程度を使用してください。本変更の検証では実モデル推論を使っていません。

既存Conversationへの動的ツール差し替えは、使用中のCodexが生成したexperimental版ThreadResumeParams/ThreadSettingsUpdateParamsに項目がありませんでした。新規Conversationに登録し、communityToolsVersionで説明文の提供を管理します。古い住民のConversationや経験を置き換えません。新規住民は既存ワールドで出生した住民も含みます。公式資料の[Dynamic tool calls](https://learn.chatgpt.com/docs/app-server)も参照しましたが、実装は導入済みCLIの定義と実接続で確認しています。

## 検証

プロジェクトルートで実行。すべてexit 0。ログは`.local/polish-20260914/`。

| command | 結果 | log |
|---|---|---|
| `npm run typecheck` / `npm run lint` | 成功・警告0 | `organizations-final-static.log` |
| `npm run build` | 成功。既存zodのRollup警告あり | `organizations-build.log` |
| `npm test` | unit84件・backend185件PASS | `organizations-test.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/organizations.spec.ts` | 隔離Electronの1件PASS | `organizations-ui.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.connection.config.ts tests/connection/organization-tools.test.ts` | 実App Server＋localhost合成応答1件PASS | `organizations-connection.log` |

新規backend4件で通常保存・メモリー保存差分・重複要求・自己加入脱退・旧保存の互換性・不正な参照を確認しました。AIから渡されたfounderIdやmembersは入力で拒否し、実行中のNPC本人を使用します。施設Agent、無効な推論ID、行動終了後、未知の所在地も拒否します。組織の名称・目的はReactのテキスト表示で描画し、AIへは公開データとして渡します。資金・雇用・建物の自動付与はありません。

画面の画像は`organizations.png`として同じログフォルダーに保存しました。全既存Electron・保存専用テストは今回は再実行していません。

## 戻し方

`git log --oneline -- improvements/53-autonomous-organizations.md`でコミットを確認し、`git revert <commit>`後にbuildし直します。新しい組織イベントを含む保存は旧版のイベントschemaで読めなくなるため、戻す場合は本機能を使う前のワールドを使用してください。revertは保存済みの組織を移行・削除しません。
