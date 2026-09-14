# Persona Compiler

Windows・Electron・TypeScriptで、Codexの親Conversationと独立したNPC／施設Conversationを作るアプリです。新規ワールドでは住宅街と世帯ごとの家を生成し、NPCが3次元の施設内で移動・会話・施設利用・睡眠を選択します。初期化後は `ready` / `turn=0` で停止し、ユーザーの開始操作から生活を進めます。

2026-09-14の改善内容、各機能の試し方・検証結果・revert手順は[磨き上げレビュー](improvements/README.md)にまとめています。

## 起動

Node.js 24以降、Codex CLIを使用します。準備フロー・生活Tool・実端末の結合検証はCLI **0.154.0-alpha.6.2**、Electronは44.3.0で確認しています。

```powershell
npm ci
npm run dev
```

本番ビルドの起動:

```powershell
npm run build
npm start
```

制作レビューをモデル推論なしで試すには、`npm run demo:review`を実行します。合成の比較資料を作成し、比較画面まで自動で開きます。「両側の根拠を見る」「比較レポートをコピー」を試した後、ファイル一覧の`compilation/current/npcs/sample/manifest.json`で5ファイルの照合とレポートコピーを確認できます。ウィンドウを閉じると終了します。

manifestの画面で「別のパッケージとファイルを比較」を開き、基準に`Compilation baseline`を選ぶと、全登録ファイルの差分も確認できます。ファイルの形式によらずhashで比較し、追加・削除・内容変更と欠損を分けて表示します。結果と両側の照合記録をMarkdownとJSONでコピーできます。

制作レビューの上部にある「制作レビュー全体をコピー」で、読み込み済みの全設定・全根拠・Runtime向けの指針・Runtime Promptを、元ファイルのhashと採取時刻付きで持ち出せます。検索中でも全体を収録し、Markdownの末尾にはJSONも含みます。`review.md`は生成時のレポートなので、`review.json`を外部編集した後は画面の更新を確認して全体コピーを使ってください。空の区分や未引用の資料も保持し、ゲーム固有の形式へ変換する処理は行いません。

このデモはゲームへの組み込み前に資料を確認する操作例で、実際のAI生成結果や生活シミュレーションの品質を示すものではありません。認証・Codex CLI・実モデルは使用しません。実行ごとに`.local/review-demo-*`へワールドとElectronのprofileを分けて作り、既存ワールドを読み込まず、再実行でも前の資料を上書きしません。保存先はコンソールに表示します。自動検証は`npm run test:review-demo`です（実クリップボードを書き換え、比較・照合レポートと画面画像を同じデモ用ディレクトリへ保存します）。

`codex.exe` をPATHに置くか、`PERSONA_CODEX_BIN`へ実行ファイルの絶対パスを指定してください。アプリは接続ボタンから専用App Serverを起動し、backendと実CLIの両方が同じConversationへ接続します。App ServerのWebSocketはlocalhost限定で、起動ごとに生成するcapability tokenで認証します。

Windowsのnode-pty 1.2.0-beta.15にはNode-APIの公式バイナリーが同梱されています。複数端末の同時終了で起きるnativeの競合を修正した版に固定しています（[修正理由と検証](improvements/12-native-terminal-exit.md)）。この環境ではElectronから実PTYの起動・出力を確認済みです。ソースからビルドする場合は `npm run rebuild:native` を使用します。Visual Studio C++ Build Toolsと対応するSpectre軽減ライブラリが必要です。現在の環境では後者が不足しており、ソース再ビルドは未成功です。軽減機能を無効にする変更は行っていません。

Windows端末の終了後にworkerが残る別の不具合には、`patch-package`で[解放処理のパッチ](improvements/13-terminal-resource-cleanup.md)を適用しています。通常の`npm ci`で自動適用され、パッチが適用できなければインストールを失敗として通知します。

chokidar 5.0.0にも[監視開始順序のパッチ](improvements/48-watch-before-directory-scan.md)を適用しています。新しいディレクトリの初回列挙後、監視開始前に作られたファイルが一覧から欠ける競合を防ぎます。同じ`postinstall`で自動適用されます。

