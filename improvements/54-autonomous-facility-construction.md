# 54 — 住民が組織・個人の施設を建設する

住民用ToolにbuildFacilityを追加しました。会社の事業所、ギルドの工房、研究会の観測施設、個人の作業場など、用途を自由に指定できます。組織に依存しない建設処理にしており、organizationId=nullなら個人の施設になります。

## 試し方

更新版で生成した住民の生活中に「必要な組織を設立し、活動に使う施設も建設してください」と端末で伝えます。住民はbuildFacilityに名称・種別・説明・内部サイズ・任意の所属組織IDを渡せます。

1. 「組織」タブに建設依頼が「建設中」と表示されます。組織名義の施設はその組織のカードにも表示されます。個人施設も別に一覧できます。
2. 施設担当Conversationを作り、役割設定の施設モデル・effortでinitializeFacilityを実行します。名称・用途・サイズ・建設依頼者・組織・現在turnを渡します。
3. 内部の座標・領域が確定すると「利用可能」へ変わり、建設者へ完成通知が届きます。所在地を持たない組織は、最初に完成した組織施設を所在地として記録します。
4. 地図の「建設された施設」に追加され、建設者の現在地と接続されます。「内部へ」で3D配置を確認できます。「組織」タブから施設担当のConversationも開けます。
5. AI住民がmoveToFacilityで移動し、次ターンに入場位置を決め、useFacilityで利用できます。建設中の移動は拒否します。
6. 「出来事」の種別「施設建設」で依頼・完成を確認できます。組織・建設者・施設・Conversation・地図の追加分は保存と再接続で保持されます。

モデル試運転は全役割gpt-5.6-luna / low、通常3日を目安にしてください。今回の検証は合成応答のみで、実モデル推論・APIキーは使用していません。実利用で施設担当が内部配置を生成する際は通常のモデル推論が発生します。

## 範囲と保存

名称・用途・組織種別を特定ジャンルのenumに固定していません。資金・資材・工期・土地所有・賃貸・給与などの経済ルールは追加しておらず、配置の初期化完了を施設の完成として扱います。世帯用のtype=residentialは既存の住宅街・createHomeが管理する予約済み用途のため、追加建設では受け付けません。

承認済み仕様や初期地図を書き換えず、生活状態に追加施設と建設情報を保存し、表示地図を合成します。新設IDはHarnessが発行します。組織名義の建設は実行中のNPC本人がその組織の構成員である場合だけ受け付け、builderIdの指定や他人の代理操作は拒否します。初期化は当該施設Conversationだけが実行できます。

停止中に施設担当Conversationの生成が完了しても、配置を作る推論は開始しません。既に確定したConversationを保持し、まだ推論を送っていない仕事を待機へ戻して、再開後に続行します。送信後に結果が不明になった要求は、既存方針に従って自動再送しません。

この版で生成するNPCはcommunityToolsVersion=2です。53で生成済みのversion=1の住民は組織Toolのみ、それ以前の住民にはどちらの新Toolもありません。53と同様、保存済みConversationのツールを無理に差し替えず、経験を保持します。新しいToolを試す場合はこの版で生成した住民を使用してください。

## 検証

プロジェクトルートで実行。最終結果とログは`.local/polish-20260914/`へ記録しています。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` / `npm run lint` | 0 | 成功・警告0 | `construction-release-static.log` |
| `npm run build` | 0 | 成功。既存zodのRollup警告あり | `construction-release-build.log` |
| `npm test` | 1 | unit84件PASS。backend188/192件PASS後、既存端末中継のWorkerが0xC0000409で終了 | `construction-final-sequential-test.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.backend.config.ts tests/backend/terminal-relay.test.ts` | 0 | 切り分けた端末中継ファイル13件PASS | `construction-relay-isolated.log` |
| `npm run test:connection` | 0 | 実CLI＋localhost合成応答10件PASS | `construction-connection.log` |
| `npm run test:persistence` | 0 | 保存復元4件PASS | `construction-final-sequential-persistence.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/organizations.spec.ts` | 0 | 隔離Electronの1件PASS | `construction-release-ui.log` |

追加backend7件で通常・メモリー保存の建設、完成前の入場拒否、完成後の移動・利用、組織権限、不正計画、保存参照、施設Conversationの一度だけの生成・再接続、承認仕様保持、停止中の推論抑止、世代別のTool案内を確認します。画面テストで施設一覧・建設中・個人施設・地図追加・3D領域を確認し、画像は`construction-organizations.png`と`construction-interior.png`へ保存しています。全既存Electronテストは今回は再実行していません。

途中の`construction-life.log`は、復元テストのサービスにConversation履歴を渡していなかったため後片付けが失敗し、36件FAILと記録されました。履歴を引き継ぐ修正後の`construction-backend.log`は、停止済み世界にテストがstartを使っていた2件だけFAILでした。既存の再開用resumeへ修正しました。最初の全体検証は、施設向け説明からturn=0の案内を落としてしまいbackend189件PASS・1件FAIL（`construction-final-test.log`）でした。初期施設と生活中の建設の時刻を明記して直し、backend191件PASSを確認した後、停止境界の修正と検証を追加しています。停止境界の最初の対象テストは1秒の待機で初期化が間に合わずFAILでした（`construction-pause.log`）。建設受付の成功を明示検査し、既存の施設初期化検証と同じ10秒の期限で確認しています。

最初の建設画面テストは、構成員と個人施設の建設者に同じ住民名のボタンがあり、テストの指定が曖昧でFAILでした（`construction-ui.log`）。対象組織のカード内で人物ボタンを選ぶよう修正しました。期待する機能のassertionは維持しています。

停止境界を加えた後、buildと保存テストを並列に実行してしまい、読み込み対象のWorkerファイルがbuild中に置き換わって保存テスト1件がFAILになりました（`construction-release-persistence.log`）。同時実行した全体テストでも、新規ケースの建設前の人口初期化が10秒を超え、backend191件PASS・1件FAILでした（`construction-release-test.log`）。build完了後に全体テスト、保存テストの順で同じコード・期待値・期限のまま検証し直しています。並列検証の失敗を成功として扱いません。

順次実行した最終の全体検証では、新機能を含むbackend188件は成功しましたが、既存のterminal-relay.test.tsの途中でWorkerが3221226505（0xC0000409）で終了し、残る4件が完了しませんでした。同ファイルを切り分けた13件は成功しました。全backendの各assertionについて成功した実行はありますが、`npm test`全体の正常終了は未達です。[21の既存native例外調査](21-native-node-shutdown.md)と同じ終了コードですが、今回のstack/dumpは採取できておらず同一原因とは断定しません。端末中継のソース・Nodeのバージョン・テスト除外・閾値は変更していません。この既存のnative異常終了は未解決として残します。

## 戻し方

`git log --oneline -- improvements/54-autonomous-facility-construction.md`でコミットを確認し、`git revert <commit>`後にbuildし直します。建設施設・建設イベントを含む保存は旧コードの検証で停止するため、戻す場合は施設建設前のワールドを使ってください。保存データや生成済みConversationをrevertで自動変換・削除しません。
