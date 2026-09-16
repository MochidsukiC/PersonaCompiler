# 提出フォーム草案 — Tokyo AI (TAI) | OpenAI : 100-Hour Game Builder Challenge

フォーム: https://docs.google.com/forms/d/e/1FAIpQLSdvUFtWLVKJOaZrvBN6gOHadhnzSf3SM9FjuE77QiTwiZL9Tw/viewform
締切: 2026-09-15 (火) 23:59。リンクは 9/17 まで維持。

各自由記述は **英語 200 words 以内**。```text ブロックをそのままフォームへ。**このファイルは内部メモを含むので公開リポジトリにコミットしない。**

---

## 0. 提出前チェックリスト

決定済み: 英語提出、チーム名 **HL**、タイトル **Persona Compiler**、第三者ツール欄は Codex のみ開示、3 節冒頭は「訓練に接地した版」、`IMPROVEMENT_REPORT.md` の作業者（`chika` 環境）＝システムプロンプト担当。

記述は全てコードで確認済みの事実のみ（敵対的レビュー 26 件を反映）。情景描写は「仕組み上こう起きる」の例示で、特定の実行で起きた出来事の主張ではない。

| # | 項目 | 状態 |
|---|---|---|
| 1 | 代表メール | **未記入**（`mochidsuki.hl@gmail.com` を想定） |
| 2 | メンバー全員の氏名 | **未記入**（技術担当＋システムプロンプト担当） |
| 3 | 1分デモ動画 URL（必須） | **編集中** |
| 4 | 動画の実行が Compilation まで完了しているか | 6 節は「played to completion」。Compilation 出力まで出ていれば "and compiled" を足す |
| 5 | 「Minecraft」の名称 | 規約は第三者商標の無許可使用を禁止。フォームでは「plains village」。動画の字幕・ナレーション・README でも避ける |
| 6 | Codex CLI の版 | 7 節は README の 0.154.0-alpha.6.2。この PC の PATH は 0.153.4。動画で使った版に合わせる |

リポジトリ公開前: (A) `codex/hackathon-polish` → `main` merge、(B) `IMPROVEMENT_REPORT.md` の `C:\Users\chika\...` 削除と「友人側」→「チームメンバー」、(C) `SUBMISSION.md` 削除か `improvements/` へ、(D) 「一般配布できる製品: 45〜55%」を「統合時点の評価」と明記、(E) `PROJECT_MASTER.md` 冒頭の「Socius」「Pre-Implementation」更新、(F) 鍵・`.env`・`.local` 混入なし確認済み、(G) 9/17 まで公開維持。

除外した主張: 親の日次自己監査、意思決定経路・気分/親しさ/信頼・遺伝以外の継承、skills、外部から呼べるクエスト API、上流修正としての patch。テスト件数は本日の実測（Unit 87、Backend 247、警告 0）。

---

## 1. 基本情報

| フォーム項目 | 記入値 |
|---|---|
| Team name | HL |
| Representative email | **【要記入】** |
| Team members | **【要記入】** |
| Challenge track | Track 2: Game development tools |
| Project title | Persona Compiler |
| 1-minute demo video URL | **【編集中】** |
| Working demo URL | （空欄） |
| Code repo URL | https://github.com/MochidsukiC/PersonaCompiler |

---

## 2. Project description（≤200 words）

```text
In Free Guy, a background NPC turns out to have a soul. We wanted every background character to have one, then did the math on hand-writing a persona and relationships for each of them.

We don't write character backstories. We let characters live them.

Tell Persona Compiler about your town. A parent Codex agent interviews you, drafts the specification, and, once you approve it, brings the first residents to life, then steps back. Every resident is its own long-lived Codex conversation, waking up in a 3D town with nothing but a temperament, a family, and a job. They walk to work, overhear something in the plaza, remember it their own way, fall asleep, fall in love, raise children, grow old, and die. Nobody scripts who becomes friends. The harness only keeps the world honest.

When the town's story ends, every survivor is compiled into a game-ready package: character, relationships, memories, behavior, schedule, a runtime system prompt, and a hash manifest. Click any trait in the review screen and it shows you the moment that made it true.

