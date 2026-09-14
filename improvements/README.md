# 磨き上げレビュー — 2026-09-14

作業ブランチ: `codex/hackathon-polish`。着手点: `051ef09`。push・外部公開は行っていません。

| commit | 内容 | 試し方・検証・戻し方 |
|---|---|---|
| `6ebb9a8` | 同じファイルを再選択するとプレビューが消える不具合を修正。入場位置未設定からの手動再開を検証 | [01](01-file-preview.md) |
| `9d32612` | NPC制作レビュー。人格・行動・予定から保存済み根拠へ辿り、Markdownでも持ち出せる | [02](02-character-review.md) |
| `927a251` | 出来事QA。住民・受信対象・種別・ターン・本文で検索 | [03](03-event-timeline.md) |
| `b759300` | サイドバーを実際の町名と一致させる | [04](04-world-title.md) |
| `b894b1c` | 保存済みの全期間から出来事を検索。100件ずつ安定したページ送り | [05](05-saved-event-history.md) |
| `cb42232` | NPCパッケージ内の関係→根拠記憶の参照切れを検出 | [06](06-relationship-evidence.md) |
| `50ee77d` | manifestとファイルを照合し、成果物の欠損・内容変更を表示 | [07](07-package-inspection.md) |
| `e09f04f` | 端末幅の変更が1回のIPC失敗で止まり続ける不具合を修正 | [08](08-terminal-resize.md) |
| `5881ff8` | 再生成したNPCの設定・根拠・Runtime Promptを別の制作レビューと比較 | [09](09-review-comparison.md) |
| `1b3ced7` | 終了済みワールドのNPC端末について、バックエンドでも再接続を拒否 | [10](10-ended-npc-reconnect.md) |
| `1b16d1b` | 表示中の出来事を、検索条件・参照位置付きのQAレポートとしてコピー | [11](11-event-qa-report.md) |
| `7ab905d` | 複数端末の同時終了時のnative競合について、node-ptyの上流修正版を適用 | [12](12-native-terminal-exit.md) |
| `aad2f5b` | 端末の終了・再接続で出力workerが残る不具合を修正 | [13](13-terminal-resource-cleanup.md) |
| `25741c4` | 起動が遅い端末の停止時に未確定PIDへシグナルを送る不具合を修正 | [14](14-terminal-startup-shutdown.md) |
| `2a0f08e` | NPCの比較結果を、両側の根拠・資料のhash付きでMarkdownへコピー | [15](15-review-comparison-report.md) |
| `a947775` | 外部リンク経由の保存拒否時に、ワールド外へ空ディレクトリを作る不具合を修正 | [16](16-workspace-write-boundary.md) |
| `750f852` | `..notes.md`等の正当な名前をワールド外と誤判定する不具合を修正 | [17](17-workspace-dot-prefix.md) |
| `d27e9c3` | native例外のコード・stack・dumpを採取する診断手段。異常終了自体は未解決 | [18](18-native-crash-diagnostics.md) |
| `b68953d` | 不正なRPC受信による端末中継の未処理例外を修正 | [19](19-terminal-rpc-envelope.md) |
| `a94eee2` | RPCの異常受信後に接続が残り、後続処理が動く不具合を修正 | [20](20-rpc-failed-connection.md) |
| `827d5f4` | Node単体の終了競合を分離再現し、CLIテストへ段階記録を追加 | [21](21-native-node-shutdown.md) |
| `315e50a` | Compilation入力の外部変更でmanifestへ誤った根拠hashを記録する不具合を修正 | [22](22-compilation-input-provenance.md) |
| `c9d402e` | 親へ渡す出生・Compilation入力の変更を検出し、不整合な結果の採用を停止 | [23](23-production-input-integrity.md) |
| `8457234` | 成果物の照合結果を、manifestのhash・照合時刻付きのMarkdownとJSONでコピー | [24](24-package-inspection-report.md) |
| `bf60780` | 合成資料でレビュー比較・根拠確認・成果物照合を試せる専用デモコマンド | [25](25-offline-review-demo.md) |
| `797a84f` | プレビュー失敗後、同じファイルの再選択や専用ボタンから再試行できるよう修正 | [26](26-preview-retry.md) |
| `91b7556` | 根拠資料の本文・題名・IDから、その資料を参照するNPC設定を逆引き | [27](27-review-evidence-search.md) |
| `90ae325` | DEV検証が保存前のチェックポイントを取得して失敗する競合を修正 | [28](28-dev-checkpoint-test-wait.md) |
| `96cf331` | App Server起動確認のHTTP応答本文を解放し、キャンセル失敗を明示 | [29](29-readiness-response-cleanup.md) |
| `0d329d5` | 端末切断で返答不明になったCLI要求について、終了時の30秒待ちを即時エラーへ変更 | [30](30-relay-disconnected-ack.md) |
| `cf6db43` | 制作レビューで同じ根拠を再選択したときも、資料の位置へ移動するよう修正 | [31](31-review-evidence-navigation.md) |
| `58c1bc7` | 検索した設定と全根拠を、検索条件・元資料のhash付きでMarkdownとJSONへコピー | [32](32-review-search-report.md) |
| `978500d` | 結果のない不正なRPC応答で要求が完了扱いになる不具合を修正 | [33](33-rpc-response-validation.md) |
| `c44b389` | 全画面検証を追跡できるようnative診断の期限を明示指定可能に変更 | [34](34-native-diagnostic-deadline.md) |
| `2e1a6b3` | 根拠と設定を索引化し、制作レビュー比較で繰り返していた計算を削減 | [35](35-review-comparison-index.md) |
| `c5ccc9c` | ターン上限以外の終了も上限到達と表示する不具合を修正 | [36](36-simulation-end-reason.md) |
| `3f6b530` | パッケージの全登録ファイルを比較し、追加・削除・内容変更・欠損をレポート化 | [37](37-package-file-comparison.md) |
| `a0dcb20` | 入力保存中に停止した親の制作処理を、保存後に新たに開始する競合を修正 | [38](38-production-pause-boundary.md) |
| `git log --oneline -- improvements/39-production-late-start-interrupt.md`で確認 | 停止後に開始応答が届いた親の制作処理を中断し、先に完了した成果物は保持 | [39](39-production-late-start-interrupt.md) |