このパッチには、[ファイルからディレクトリへの置換と復元後の通知順序の修正](improvements/51-directory-replacement-watch.md)も含みます。復元したディレクトリの子と、その後の追加・更新を一覧へ反映します。48の旧パッチを適用した依存環境から更新する場合は、`npm ci`で依存を再インストールしてください。

## 実Codexでの操作

1. 「ChatGPTで接続」または「APIキーで接続」を選びます。ChatGPTログインは外部ブラウザーで完了します。APIキーはアプリのパスワード入力欄へ入力してください。
2. 親・NPC・施設のモデルとeffortを設定し、「設定を保存して親端末を作成」を押します。モデルと対応effortは接続先の `model/list` から取得します。
3. 地域の文章とPNG／JPEG／WebP画像を送り、最初の質問ラウンドに回答します。推奨・代替選択肢に加え、自由記述だけでも回答できます。
4. 人口配分・施設・終了条件と地図を確認します。修正依頼は同じ親Conversationへ送られ、仕様revisionが進みます。
5. 表示中のrevisionを承認します。承認済みの仕様と地図をhash付きで保存してから、初期人口を生成・検証します。
6. 施設モデルが承認済みサイズ内の用途付き領域を設定します。住宅街は全世帯へ1軒ずつ家を配置し、NPCが自分の入場座標を選びます。全対象の検証後に `ready` になります。
7. 「生活を開始」または「1ターン実行」を押します。朝・昼・夕・夜の順に進み、ターン上限で停止します。町の施設にある「内部へ」から、回転・ズーム・高さ上限・家の選択ができる3D画面を開けます。NPCの選択は既存の端末へ接続します。

端末は実Codex CLIです。タブを閉じてもCLIとConversationは維持され、再表示時はheadless terminalのsnapshotと連番chunkから復元します。テキスト選択中のCtrl+Cはコピー、未選択のCtrl+C・停止ボタンは推論の中断です。推論していないときの中断操作でCLIを終了させません。CLIを `/exit` などで終了した場合は、端末右上の「再接続」でその端末だけを同じConversationへ戻せます。推論中も再接続でき、推論を再送しません。

親Sessionは代理承認モード（`approvalPolicy: on-request`、`approvalsReviewer: auto_review`）です。作業領域は`workspace-write`を維持し、追加権限の要求はCodexの自動レビューへ送ります。新規NPC・施設は `environments: []` と役割別dynamicToolsを使います。実CLIのcwd指定が環境を再有効化しないよう、localhostの認証付き中継が設定を維持します。Windowsのリダイレクトやjunctionに備えて、Session作成・復帰時の作業先とCODEX_HOMEは実体パスへ正規化します。

役割別設定は親作成後に固定されます。別設定を試す場合は「新しい実行」を使います。以前の実行データは削除されません。再起動時は `active-run.json` が指す実行を読み込みます。新方式で正常終了した実行は、接続後に保存済みのthreadIdへ復帰します。dirtyが残った実行は閲覧専用になり、推論・配信・CLI入力を再送しません。

## 親システムプロンプト

親の全体方針には、提供された `src/core/prompts/parent-system.md` のtextコードブロックを使用します。原文を保持し、`src/core/prompts.ts`で現行の準備フェーズ用規則とJSON Schemaを末尾に付けます。最初の質問ラウンド、Harnessによる承認・Session作成、turn=0での停止は維持します。生活進行は親から分離したCoreが担当し、新規ワールドではHarnessが出生時の初期条件生成と終了後のCharacter Compilationを親へ依頼します。新しい親Conversationの作成時、およびアプリ再起動後に保存済みのConversationへ接続するときに適用します。接続中のCLIだけを再接続してもbaseInstructionsは更新されないため、ソースファイルのプロンプト変更後はアプリを再起動してください。DEV画面での編集は停止中にその場で適用できます。既存のConversation ID・会話履歴・承認済み仕様は引き継ぎます。

## DEVモード

上部の「DEV」から有効にすると、画面内でプロンプトを編集・適用し、保存した生成段階・時間ターンへ巻き戻せます。元の世界とConversationを残した実験分岐を作り、既定では適用済みの最新版プロンプトを維持します。保存時点の版も選べます。生成前から研究する場合は、最初の資料を送る前に有効にしてください。操作・復元範囲・保存規則は [DEV.md](DEV.md) を参照してください。

