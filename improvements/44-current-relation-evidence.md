# 44 — 関係の更新後に、参照外になった古い記憶を表示しない

関係の詳細を開いている間に、その関係の根拠が新しい記憶revisionへ更新されても、以前選んだ記憶の詳細が残っていました。新しい関係ラベルの下に、現在は引用されていない古い記憶が並ぶため、制作時の根拠確認を誤らせる表示でした。

## 修正

選択した記憶の所有者・ID・revisionが、表示中の関係の根拠一覧に含まれる場合だけ詳細を表示します。ラベルだけが変わり、根拠の参照が同じ場合は開いたままにします。

参照が変わった場合は古い詳細を閉じます。読み込み途中でも表示用コンポーネントを解除し、既存の遅延応答除外が働くため、後から届いた旧結果は新しい関係の下へ表示しません。新しい根拠ボタンから、そのrevisionを開けます。

記憶の保存データや過去のrevisionは変更しません。端末側の記憶パネルで別途開いた履歴にも影響しません。ゲーム固有の行動や関係ラベルによる判定は追加していません。

## 再現と検証

既存の記憶・関係E2Eに、同じ関係のラベルと根拠を更新する操作を追加しました。修正前はrevision 2の参照へ切り替えた後も、revision 1の詳細が1件残り、表示件数のassertionで失敗しました（exit 1、`relation-evidence-before.log`）。

修正後は、同じ参照を維持したラベル変更、revision変更での旧詳細の終了、revision 2の読み込み中にrevision 3へ更新した場合、遅延したrevision 2の応答の除外、revision 3の正しい詳細を開く操作が成功しました。固定時間の待機ではなく、fixture側で読み込み開始を確認して応答を保留・解放します。

実行場所はプロジェクトルート、対象は本変更後、ログは`.local/polish-20260914/`です。

| command | exit | 結果 | log |
|---|---|---|---|
| `npm run typecheck` | 0 | 成功 | `relation-evidence-typecheck.log` |
| `npm run lint` | 0 | 警告0・成功 | `relation-evidence-lint.log` |
| `npm run build` | 0 | 成功。既存のzod注釈に関するRollup警告あり | `relation-evidence-build.log` |
| `node node_modules/@playwright/test/cli.js test tests/e2e/memory.spec.ts` | 0 | 追加した更新・遅延応答を含む1件PASS、4.9秒 | `relation-evidence-after.log` |
| `npm test` | 0 | 単体71件・backend170件PASS | `relation-evidence-test.log` |
| `node node_modules/@playwright/test/cli.js test --config .local/polish-20260914/package-watch.config.ts --repeat-each 5` | 0 | Codex側の比較5回PASS、24.0秒 | `package-watch-diagnostic.log` |
| `node node_modules/@playwright/test/cli.js test`（同じbuildで再実行） | 0 | 全34件PASS、5.2分 | `relation-evidence-e2e-final.log` |

初回の全34件E2Eは33件PASS・1件FAIL、4.7分でした（`relation-evidence-e2e.log`）。Codex側のパッケージ比較で、基準候補を含むoption 2件に対して1件のまま5秒が経過しました。今回の記憶・関係テストは成功しています。native異常終了ではなく、比較候補の表示件数のassertionです。

初回traceは`relation-evidence-package-failure.zip`として保存しました。このtraceには画面snapshotが収録されていなかったため、失敗時に内部のworkspace snapshotと画像を採取するローカル診断用コピーを作成し、Codex側を5回実行しました。すべて成功して再発時の状態は得られておらず、候補欠落の原因は未確定です。待ち時間やassertionは変更していません。

同じbuildで通常の全体順序を再実行し、全34件が成功しました。最終の検証は単体71・backend170・画面34の計275件PASSです。再実行の成功によって初回の候補欠落を解決したとは扱いません。今回はnative異常終了は再発していません。

修正前のtraceは`relation-evidence-before.zip`、修正後の画面は`relation-evidence-updated.png`です。画像を開き、関係側はrevision 3、別途開いた端末側の履歴はrevision 1として表示されることを確認しました。

実モデル推論・APIキー使用・既存ワールド変更はありません。CLI・保存実装は変更していないため、専用の接続8件・保存4件は今回再実行していません。過去のnative異常終了をこの描画修正で解決したとは扱いません。

## 試し方・戻し方

`npm run build`後、上記の記憶E2Eコマンドで合成資料を使って確認できます。通常は関係図から矢印の詳細を開き、記憶を表示した状態で関係の整理結果が更新されると、新たな根拠一覧に含まれない詳細が閉じます。

`git log --oneline -- improvements/44-current-relation-evidence.md`でコミットを確認し、`git revert <commit>`、`npm run build`で戻せます。データ移行は不要です。
