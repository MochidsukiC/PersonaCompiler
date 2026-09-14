# 55 — 親セッションの突発・予約イベント

親セッションが世界内の出来事を確定して対象住民へ知らせるToolを追加しました。襲撃・天候・祭事などの種別は自由記述で、RPG専用のルールに固定しません。住民の反応はそれぞれのAIが判断します。

## 試し方

更新版を起動し、新しいワールドを作って初期化を完了してください。この版より前に生成した親Conversationは新Toolを持ちません。既存の経験・履歴を保つため、Conversationの作り直しや保存データの削除は行いません。

親セッションへ、例えば次のように依頼します。

1. 「今、世界全体に流星のイベントを発生させてください。」
2. 「2日目の夜に住宅街で星祭りを開催するイベントを予約してください。」
3. 「イベントの予約一覧を確認して、星祭りの予約を取り消してください。」

「出来事」画面の「世界イベントと予約」で、名称・内容・種別・対象・日時・予約中／発生済み／取消済みを確認できます。発生した出来事は「世界イベント」で絞り込め、実際の通知対象を確認できます。既存の保存済み履歴検索・QAレポートにも含まれます。

予約日はワールド内の日付で、1日は朝・昼・夕・夜の4ターンです。3日間の機能確認なら12ターンに設定してください。モデルを使う場合は全役割をgpt-5.6-luna / lowに固定します。今回の実装検証では実モデル推論を使用していません。

## 仕様

| Tool | 動作 |
|---|---|
| `getWorldEvents` | 現在時刻、終了条件、住民・施設ID、イベントと予約を取得 |
| `triggerWorldEvent` | 今の世界時刻で突発イベントを確定 |
| `scheduleWorldEvent` | `at: { day, time }`で未来の1回限りの発生を予約 |
| `cancelWorldEvent` | 未発生の予約だけを取消 |

イベントは`title`・`type`・`description`と`target`を指定します。対象は`{scope:"world"}`、`{scope:"location",locationId}`、`{scope:"actors",actorIds}`のいずれかです。予約時には通知せず、指定ターンの入場処理完了後、活動開始時点の生存住民・居場所から対象を決めます。同時刻の予約は登録順に発生します。

世界を一時停止しても予約は保持され、現実の時間経過だけでは発生しません。停止中も親に一覧・予約・取消・突発発生を依頼できますが、住民への配送は世界の再開後になります。睡眠・活動終了中の対象への通知は次の活動まで保留します。世界が先に終了した場合の残る予約は「未発生（世界終了）」です。

イベント本文は世界の出来事の記録です。資源の増減、施設建設、死亡、クエスト成功などの別機能の状態を文章だけで変更するものではありません。発生済みの出来事を取消・上書きするToolはありません。取消後の再設定は新しい予約として残します。

親の実行中ConversationとturnIdを照合し、住民・施設からの呼び出し、古いturnId、名前空間の偽装を拒否します。Toolの再送は同じ確定結果を返し、同一IDの内容変更はエラーにします。予約状態・発生記録・通知仕事・Tool受領記録を同じ保存トランザクションで更新します。未発生の予約一覧は住民へ渡しません。受信文はゲーム内データとして扱い、HTMLとして実行しません。

親の新規生成時に`worldEventToolsVersion=1`を保存します。現行CLIではdynamicToolsをthread/startで登録するため、旧Conversationへ案内だけを追加しません。親が準備・制作に使う既存のファイル操作Toolは維持します。

## 検証

着手点`4e931c3`、作業ブランチ`codex/hackathon-polish`。ログは`.local/polish-20260914/`です。

| コマンド | exit | 結果・ログ |
|---|---|---|
| `npm run typecheck` | 0 | `world-events-final-typecheck.log` |
| `npm run lint` | 0 | 警告0、`world-events-final-lint.log` |
| `npm run build` | 0 | 既存zodのRollup注釈警告あり、`world-events-final-build.log` |
| `npm test` | 0 | unit84件・backend198件成功、`world-events-test.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.backend.config.ts tests/backend/engine.test.ts` | 0 | 一時停止中の親操作・旧Conversation互換性の追加後に35件成功、`world-events-final-engine.log` |
| `npm run test:persistence` | 0 | build完了後、保存復元4件成功、`world-events-persistence.log` |
| `npm run test:connection` | 1 | 既存10件成功、新規fixtureのTool一覧参照が誤っており1件失敗、`world-events-connection.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.connection.config.ts tests/connection/world-event-tools.test.ts` | 0 | 修正後の新規1件成功、`world-events-final-connection.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/world-events.spec.ts` | 0 | 隔離Electronの画面1件成功、`world-events-ui.log` |

通常保存とメモリー保存で、突発発生、対象限定、予約取消、入場後の対象確定、再開後の一度だけの発生、同一要求の重複抑止を確認しました。初期の対象テスト4件の失敗は、既存の入場イベント5件をテストが数えていなかったためです。初期化の履歴を維持して期待値を訂正しました（`world-events-life.log`→`world-events-targeted.log`）。最初の型検査で予約引数の型絞り込みが不十分だった点も修正しました。

接続fixtureは最初にResponsesのトップレベル`tools`を参照して失敗しました。要求のキーを調べたところ、現行CLIは`input`内の`additional_tools`でToolを渡していました（`world-events-connection-diagnostic.log`）。既存の生活Tool接続テストと同じ場所を検査するよう修正し、新規4Toolと既存のexec_command・apply_patchがモデル入力に含まれ、scheduleWorldEventの結果をApp Serverへ返して推論が完了することを確認しました。接続全体コマンドの失敗を成功扱いせず、変更した新規テストの成功と既存10件の成功を分けて記録しています。

画面画像`world-events-ui.png`を目視確認しました。実データ・起動中アプリとは別のprofileを使っています。全既存Electronテストや実モデルによるイベント内容・反応の品質は未検証です。前機能で記録したnative Workerの異常終了は今回の全体テストでは再発しませんでしたが、原因を修正したという意味ではありません。

## 戻し方

`git log --oneline -- improvements/55-parent-world-events.md`でコミットを確認し、`git revert <commit>`後にbuildしてください。新しい世界イベントを含む保存は旧コードでは対応できません。revertする場合はイベント機能を使う前のワールドを使用してください。保存データ・Conversationをrevertで自動変換・削除しません。