## 主観的な記憶

新規ワールドのNPCは、主観的な記憶・予定・睡眠時の整理・方向別の対人認識に対応します。NPC端末の「記憶・未来の意図」と関係図から確認できます。既存ワールドには自動追加しません。Tool、保存、検証方法は [MEMORY.md](MEMORY.md) を参照してください。

## アイテム・会社経営・生存状態

新規ワールドには親が生成する初期資金とアイテムを追加します。NPCは登録申請、取得、売買・贈与、保管、雇用、一次生産、町外出荷をToolで行います。HP・空腹・SAN値と死亡時の相続もCoreが管理します。「経済」、NPCの「持ち物・状態」、組織の会社情報から観測できます。取得権・権限・保存・初期バランスは [ECONOMY.md](ECONOMY.md) を参照してください。既存ワールドへの自動移行は行いません。

## NPCのAuto

モデルAutoとeffort Autoは独立しています。初期値は接続先の既定モデル・既定effortを使う固定モードです。Harnessは親の初期文脈と各準備・人口生成要求に、保存済みの役割別モデル設定、Auto／固定の区別、固定モデルID、利用可能なNPCモデル候補を明示します。固定の場合も全NPCのbirthModelId・modelSelectionReasonを生成対象に含めます。

- モデルAutoの候補は、利用可能モデルと `gpt-5.6-luna` / `gpt-5.6-terra` / `gpt-5.6-sol` / `gpt-6-astra` の共通部分です。親がスポーン時に理由付きで選び、`birthModelId`として保存します。配分比率は固定しません。
- effort Autoは0〜5歳 `low`、6〜17歳 `medium`、18歳以上 `high`。未対応値は順序 `none < minimal < low < medium < high < xhigh < max < ultra` で最も近い対応値へ割り当て、同距離なら低い方を選びます。設定画面にモデル別の実効値を表示します。
- モデルAuto＋固定effortは、候補すべてが対応するeffortだけ選択できます。出生時モデルが利用不能になった場合は明示的なエラーとし、自動的なモデル変更はしません。

## 保存と責任分担

既定のデータ保存先はElectronの `userData/runs`、Codex専用領域は `userData/codex/<認証方式>` です。資格情報はCodexの `keyring` を使い、アプリの保存状態・成果物・ログへAPIキーを保存しません。通常のユーザー用CODEX_HOMEやその認証情報はコピーしません。

保存先を変える場合は `PERSONA_DATA_DIR`、Codex専用領域を変える場合は `PERSONA_CODEX_HOME` に絶対パスを設定してください。既存のCodex用ディレクトリーとは分けてください。

新規ワールドはIn-Memoryで生活を実行し、変更があれば30秒ごとに保存Workerで自動保存します。一時停止・初期化完了・ターン上限・正常終了時にも保存し、「今すぐ保存」も使えます。保存失敗は警告して生活を継続します。保存形式と復旧規則は [PERSISTENCE.md](PERSISTENCE.md) を参照してください。

```text
<runId>/persistence/manifest.json          新形式の確定世代・hash・dirty
<runId>/persistence/snapshot-a.json        現在状態（交互に使用）
<runId>/persistence/snapshot-b.json        現在状態（交互に使用）
<runId>/persistence/history/*.jsonl        完了履歴・Tool結果・出来事
```

以下の`backend.json`・`state.json`・`simulation/checkpoint.json`は旧方式だけで使用します。入力・親の作業ファイルなどは新方式でも維持します。

```text
active-run.json                        現在の実行ID（runs直下）
<runId>/backend.json                    準備状態・役割別設定・Session対応・進行中操作
<runId>/state.json                      地図・Agent一覧・所在地の公開版
<runId>/inputs/                         元の文章・画像
<runId>/preparation/work/               親の作業領域とresult.json
<runId>/preparation/questions/          質問ラウンド
<runId>/preparation/answers/            送信済み回答
<runId>/preparation/drafts/             仕様revision
<runId>/preparation/locked.json         承認済み仕様・地図（hashはbackend.jsonに保持）
<runId>/population.json                 検証済み初期人口・出生時モデル・選択理由
<runId>/agents/<npcId>/                 NPCの初期条件
<runId>/facilities/<facilityId>/        施設の初期条件
<runId>/simulation/checkpoint.json      hash付き世界状態・家・座標・配信・Tool結果・Compact進捗
```

