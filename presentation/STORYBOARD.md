# ファイナル発表 絵コンテ — Persona Compiler (Team HL)

- 日時: 2026-09-17 18:00–21:00 渋谷サクラステージ
- 枠: **5 分 = 3 分デモ + 2 分 Q&A**
- 審査員: Justin Waldron (Playable Intelligence / ex-Zynga, Playco), Jerry Chi (Supercell Tokyo AI Lab), Shunsuke Oyu (AnotherBall / IZUMO), Rob Pereyda (Henshin AI / ex-Netflix Anime), Teddy Cross (Playco), Tyler Ryu (OpenAI Codex)
- 言語: 英語スライド。スピーチは日英どちらでも成立するようノートを両方付ける
- 形式: `.pptx` 16:9、動画は pptx に埋め込み（会場 PC で再生できるよう mp4/H.264）

## 設計方針

1. **3 分の主役は動画（約 100 秒）**。スライドは動画の前後に「なぜ」「何が得られるか」を挟む額縁。
2. 本編スライドは **5 枚**。1 枚 15〜25 秒。文字は 1 枚 20 語以下。
3. Q&A 用の補足スライドを **付録 8 枚** 用意し、質問が来たら番号ジャンプで出す。本編では見せない。
4. ライブデモは主経路にしない。Chrome RDP が会場で安定していれば、Q&A 中に「保存済みワールドのレビュー画面」を開く程度のボーナスに留める（推論しないので待ちが無い）。
5. 提出文書と同じ事実だけを使う。実装に無いものは言わない。

## 本編（3:00）

| # | 時間 | スライド | 画面に出す英文（全文） | スピーチ（英 / 日） |
|---|---|---|---|---|
| 1 | 0:00–0:15 | **Hook**（暗背景、1 行） | **Persona Compiler**<br>*We don't write character backstories. We let characters live them.*<br>Team HL | EN: "In Free Guy, a background NPC turns out to have a soul. We wanted every background character to have one. Then we did the math on hand-writing thousands of personas. So we stopped writing them."<br>JA: 「Free Guy では背景のモブ NPC に魂が宿っていました。全てのモブに魂を持たせたい。でも何千人分も手書きするのは無理。だから書くのをやめました。」 |
| 2 | 0:15–0:35 | **How it works**（横一列の 5 ステップ図） | Describe a town → Parent agent interviews you → Residents live it (one Codex thread each) → Compile → Game-ready NPC package | EN: "You describe a town. A parent Codex agent interviews you and generates the first residents. Then every resident becomes its own Codex thread and just lives: works, talks, remembers, sleeps, marries, dies. At the end we compile what they became into a package your game can load."<br>JA: 「町を説明すると親エージェントがヒアリングして住民を生成。以後は各住民が自分の Codex スレッドとして生活し、最後にその人生をゲーム用パッケージにコンパイルします。」 |
| 3 | 0:35–2:20 | **Demo**（全面動画 100 秒） | （動画のみ。左上に小さく "Real model run, plains village" のキャプション） | 動画のビートに合わせて生ナレーション（下記「動画ビート」参照） |
| 4 | 2:20–2:45 | **Under the hood**（4 タイル） | **Codex is the body every character lives in.**<br>① 1 resident = 1 persistent Codex thread<br>② 34 typed tools, no shell<br>③ Sleep = native compaction<br>④ Steer mid-thought · fork a whole society | EN: "This is not a chat wrapper. OpenAI tunes Codex models for the Codex harness, so we built the town inside it. One resident, one thread, for life. Everything it can do is a typed tool. Sleep is native compaction. We steer a resident mid-thought, and we fork an entire society to A/B prompts."<br>JA: 「チャットのラッパーではありません。1 住民 = 1 スレッド、行動は型付きツールだけ、睡眠はネイティブ Compaction、推論中に steer、社会ごと fork。」 |
| 5 | 2:45–3:00 | **What you get / Close**（左: パッケージのファイル一覧、右: レビュー画面の根拠リンクの静止画） | character · relationships · memories · behavior · schedule · system_prompt.md · manifest (SHA-256)<br>*Every trait cites the moment that made it true.*<br>**Histories lived, not written.**<br>github.com/MochidsukiC/PersonaCompiler | EN: "Every trait in the package cites the event or memory that made it true, so the character is auditable and brand-safe. Histories lived, not written. Thank you."<br>JA: 「全ての設定に根拠が付くので、監査可能でブランドセーフ。書かれたのではなく、生きられた歴史です。」 |

## 動画ビート（100 秒、実アプリの画面収録）

ナレーションは生で被せる。動画に音声は入れない（会場音響に依存しない）。字幕は最小限。