A Windows desktop app, built in 100 hours on Electron, React, TypeScript, and the Codex App Server.
```

> **和訳**
> 映画「Free Guy」では、背景のモブ NPC に魂が宿っていることが分かります。私たちはゲームの全てのモブに魂を持たせたいと思い、そして全員分のペルソナと関係性を手書きする工数を計算しました。
>
> 私たちはキャラクターのバックストーリーを書きません。キャラクターに生きさせます。
>
> Persona Compiler に町のことを教えてください。親 Codex エージェントがあなたにヒアリングし、仕様を起草し、承認されると最初の住民たちに命を吹き込み、一歩引きます。各住民はそれぞれ独立した長寿命の Codex Conversation で、気質と家族と仕事だけを持って 3D の町で目を覚まします。仕事に歩いて行き、広場で何かを小耳に挟み、それを自分なりに記憶し、眠り、恋に落ち、子を育て、老い、死にます。誰が友人になるかは誰も脚本しません。Harness は世界の整合性だけを守ります。
>
> 町の物語が終わると、生き残った全員がゲームで使えるパッケージにコンパイルされます: character、relationships、memories、behavior、schedule、Runtime 用システムプロンプト、hash manifest。レビュー画面で任意の設定をクリックすると、それを真にした瞬間が表示されます。
>
> Windows デスクトップアプリ。Electron、React、TypeScript、Codex App Server の上に 100 時間で構築。

---

## 3. Meaningful use of OpenAI tools（30% / ≤200 words）

```text
Codex is not our chat backend. It is the body every character lives in.

OpenAI tunes Codex models for the Codex harness, so we built the town inside it. One resident, one persistent Codex thread. Birth conditions go in without a single inference (thread/inject_items). The parent picks each resident's model, writes down why, and pins it for life. A resident cannot open a shell. All it can do is call one of 34 typed tools: walk, speak, remember, marry, build, hire, sleep. The parent is a real coding agent, writing its artifacts with Codex's own file tools under workspace-write and automatic approval review.

Then the fun part. Words spoken to a resident mid-thought arrive through turn/steer. When a resident sleeps, we consolidate its memory and let Codex compact the thread natively; morning comes only after the compaction item lands. Recall runs in a short-lived thread on the resident's own model, picking memory IDs through outputSchema. If the app crashes, the thread is the ledger: thread/read says what got through, and nothing is resent.

For you: fork a whole society with thread/fork, or open a real Codex CLI on any resident and talk.
```

> **和訳**
> Codex はチャットのバックエンドではありません。全キャラクターが生きる身体です。
>
> OpenAI は Codex モデルを Codex ハーネス向けに調整しているので、私たちはそのハーネスの中に町を建てました。住民 1 人につき 1 本の永続 Codex スレッド。出生条件は推論を 1 回も使わずに注入します（thread/inject_items）。親が各住民のモデルを選び、理由を書き残し、終生固定します。住民はシェルを開けません。できるのは 34 の型付きツールを呼ぶことだけ: 歩く、話す、覚える、結婚する、建てる、雇う、眠る。親は本物のコーディングエージェントで、workspace-write と自動承認レビューの下、Codex 自身のファイルツールで成果物を書きます。
>
> ここからが面白いところ。推論中の住民に話しかけた言葉は turn/steer で届きます。住民が眠ると、記憶を整理してから Codex にスレッドをネイティブに Compact させ、compaction item が届いて初めて朝が来ます。想起は本人のモデルで短命スレッドを立て、outputSchema で記憶 ID を選びます。アプリがクラッシュしても、スレッドが台帳です: thread/read が何が届いたかを教え、何も再送しません。
>
> あなたには: thread/fork で社会全体を分岐する、または任意の住民に本物の Codex CLI を開いて話す。

---

## 4. Originality（25% / ≤200 words）

```text
Every other tool generates a character sheet. We generate the world that writes it.

Watch what that changes. Two residents hear the same argument in the plaza; a third, behind a house wall, hears nothing. Each remembers it differently, keeps at most five memories a night, and slowly forgets: recall is a seeded, decaying probability plus a semantic search by the resident's own model. Whether they can still recall it a week later is not up to us.

Relationships are text, not numbers. A's view of B and B's view of A are separate, each citing the memories that formed it, each with revision history. One bad evening becomes a grudge only if the resident remembers it that way. Sleep is context compaction, so a personality survives its own compressed past. Newborns inherit temperament and nothing else; the rest must be lived.

The town rewrites itself: residents found companies, hire each other, build facilities, marry, and inherit.