- `src/core`: Electron非依存のスキーマ、モデル設定解決、最大剰余法、人口・家族・地図・住宅の検証、生活状態機械、メッセージ配信、差し替え可能なPromptProvider。
- `src/backend`: App Server RPC、実CLI PTY、準備制御と復旧。親は通常のコーディングツールでJSONを作成し、HarnessがTurn完了通知の後に検証して公開します。端末の文章から状態は推測しません。
- `src/main`: Electron IPCとディスク・監視処理。`src/preload`はsandbox内で動作するCommonJSの型付き境界です。
- `src/renderer`: 認証・モデル設定・質問・仕様レビュー・地図・Three.js施設内画面・端末・ファイルプレビュー。

モデルの作業領域とHarnessの確定ファイルは分かれています。外部編集はファイルプレビューへ反映されますが、生成途中のJSONや `state.json` の外部変更を本番の確定状態へ自動採用しません。承認後の仕様・地図のhash不一致は生成停止になります。新方式では外部操作前にdirtyの保存を待ち、通常の生活Toolでは保存を待ちません。旧方式はSession生成の送信前に記録を保存します。どちらも応答不明の生成要求を自動再送しません。既知のTurn IDは再開時に状態照会できます。IDや完了状態を確定できない場合はエラーとして残し、成功済みデータを保持します。

Windowsのファイル置換では、一時的なdeny-delete共有ロックの解放を最大1秒待って同じ原子的renameを再実行します。別方式の上書きに切り替えません。

## 今回の境界

施設内座標は各軸0以上サイズ未満の整数です。意味付き領域は重複可能、家同士の領域は重複不可。同じ座標に複数NPCが滞在できます。住宅街のサイズは承認後に拡張しません。

`moveWithinFacility` は無制限の即時移動、`moveToFacility` はターン内に1回の施設移動予約です。活動を終了し、他NPCには移動先・位置未設定として返します。元の施設の発話は届きません。実際の入場位置は次ターンに選び、全員分揃ってから生活を開始します。

`endTurn` のみの場合は現在地で活動終了として残ります。終了後に受け取る発話・施設回答・誘導入力は次ターンへ保持し、同じターンの活動を再開しません。受信待ちの発話は最大32件・合計32,000文字ずつまとめて配送します。各発話の発言者・元のターン・配送ID・記憶の根拠は個別に保存し、結果不明の配送を自動再送しません。

CLI端末は表示したSessionだけ起動します。Conversationの生成・生活推論は端末を開かずに進みます。メッセージ履歴は通知で更新されたConversationだけ再取得し、画面へは変更されたTurnを送ります。通常の生活処理では変更した状態の枝だけをコピーし、受信待ち全体を毎回コピーしません。

声量はlowが直線距離1、mediumが5、highが同じ家の中全体、屋外なら同施設の屋外全体。声量によらず家の内外は双方向に遮断され、別の家にも声は届きません。睡眠中のNPCへは発話を届けず、起床後にも再配信しません。状況取得は同施設内の全NPCの公開座標を返します。

推論は並列、世界への反映はTool受信順です。全員の活動終了と未完了の配信・推論・施設回答・Compactの解消を待って次ターンへ進みます。会話回数や時間による強制打切りはありません。一時停止で活動を止められます。`sleep` ごとに同じConversationをNative Compactし、次ターンに起床します。実CLIへの誘導入力は同じConversationへ入り、睡眠中の入力は起床後へ保持します。

新方式の正常終了後は停止状態で復元し、Tool結果の索引で重複適用を防ぎます。異常終了でdirtyが残った実行は閲覧専用です。旧方式は未確定の推論・配信・Compactを履歴で照合し、確認できなければ対象を表示して停止します。以前の形式のワールドは閲覧でき、新しい生活形式への自動変換は行いません。