| 秒 | 画面 | 見せたいこと | 生ナレーション（EN） |
|---|---|---|---|
| 0–10 | ヒアリングの質問カード → 仕様レビュー → 承認 | 親が質問し、開発者が承認する | "The parent agent interviews me and I approve the spec." |
| 10–25 | 3D 施設画面。住民が移動・会話（声量の範囲が見える場面があれば） | 住民が自律的に動く | "Now they live. Each one decides where to go and who to talk to. Voice has range: walls block it." |
| 25–40 | 端末グリッド。1 住民の Codex CLI を開き、開発者が話しかける（steer） | 推論中の住民に直接介入できる | "Every resident is a real Codex thread. I can open its terminal and just talk to it, mid-thought." |
| 40–50 | 住民の「記憶・未来の意図」画面 → 睡眠 → Compaction の表示 | 記憶を選んで眠る = Compaction | "At night it chooses what to remember, then Codex compacts the thread. That's sleep." |
| 50–60 | 組織設立 or 世界イベント（嵐/祭り）の通知と住民の反応 | 社会が自分で変わる / ライブ運営 | "Residents found companies and build. I can schedule a storm for day three." |
| 60–75 | 終了 → Compilation → パッケージのファイル一覧と manifest | 成果物が出る | "When the town's story ends, every survivor is compiled." |
| 75–95 | 制作レビュー画面。設定を 1 つクリック → 根拠の出来事・記憶・会話ターンへジャンプ | 根拠付き | "Click any trait and it shows the moment that made it true." |
| 95–100 | hash 照合 OK の画面 | 検証可能 | "And the package verifies against its hashes." |

代替: 100 秒の新規収録が間に合わない場合は、提出済み 1 分動画をそのまま使い、スライド 4・5 で残りを補う。

## 付録（Q&A 用、本編では出さない）

| # | スライド | 内容 | 想定質問・出す相手 |
|---|---|---|---|
| A1 | Architecture | Electron app（core / backend / main / renderer）↔ Codex App Server ↔ 実 CLI（認証付き localhost 中継）。1 図 | 「構成は？」全員 |
| A2 | Codex primitives | 表: 出生 = thread/inject_items（推論ゼロ）/ 発話 = turn/steer / 睡眠 = thread/compact/start（compaction item を確認）/ 想起 = 本人モデルの ephemeral thread + outputSchema / 復旧 = thread/read + clientUserMessageId / 実験 = thread/fork / モデル固定 = allowProviderModelFallback:false | Tyler Ryu |
| A3 | Memory model | Experienced ≠ Remembered ≠ Recallable。0〜5 件/睡眠、100 件上限、半減期 40 ターンの seed 付き確率、方向別関係＋revision | Oyu / Pereyda / Chi |
| A4 | vs. alternatives | 表: Character-sheet generators / Generative Agents / Persona Compiler。行: 関係の出所、記憶の主観性、成果物、根拠、ゲーム統合 | Chi / Waldron |
| A5 | Cost & scale | Tier 0〜3（推論しない / イベント時 / 毎フェーズ）、役割別モデル・effort、rate limit 再試行。「全員が毎ターン推論するわけではない」 | Waldron / Cross / Chi |
| A6 | Game integration | 出力はエンジン非依存 JSON + system prompt。クエスト契約: 固定（モデル呼び出し無し）/ 半固定（証拠語検査）/ 自由。eventId 冪等、段階の所有者はゲーム。**現状はプロセス内、英語文書あり** | Cross / Chi |
| A7 | Evidence | 68 時間 75 コミット、テストは本体の 93%、実 App Server 接続テスト、09-12 実モデル試験、動画の実モデル完走。**正直に**: Windows のみ、未解決 native クラッシュ 1 件 | Tyler / Cross |
| A8 | Roadmap | エンジンアダプター（最初の統合先: ボクセル系サンドボックスの Mod）、スキン生成、規模拡大、外部イベント API | Waldron / Oyu |

## 想定 Q&A（2 分 = 2〜3 問）

| 質問 | 30 秒回答 |
|---|---|
| Why the App Server instead of the Responses API? (Tyler) | OpenAI tunes Codex models for the Codex harness, so the harness is the environment the model expects. It gives us persistent threads, native compaction, typed dynamic tools, sandboxed approvals, and a real terminal for free. We spent our 100 hours on the world, not on rebuilding those. |
| What does an NPC-day cost? / Does it scale to 100 residents? | Not everyone thinks every turn. Tiers decide who gets individual inference every phase, only on events, or never; model and effort are per role. Rate limits back off with persisted timers. Thousands of concurrently thinking residents is out of scope today; the output package is what scales, because it is static JSON. |
| How is this different from Generative Agents / Smallville? | They showed a village can live. We ship what it leaves behind: the artifact, not the simulation. Every trait cites the memory or event that produced it, packages carry hashes, and a developer can fork the whole town to compare prompts. |
| How do I put this in my game? | The package is engine-neutral JSON plus a runtime system prompt. Quest lines follow a documented contract: fixed lines are spoken by the harness without a model call, semi-fixed lines are checked for required evidence words, free lines are generated; only your game advances a quest stage. Today the contract is in-process; the engine bridge is the next step. |
| Can I use my existing characters / control the brand? (Oyu / Pereyda) | Yes: you give the initial conditions, and the tool refuses to fabricate history that was not lived. Tone is a project setting layered by world, region, NPC, and quest, kept out of the compiled character. Every line of the compiled character is traceable, which is what a brand owner needs. |
| What is not done? | Windows only. Quest events are in-process, not yet an external API. One native crash in the terminal layer is still open and documented. |

## 素材（要確認）

- [ ] 提出済み 1 分動画のファイル（mp4）
- [ ] 100 秒版を新規収録できるか（実アプリと保存済みワールドがある PC はどれか）
- [ ] レビュー画面（根拠リンク）、3D 施設画面、端末グリッドの静止画 3 枚
- [ ] スピーチは英語か日本語か
