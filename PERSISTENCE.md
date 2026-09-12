# In-Memory実行と保存形式version 2

新規ワールドを対象とする。既存の`backend.json` / `state.json` / `simulation/checkpoint.json`とDemoEngineは自動変換しない。

## 実行と保存の境界

`LifeHarness`は現在の世界・未完了ジョブ・未回答の施設利用を保持する。変更を検知するtransactionは現在状態だけを扱い、例外時は変更を確定しない。完了ジョブ本文は履歴へ送り、Tool結果と完了ジョブ種別は別の索引に保持する。重複Toolは保存済み結果を返し、新たな効果を加えない。出来事の採番は画面に保持する200件と独立している。

`PersistenceCoordinator`は連番付き変更をWorkerへ送る。生活処理はWorkerの受付・保存ACKを待たない。Mainの未保存変更はmanifest確定のACKで解放する。Workerが停止した場合は確定manifestから保存用状態を復元し、未確定の連番だけを再適用する。これは保存データの再送であり、モデル推論や生活Toolの再実行ではない。

`PersistenceStore`とJSON化・hash計算・ファイル書込は`worker_threads`内で実行する。electron-viteの`?nodeWorker`を使い、依存ライブラリーは追加していない。保存は1件ずつ実行し、保存中の更新は次の保存へ残す。保存要求は最新revisionへまとめ、古いcheckpointの予約を積み上げない。

## 保存ファイル

```text
<runId>/persistence/manifest.json
<runId>/persistence/snapshot-a.json
<runId>/persistence/snapshot-b.json
<runId>/persistence/history/<first>-<last>-<sha256>.jsonl
```

snapshotは設定・準備状態・Conversation対応と、現在の生活状態、未完了操作、移動・睡眠・Compact進捗、履歴の確定revisionを含む。完了履歴・Tool結果本文・出来事本文は重複収録しない。履歴からTool結果と完了ジョブ種別の索引、直近200件の出来事を復元する。

保存順は履歴 → 次のsnapshotスロット → manifest。各ファイルを一時ファイルへ書いてsyncし、原子的renameで公開する。manifestはスロット・世代・hash・履歴範囲・dirtyを指す。途中の一時ファイルやmanifestに含まれないセグメントは採用しない。2スロットは交互に使う。保存に失敗して残った未確定ファイルは正本ではなく、自動削除もしない。

## 保存契機と終了

- 変更があるときだけ30秒ごとに自動保存する。初期化完了・ターン上限・一時停止・手動の「今すぐ保存」でも保存する。
- 通常の保存失敗は生活を止めない。画面に保存状態、保存済み/current revision、最終保存時刻、最も古い未保存変更の経過時間、未保存の転送データ概算量とエラーを表示する。
- Conversation作成・接続など外部操作の前にdirty保存を待つ。この待機は各Tool処理には入らない。
- 正常終了は新規入力を止め、CLI経由の推論要求のACK、進行中処理・通知、CLI/App Serverの停止を確認してから最終保存し、dirtyを解除する。
- 失敗時はウィンドウを残し、「再試行」「終了を取り消す」「保存せず終了」を提示する。保存せず終了ではdirtyを解除しない。
- dirtyが残った実行は最後の確定保存を閲覧専用で開く。開始・再開・モデル入力・CLI入力を許可しない。未保存の行動をCodex履歴から推測する機能はない。

## 画面とファイル監視

画面データはメモリーから組み立て、最大10回/秒で配信する。保存後に世界状態をディスクから読み戻さない。ファイル一覧は初回だけ走査し、追加・削除された項目を更新する。プレビューは選択ファイルのrevisionが変わった場合だけ再取得する。管理ファイルを含む外部編集もプレビューへ反映するが、生活の確定状態へ自動採用しない。親のresult.jsonはTurn完了時の検証経路で扱う。

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

`test:persistence`はビルド済みの実Workerを使う。10秒のWorker停止中の移動・発話・snapshot取得、履歴/snapshot/manifest公開直後のWorker強制終了を検証する。比較は20 NPC・8施設・約8 MBの完了履歴と同じ40行動で行う。旧経路はcheckpoint書込ペイロードを数え、テストのために数GBを実ディスクへ書くことを避ける。新経路は初期履歴も含め実保存したファイルの論理バイト数を数える。旧経路のbackend/stateの追加書込は加算しないため、削減率は控えめな比較となる。

結果は`.local/diagnostics/in-memory-benchmark.json`へ記録する。Tool処理時間、イベントループの最大計測間隔、保存時間、未保存量も記録する。Codex内部I/O・PTYは対象外であり、fixtureに実モデル推論は含まない。既存の接続テストは別に実Codex CLIとローカルResponses fixtureを検証する。Electron E2Eは保存失敗後の終了取消・再保存・再起動、および保存中の画面操作と選択ファイルだけの再読込を検証する。