新規ワールドは結婚・新居・出生・加齢・死亡・世代交代と、終了後の自動Character Compilationに対応します。4ターンで1歳加齢し、80歳以上で老衰します。終了条件と生存者のパッケージ生成、Tool・保存規則は [LIFECYCLE.md](LIFECYCLE.md) を参照してください。Minecraft Modとスキン画像生成は次段階です。家族以外の友人関係や人生経験を初期人口へ捏造しません。NPCのPromptProviderは差し替え可能で、人格Prompt研究は分離しています。

## 明示的なデモ

従来のDemoEngineは残しています。実モデルを使わずUIを試す場合:

```powershell
$env:PERSONA_ENGINE = 'demo'
npm run dev
```

デモでは4人から始まり、2日目に2人を追加し、一日4フェーズで日次観測を更新します。端末応答・地図生成・関係ラベルは模擬です。ファイル操作と監視は実際のディスクを使います。デモは起動ごとに新しい実行を作成します。`PERSONA_TEST=1`も必ずこの無課金経路を使います。

## 検証

```powershell
npm run typecheck
npm run lint
npm test
npm run test:connection
npm run test:persistence
npm run test:e2e
```

- 単体テスト: 既存デモ・ファイル監視・端末連番、Auto、年齢境界、人口配分、質問・承認、準備の復旧に加え、家の検証、3次元距離、家の双方向の遮音、移動予約、活動終了後の次ターン配送、まとめ配送、端末の遅延起動、履歴の差分更新、睡眠、配信重複防止、日付更新を確認します。
- `test:connection`: 実Codex App Serverと実CLI PTYをlocalhostのResponses fixtureへ接続します。両方向入力、通知、effort、Ctrl+C、リサイズ、再接続、dynamicTools、Native Compact、履歴中の配信IDを確認します。5 NPC・3世帯・住宅街＋学校＋職場＋店舗の9 Conversationで、一日の生活も実行します。**このコマンドはOpenAIの実モデル推論や認証成功を検証するものではありません。**
- Electron E2E: 既存デモ、実App Serverへの未認証接続、同梱Native PTY、IPC fixtureを使う設定・質問・仕様レビュー・承認、3D回転・ズーム・高さ変更、声の範囲、NPC端末選択、生活開始・1ターン実行を確認します。テストデータは `.local`、トレースは `test-results` です。

ChatGPT認証の実モデル確認は2026-09-12に実施しました。固定した5 NPC・3世帯の初期条件から、施設モデル自身が4施設と3軒の家を初期化し、各NPCが入場位置を選択しました。`turn=0 / ready`から朝・昼・夕・夜を進め、会話、施設間・施設内移動、8件の施設利用、全5人の睡眠とNative Compactを確認し、`turn=4`で終了しました。別の実モデル試験では、親のヒアリング・仕様レビュー・revision指定承認・人口案生成を経て、5 NPC・4施設と3軒の家が初期化され、`turn=0 / ready`で停止することも確認しました。APIキー経路の実モデル試験はユーザー指定により今回は省略しています。

実モデル試験は通常のテストから分離しています。アプリ専用の認証済み領域を指定すると推論が実行されます。

```powershell
$env:PERSONA_REAL_CODEX_HOME = Join-Path $env:APPDATA 'persona-compiler/codex'
$env:PERSONA_REAL_AUTH_MODE = 'chatgpt' # または認証済みの apiKey
npx vitest run --config vitest.real.config.ts tests/real/life.test.ts
npx vitest run --config vitest.real.config.ts tests/real/preparation.test.ts
```

生活の検証結果は `.local/real/life-<認証方式>-*/acceptance.json`、世界状態は同じフォルダーの `checkpoint.json` に保存します。準備フローの検証結果は `.local/real/preparation-<認証方式>-*/acceptance.json` と配下の `runs` に保存します。世界内の会話は回数で打ち切りませんが、この受け入れテスト自体の待機期限を超えると一時停止して結果を保存します。

仕様根拠: [App Server](https://learn.chatgpt.com/docs/app-server)、[認証](https://learn.chatgpt.com/docs/auth)、[設定と権限](https://learn.chatgpt.com/docs/config-file/config-reference)、[node-pty](https://github.com/microsoft/node-pty)。