Generative Agents showed a village could live. We ship what it leaves behind: auditable, brand-safe characters whose histories were lived, not written.
```

> **和訳**
> 他のツールはキャラクターシートを生成します。私たちはそれを書く世界を生成します。
>
> それが何を変えるか。広場で同じ口論を聞いた住民が 2 人、家の壁の向こうにいて何も聞こえなかった住民が 1 人。それぞれが違う形で記憶し、一晩に最大 5 件しか保持せず、少しずつ忘れます: 想起は seed 付きの減衰確率に、本人モデルによる意味検索を加えたものです。1 週間後にまだ思い出せるかどうかは、私たちが決めることではありません。
>
> 関係は数値ではなくテキストです。A から見た B と B から見た A は別物で、それぞれを形作った記憶を引用し、それぞれに revision 履歴があります。一度の嫌な夜が遺恨になるのは、住民がそう記憶した場合だけです。睡眠はコンテキスト Compact なので、人格は圧縮された自分の過去を生き延びます。新生児は気質だけを継承し、残りは生きて得るしかありません。
>
> 町は自分を書き換えます: 住民が会社を設立し、互いを雇い、施設を建て、結婚し、相続します。
>
> Generative Agents は村が生きられることを示しました。私たちはその村が残すものを出荷します: 監査可能でブランドセーフな、書かれたのではなく生きられた歴史を持つキャラクターです。

---

## 5. Playability / Utility（25% / ≤200 words）

```text
Ask any narrative team what hurts: fifty NPCs who each need a past, a schedule, and opinions about one another, and must still make sense after the next patch.

It runs the whole pipeline: interview, specification revisions, an approval frozen by hash, then population, simulation, compilation. You decide where the money goes: tiers choose who gets individual inference every phase, only on events, or never. You set the tone without touching the person: direction profile, expression intensity, and dialogue mode are layered by world, region, NPC, and quest, and never leak into the compiled character.

The economy is real: parent-seeded currency, product applications the parent reviews, wages, hunger, HP, SAN, inheritance. Schedule a storm for day three and the town reacts. Open a terminal and steer any resident yourself.

Quest lines follow a documented English contract, in-process today, written for an engine bridge. Fixed lines are spoken by the harness with no model call; semi-fixed lines must carry required evidence words or fall back; free lines are generated. Events are idempotent, and only your game advances a stage.

Reports export as Markdown plus JSON with source hashes, ready for the coding agent wiring the NPC in.
```

> **和訳**
> ナラティブチームに何が辛いか聞いてみてください: 50 人の NPC それぞれに過去と予定と互いへの意見が必要で、しかも次のパッチの後も辻褄が合っていなければならない。
>
> パイプライン全体を回します: ヒアリング、仕様 revision、hash で固定した承認、そして人口生成、シミュレーション、Compilation。お金の使い所はあなたが決めます: Tier が、毎フェーズ個別推論する住民、イベント時だけの住民、推論しない住民を選びます。人物に触れずに作風を決められます: 演出プロファイル、表現強度、台詞方式はワールド→地域→NPC→クエストの層で持ち、コンパイル済みキャラクターには決して漏れません。
>
> 経済は本物です: 親がシードする通貨、親が審査する製品申請、賃金、空腹、HP、SAN、相続。3 日目に嵐を予約すれば町が反応します。端末を開いて任意の住民を自分で誘導できます。
>
> クエスト台詞は文書化された英語の契約に従います。現在はプロセス内で、エンジン接続向けに書かれています。固定台詞はモデル呼び出しなしで Harness が発話し、半固定台詞は必要な証拠語を含まなければ fallback し、自由台詞は生成されます。イベントは冪等で、段階を進めるのはあなたのゲームだけです。
>
> レポートは元資料の hash 付き Markdown + JSON で書き出せ、NPC を組み込むコーディングエージェントにそのまま渡せます。

---

## 6. Execution and craft（20% / ≤200 words）

```text
It runs. Today, with real models, from the first interview question to the last compiled character. The demo video is a real-model plains village played to completion.

The hard problems are solved, not sketched. Residents think in parallel while the world applies their actions strictly in arrival order, so a slow model never freezes the town. Speech has physics: voice level, 3D distance, and house walls decide who hears what. Disk I/O lives on a worker thread and the simulation in memory, so the app never blocks; a test stalls the save worker for ten seconds and every tool keeps answering. If the app dies, it comes back by reconciling against the Codex threads themselves, reopens the last consistent state read-only, replaying nothing.