各コミットの直後に差分の自己レビューを実施しました。機能ごとに取り消す場合は、作業ツリーの変更を確認したうえで`git revert <commit>`を使えます。全体を戻す場合は表の下から上の順にrevertしてください。

## 起床後の確認

最初に`npm run demo:review`で、認証やモデル推論なしの制作レビュー比較を開けます。合成資料とElectronのprofileは実行ごとに`.local/review-demo-*`へ隔離します。詳しい操作は[25](25-offline-review-demo.md)を参照してください。

更新したアプリの起動は`npm run build`、`npm start`です。現在のアプリに未保存のデータがある場合は、アプリ側の保存・終了操作を完了してから起動してください。

- 生活のあるワールドで「出来事」を開き、住民名や発話を検索します。保存形式は変更していません。
- 古い出来事は「保存済み履歴を検索」で調べられます。未保存分は対象外です。
- 「QAレポートをコピー」で表示中の出来事と検索条件をMarkdownへ持ち出せます。保存済み検索はそのページだけを収録します。
- 生成済みNPCの「成果物を照合」でmanifestと各ファイルの一致・変更・欠損を確認できます。特定のゲーム形式には依存しません。
- 「照合レポートをコピー」で、照合したmanifestと各ファイルのhash・結果・時刻を制作担当者や実装用agentへ渡せます。貼り付けたMarkdownの末尾にJSONも含まれます。
- 成果物照合の「別のパッケージとファイルを比較」で、同じNPCの別Compilationと全登録ファイルを比較できます。記憶が同じ件数でも内容の違いを検出し、バイナリーにも対応します。「ファイル比較レポートをコピー」で両側の照合記録も持ち出せます。
- 今回の変更後に生成したCompilationには「制作レビュー」が付きます。既存出力は自動で再生成していません。
- 制作レビューの検索対象を「根拠資料」にすると、出来事や資料の語句・IDから、その資料を参照する設定を探せます。「検索一致」の根拠ボタンで全文を確認できます。
- 「設定の検索レポートをコピー」で、表示中の設定と全根拠を検索条件・元資料のhash付きで持ち出せます。0件の条件も記録でき、空の検索条件では全設定を収録します。
- 同じNPCの制作レビューが2つあれば、「別の出力と比較」で再生成による変更を確認できます。比較そのものにモデル推論は不要です。
- 「比較レポートをコピー」で変更内容・両側の根拠・参照情報を制作記録へ持ち出せます。
- ファイルの読み込みエラーが出た場合、原因を解消してから同じファイルの再選択か「プレビューを再読み込み」で再試行できます。
- 実モデルを使わない操作検証は`npx playwright test tests/e2e/lifecycle.spec.ts tests/e2e/life.spec.ts`で実行できます（先にbuild）。これは合成fixtureであり、実モデルの生成品質を示すデモではありません。
- 実行済み検証のログとスクリーンショットは`.local/polish-20260914/`にあります。

## 検証の結論と残る範囲

