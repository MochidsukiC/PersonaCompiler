# 主観的な記憶と関係の観測

新規ワールドはmetadataとNPC Sessionに`memoryVersion: 1`を保存します。以前のワールドやConversationへの機能追加・移行は行いません。NPCの心の声・独り言は通常出力のまま、ユーザーだけに表示します。

## 利用方法

- NPCは`remember`で経験と主観的な意味を候補へ登録します。根拠IDは`getSituation.memorySources`で取得でき、本人の初期情報・行動・受信済みの発話や施設回答だけを参照できます。通常出力から候補を自動生成しません。
- `recall`は手掛かりから保持記憶を0〜3件返します。呼出NPCと同じ先天的モデル・実効effortで、一時Conversationが意味を照合します。本文は保存済みの記憶から取得します。
- `remindMe`は時刻・施設・相手の条件を組み合わせた予定を登録し、本人が完了・取消できます。次の推論開始時に条件を確認し、選択的に思い出します。行動そのものはNPCが選びます。
- `sleep`後は現在の推論を終え、本人のConversationで`consolidateMemory`を実行します。記憶と本人から相手への認識を一括確定し、推論終了を確認してからNative Compactを開始します。

予算は`src/core/memory-contracts.ts`の`MEMORY_BUDGET`で管理します。未整理候補100件、保持記憶は予定込み100件、睡眠1回の新規確定は0〜5件です。超過時は明示的なToolエラーを返します。整理後は候補を消費し、忘却した内容は想起対象から除外します。Conversation内の文章の消去は保証しません。

想起確率は`clamp(importance × 2^(-経過turn / 40), 0.05, 0.95)`です。run・NPC・turn・記憶IDから抽選し、同一turnの同じ正規化済み手掛かりは結果を再利用します。強化は記憶ごとに1turnに1回です。モデルによる意味照合には判断の揺らぎがありますが、同一要求の自動再試行で引き直す処理はありません。

## 画面

NPC端末の「記憶・未来の意図」から、候補・保持記憶・予定と照合・整理の進捗を確認します。本文と根拠は詳細を開いたときに取得します。完了・取消・忘却した予定も履歴から参照できます。

関係図はA→BとB→Aを別々の認識として表示します。矢印を選ぶと本人の説明と更新turnが表示され、根拠の記憶ID・revisionを開けます。記憶が後で更新・忘却されても、観測時のrevisionは履歴に残ります。この観測情報や他NPCの記憶はNPCへフィードバックしません。DemoEngineのファイル根拠も引き続き開けます。

## 実行と保存

記憶はLifeHarnessの通常の世界更新データから分離し、NPCごとの変更だけを保存Workerへ送ります。候補・保持記憶・未完了の整理・照合操作をcheckpointへ、記憶の旧revision・根拠・完了した想起結果・関係更新を履歴セグメントへ保存します。同一手掛かりの索引は履歴から復元します。整理・予定の長い入力本文も履歴へ分離し、通常更新ではコピーしません。通常snapshotには全員分の記憶本文を含めません。世界更新10回/秒、自動保存30秒の既存方式を維持します。

照合待ちは呼出NPCだけです。別NPCのTool処理・移動・発話や保存Workerの進行とは独立します。全NPCの活動が終了しても照合中は次turnへ進みません。

一時停止では照合を中断します。停止確認済みの想起要求は記録を保持し、同じ手掛かりの要求を自動再送しません。停止確認済みで未確定の整理は、ユーザーが再開した場合にだけ新しい整理推論として続行します。既に確定した整理を再実行しません。整理Tool未実行での通常終了や外部操作の結果不明は明示的な停止対象です。結果不明のままdirtyを解除せず、異常終了後は閲覧専用になります。

## 検証

```powershell
npm run build
npm test
npm run lint
npm run typecheck
npm run test:connection
npm run test:persistence
npx playwright test
```

`tests/backend/memory.test.ts`では所有者・上限・原子的な整理・再現可能な抽選・重複・中断・Worker停止・復元を確認します。5 NPCを2日間動かし、異なる主観、本の返却予定、40回の整理とCompact、方向別関係と過去の根拠を追跡します。`tests/e2e/memory.spec.ts`は閲覧専用でも記憶と根拠を開けることを確認します。

実App Server＋Responses fixtureの検証は`tests/connection/memory-match.test.ts`です。実モデル確認は別コマンドで、アプリ専用のChatGPT認証を使用します。APIキー経路は今回省略します。

```powershell
$env:PERSONA_REAL_CODEX_HOME = Join-Path $env:APPDATA 'persona-compiler/codex'
$env:PERSONA_REAL_AUTH_MODE = 'chatgpt'
npx vitest run --config vitest.real.config.ts tests/real/memory.test.ts
```

実モデル試験は意味照合（完全一致・言い換え・関連・無関係）と、本人による記憶Tool・予定・整理・同じConversationでのCompactを確認します。結果は`.local/real/memory-*/acceptance.json`、`.local/real/memory-tools-*/acceptance.json`に保存します。

2026-09-12の検証結果: build・typecheck・lint成功、unit/backend 105件、接続5件、保存回帰4件、Electron E2E 11件、ChatGPT実モデル2件が成功しました。5 NPC・2日間のCoreシナリオで計40回の整理とCompact、保存Workerの10秒停止中の生活継続、Worker終了後の未保存記憶の復元も確認しました。

接続・E2E・性能検証を並行した最初の実行では、既存の9端末シナリオの受け入れ結果保存後にNode workerが`0xC0000005`で終了しました。接続試験の単独実行は5件すべて成功しました。Windows Application障害記録に該当イベントはなく、ネイティブ終了の原因は未特定です。例外の抑制・依存更新・自動リトライは追加していません。

2026-09-13の記憶整理停止の調査では、NPCが候補IDをsourceIdsへ指定して拒否され、exec内でTool結果を誤ったcontentフィールドから抽出したためエラーが見えないまま推論が終了していました。整理指示をMEMORY_CONSOLIDATION_PROMPTへまとめ、候補・経験・相手のID、変更しない記憶と予定の保持方法、Tool結果全体の確認を明示しました。拒否理由を整理ジョブへ保存し、未実行と検証失敗を区別して表示します。根拠の所有権検証と部分確定の防止は維持し、既に失敗した処理の自動再送は追加していません。

修正の回帰テストは、候補IDの取り違え・重複要求・確定前の引数修正・未修正での停止を確認します。ChatGPT実モデルの最初の試験では予定の更新対象と関係targetの指定で拒否されましたが、結果を読んで訂正しCompactまで完了しました。これらの引数の説明も追加した最終版では、記憶登録・予定・整理・Compactの実モデル試験が全Tool成功で通りました。