It also looks finished: a 3D facility view, a terminal per resident, a relationship graph with evidence, an event timeline, and a review screen that searches traits, diffs compilations, and verifies hashes. Saves stay atomic under Windows locks.

Seventy-five commits in 68 hours. Tests: 87 unit, 247 backend, Electron end-to-end, and a suite driving the real App Server and CLI terminals. One open native crash is documented, not hidden.
```

> **和訳**
> 動きます。今日、実モデルで、最初のヒアリングの質問から最後のコンパイル済みキャラクターまで。デモ動画は実モデルで平原の村を完走したものです。
>
> 難所は解決済みで、スケッチではありません。住民は並列に考え、世界は行動を厳密に受付順で反映するので、遅いモデルが町を止めることはありません。発話には物理があります: 声量、3D 距離、家の壁が誰に聞こえるかを決めます。ディスク I/O は Worker スレッドに、シミュレーションはメモリ上にあるので、アプリは決してブロックしません。テストでは保存 Worker を 10 秒止めても全ツールが応答し続けます。アプリが落ちても、Codex スレッド自体と突合して復帰し、最後の整合した状態を閲覧専用で開き、何も再送しません。
>
> 見た目も仕上がっています: 3D 施設画面、住民ごとの端末、根拠付きの関係図、出来事タイムライン、設定を検索し Compilation を差分比較し hash を照合するレビュー画面。保存は Windows のロック下でも原子的です。
>
> 68 時間で 75 コミット。テスト: Unit 87、Backend 247、Electron E2E、実 App Server と CLI 端末を動かすスイート。未解決の native クラッシュ 1 件は隠さず文書化しています。

---

## 7. Pre-existing code, open-source components, datasets, third-party tools and licenses（≤200 words）

```text
All code was written during the challenge; the first commit (2026-09-12 18:45 JST) holds the day-one design notes, parent prompt, and initial harness. The dialogue-direction and quest module was built by a team member in a separate working copy and merged on 2026-09-15. No pre-existing project code, datasets, or third-party characters, assets, or music are used. The demo worlds (Tomotsugi and the plains village) and their residents are original.

OpenAI: Codex CLI 0.154.0-alpha.6.2 and Codex App Server (Apache-2.0, used under OpenAI terms); models gpt-6-astra and gpt-5.6-sol/luna/terra via ChatGPT login or API key. Codex was also our coding assistant; the team reviewed and tested all code.

Runtime: Electron 44.3.0, React and React DOM 19.3.0, three 0.186.0, @xterm/xterm, @xterm/headless, addon-fit, addon-serialize, @xyflow/react 12.11.6, chokidar 5.0.0, node-pty 1.2.0-beta.15, ws 8.21.3, zod 4.6.2, patch-package 8.0.1 (all MIT); lucide-react 1.45.0 (ISC).

Development: TypeScript 6.0.3 and @playwright/test 1.63.0 (Apache-2.0); electron-vite 5.0.0, Vite 7.3.6, vitest 5.0.0, ESLint 10.10.0 with @eslint/js 10.0.1 and typescript-eslint 8.70.0, @electron/rebuild 4.2.0, @vitejs/plugin-react 5.2.0, and DefinitelyTyped @types packages (all MIT).

Our patches to node-pty and chokidar (/patches) are original, under upstream's MIT terms.
```

> **和訳**
> 全コードはチャレンジ期間中に作成。初回コミット（2026-09-12 18:45 JST）に初日の設計ノート、親プロンプト、初期 Harness が含まれます。演出・クエストモジュールはチームメンバーが別の作業コピーで作り、2026-09-15 に統合しました。既存のプロジェクトコード、データセット、第三者のキャラクター・アセット・音楽は使用していません。デモ世界（灯継町と平原の村）とその住民はオリジナルです。
>
> OpenAI: Codex CLI 0.154.0-alpha.6.2 と Codex App Server（Apache-2.0、OpenAI の規約下で使用）。モデルは gpt-6-astra と gpt-5.6-sol/luna/terra を ChatGPT ログインまたは API キーで使用。Codex はコーディング支援にも使用し、全コードはチームがレビュー・テストしました。
>
> 実行時依存・開発ツール: 上記英語と同一（`node_modules` の package.json でライセンス確認済み）。
>
> node-pty と chokidar へのパッチ（/patches）は当チームの修正で、上流と同じ MIT で提供。