最新の親の遅延開始応答の中断修正でbuild・typecheck・lint成功、単体68・backend166・Electron E2E30・実CLI接続8・保存4の計276件PASSを確認しました。ただし初回のnpm testではRPCテストのworkerが3221226505で異常終了しました。RPC単独7件・backend全166件はnative診断下で成功し、通常の全体再実行も成功しましたが、この異常終了は未解決です。再現条件・失敗ログ・最終検証は[39](39-production-late-start-interrupt.md)に記録しています。開始前の停止境界の修正は[38](38-production-pause-boundary.md)です。パッケージのファイル比較とスクロール修正は[37](37-package-file-comparison.md)に記録しています。制作レビュー比較の処理時間改善は、測定条件とともに[35](35-review-comparison-index.md)へ記録しています。ただし[33](33-rpc-response-validation.md)の初回E2EではPlaywright workerが`3221226505`で異常終了し、26件PASS・1件FAILでした。直前と該当の4件はnative診断配下で成功、通常の全体再実行も成功しましたが、この異常終了は未解決です。途中で見つかったDEV検証の保存完了待ちの競合は[28](28-dev-checkpoint-test-wait.md)で修正済みです。[25](25-offline-review-demo.md)では専用デモの比較・照合・実クリップボード、通常表示と終了も検証しました。

[34](34-native-diagnostic-deadline.md)で診断期限を明示指定できるようにし、全27件の画面検証をnative診断配下でも最後まで実行しました。3.7分で全件PASS・例外採取0・期限超過0でした。これは診断手段の拡張と検証記録であり、異常終了を解消したという変更ではありません。

別件として[17](17-workspace-dot-prefix.md)のCLI検証では`life-tools.test.ts`のworkerが終了コード`3221226505`で異常終了しました。該当テスト単独と正式CLI検証の再実行は成功していますが、native異常終了は未解決です。今回のRPC形式検証によって解消したとは扱いません。

端末の同時終了時のnative競合には[12](12-native-terminal-exit.md)で上流修正版を適用し、[13](13-terminal-resource-cleanup.md)でworker残留を修正してクリーンインストールも検証しました。さらに起動が遅い端末の停止時に未確定PIDへシグナルを送る不具合を修正しました。今回再発した`3221226505`の直接のstackは未取得です。過去の全異常終了を解消したとは断定せず、既存のテスト除外・閾値・警告設定も変更していません。

[18](18-native-crash-diagnostics.md)では、意図的なfixture例外でnative stackの採取手段を検証しました。診断配下のCLI8件と保存4件の並行実行、対象CLIテスト最大5回とE2E18件の並行実行では再発しませんでした。これは原因解消の証明ではなく、次の再発を調査するための手段と記録です。

[21](21-native-node-shutdown.md)で、Node 24.15.0単体のlocalhost最小fixtureから`C0000409`と`uv_async_send`のassertionを再現し、stack・dumpを採取しました。同じ条件は比較用Node 24.21.0とElectron 44.3.0のNodeモードで正常終了しました。元のCLI失敗との同一性は未確認です。CLIテストに段階記録を追加し、通常Node・比較用Nodeで接続8件ずつ成功しました。インストール済みNodeやアプリ本体は変更していません。

追加機能はローカルfixtureで保存・IPC・画面操作まで検証できたため、ユーザーの最新指示に従って実モデルの試運転はスキップしました。ChatGPT推論・APIキーの使用は開始していません。既存ワールドの削除も実施していません。今後、実モデルが必要な検証をする場合は全モデルを5.6 Luna / low固定とし、通常の機能確認は3日（12ターン）を基準にします。

Computer Useで起動中アプリの停止エラーを観察し、実保存履歴と該当NPCのConversationまで調査しました。その後、通常データと分離した合成デモで制作レビューを開き、根拠資料の表示を確認しました。最終ビルドでは町名の一致と「出来事」の検索を操作し、「約束」で2件から該当する1件へ絞れることを確認しました。画面の見た目もE2E画像で検証しています。検証用アプリは終了しました。

実ワールドのturn 29で見つかった停止は、NPCが入場位置の設定依頼に対して施設移動を呼び、拒否後に応答を終えたことが原因でした。座標を捏造せず止める既存の判定を維持し、他NPCの状態を保った手動再開をfixtureで検証しました。実ワールドへ推論を再送していません。実モデルでの長時間運転・生成内容の意味的品質は未検証です。「全てのバグがない」という保証ではありません。

## 審査基準との対応

[大会ページ](https://luma.com/3kj24doy)でTrack 2、実用性25%、完成度20%、OpenAI活用30%、独創性25%を確認しました。今回の機能は、人生シミュレーションの結果を調査し、根拠を確認してゲーム用NPCへ採用する制作工程の改善です。追加のモデル数や架空の評価点・時間短縮率は用いていません。第三者のキャラクター・画像・音楽も追加していません。

大会からリンクされたGoogle Docsのルール・規約本文は取得できませんでした。引用された条件と大会ページの範囲で改善しており、規約全体への適合を確認済みとはしていません。
