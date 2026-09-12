# Socius / Society Compiler — Project Master

> **Status:** Active Design / Pre-Implementation  
> **Hackathon:** TAI Hackathon — Track 2  
> **Reference Environment:** Minecraft Fabric 26.2  
> **Document Role:** Project-wide Single Source of Truth  
> **Last Updated:** 2026-09-12

---

# 0. このファイルの役割

本ファイルは、本プロジェクトの設計・実装・研究を進めるうえでの**最上位マスタードキュメント**である。

設計判断、実装方針、Track 2としての位置付け、エージェント構成、シミュレーション規則、MVPスコープは原則として本ファイルを正本とする。

個別研究成果は別ファイルで管理し、本ファイルから参照する。

特に以下は**別研究班の担当**とする。

- NPC初期システムプロンプトの研究
- 人格形成に適した初期プロンプト構造
- コンテキストCompact後にも人格を保持しやすいプロンプト設計
- Character Compilerによる最終Runtime Prompt生成方式

本プロジェクト本体は、これらの研究成果を受け取れる**インターフェース**のみ定義する。

---

# 0A. 現行段階：住宅街と3次元施設内での自律生活

2026-09-12の追加仕様として、新規ワールドは以下を採用する。記憶と関係の観測は0Cを適用し、出生・加齢・死亡・Compilationは次段階とする。

- 初期化は `turn=0 / ready`。開始操作後は朝・昼・夕・夜の4ターンで1日とし、ターン上限で終了する。既存形式のワールドは閲覧を維持する。
- 各施設の内部は承認済みの `n×m×h` 整数格子。座標は各軸0以上サイズ未満。意味付きの点・直方体領域は重複可能で、用途による移動制限・重力・経路探索は扱わない。同じ座標へ複数NPCが滞在できる。
- 住宅街を必須施設とし、1つの施設Conversationで管理する。人口生成後に住宅街モデルへ世帯一覧を渡し、`householdId`ごとに1軒の家を作る。単身世帯にも家を作り、別居親族は別世帯にできる。家同士は非重複で施設内に収め、承認済みサイズは自動変更しない。
- `getSituation`、`setInitialPosition`、`moveWithinFacility`、`moveToFacility`、`sendMessage`、`useFacility`、`endTurn`、`sleep`をNPCに提供する。施設には初期化・利用回答のToolを提供する。
- 施設内移動は無制限。施設間移動は1ターンに1度だけ予約し、次ターン境界で実行する。会話へ復帰しても予約を上書きできない。滞在者は座標を保持し、入場者全員の位置が揃ってから生活を開始する。
- 発話はlowが距離1、mediumが距離5、highが同施設全体。距離は上下方向を含む直線距離。家内の声は同じ家だけに届き、屋外の声は家内へ届く。発話時に受信対象を確定し、睡眠中へは配信・再配信しない。状況取得は同じ住宅街の全NPCの公開座標を返す。
- 生活推論は並列、世界への反映は受付順。終了したNPCも受信した発話から再開できる。会話や施設内移動の回数制限、経過時間による強制終了は設けない。
- `sleep`は1ターンの睡眠。毎回同じConversationでNative Compactし、完了確認後に次ターンへ進む。記憶対応の新規ワールドでは、その前に0Cの整理を行う。
- ユーザーの実CLI入力は同じConversationへの通常の誘導メッセージ。推論中はsteer、睡眠中は起床後へ保持する。先天的モデルは保持し、effortは推論開始時の共通処理で解決する。
- 再起動時は停止状態から復元する。Tool結果・配信・移動予約・Compactを保存し、結果不明の要求は照合できなければ停止する。施設内3D表示はThree.jsとOrbitControlsを使う。

---

# 0B. 新規ワールドのIn-Memory保存方式

新規作成ワールドは保存形式version 2を使用する。生活Tool・世界状態・画面更新はメモリー上で確定し、保存完了を待たない。変更がある場合のみ30秒ごと、一時停止・初期化完了・ターン上限・正常終了時にも保存する。保存失敗は警告し、生活と未保存データを保持する。

保存Workerは連番付き変更から現在状態を組み立て、完了履歴を別セグメントへ保存する。checkpointの2スロットと履歴を先に書き、hashと確定範囲を含むmanifestを最後に置換する。保存ACKまでMainが未保存変更を保持する。通常の画面配信は最大10回/秒、出来事は直近200件とし、全履歴は別保存する。

外部操作開始前にdirtyの確定保存を一度待つ。正常終了では入力・推論開始を止め、通知・要求・CLI/App Serverの停止を確認して最終保存し、dirtyを解除する。保存失敗時は終了を取り消せる。dirtyが残る実行は最後の確定保存を閲覧専用で開き、推論・配信・CLI入力を再送しない。旧形式とDemoEngineは従来の保存・復旧経路を維持し、自動移行しない。

実装と検証手順は [PERSISTENCE.md](PERSISTENCE.md) に記載する。Codex自身のConversation・SQLite・ログ、親の資料・成果物ファイルはこの最適化の対象外。

---

# 0C. 主観的な記憶と関係の観測

新規ワールドだけに`memoryVersion: 1`を保存し、NPCへ`remember`・`recall`・`remindMe`・`consolidateMemory`を追加する。心の声・独り言は引き続きユーザー向けの通常出力であり、自動的に記憶候補へ変換しない。

根拠は本人の初期情報・行動・受信済み情報に限定する。意味照合は本人と同じ先天的モデル・実効effortの一時Conversationで行い、保存済みの記憶IDから選ぶ。再現可能な確率抽選で0〜3件を返し、同一turnの同じ手掛かりは結果を再利用する。

睡眠は現在の推論終了→本人の記憶整理→一括確定→推論終了→Native Compact→次turnの起床とする。候補100件、保持は予定込み100件、睡眠1回の新規記憶は0〜5件。関係は本人が文章で記述し、方向別に記憶ID・revisionと更新turnを保持する。独立した観測Agentを追加せず、関係図や他NPCの記憶をNPCへ返さない。

現在の記憶はNPC別にIn-Memoryで管理し、差分を既存Workerへ送る。旧revision・忘却・根拠は履歴セグメントに保持する。画面は本文を詳細取得し、過去の関係の根拠も閲覧できる。旧ワールドへは移行しない。詳細と検証手順は [MEMORY.md](MEMORY.md) を参照する。

---

# 1. Project Thesis

本プロジェクトはAI NPCそのものを作るTrack 1作品ではない。

本プロジェクトは、

> **ゲーム開発者が、大量のNPCの人格・人生・人間関係・記憶・行動設定を制作する工程そのものを自動化するTrack 2向けAI開発ツール**

である。

中心コンセプト：

> **We don't write character backstories. We let characters live them.**

補助表現：

> **We don't build AI NPCs. We build the system that builds AI NPCs.**

仮称：

> **Socius — A Society Compiler for Living Game Worlds**

---

# 2. Track 2としての絶対条件

成果物の主語は常に、

> **NPC Production Pipeline / Society Compiler**

である。

Minecraftは最終ゲーム作品ではなく、

> **Reference Game Environment / Integration Target**

として扱う。

Track 1的な要素は大量に含むが、それらはすべて以下のいずれかに位置付ける。

- Production Pipeline内部の生成過程
- NPC制作の自動化
- AIを用いたContent Production
- Simulation / Testing
- MinecraftへのIntegration
- 生成成果物のVerification

「AI NPCと会話できます」を主訴にしない。

最終価値：

```text
Traditional NPC Production
──────────────────────────
Character Design
Writing
Backstory
Relationship Design
Behavior Design
Scheduling
Asset Production
Integration
Testing
Iteration

        ↓

Socius

        ↓

Automated Society Simulation
        ↓
Compiled Production-Ready NPCs
```

---

# 3. 最終ゴール

開発者が、

```text
この町に自然に暮らしてきたNPC群を作成して
```

程度の高レベル要求を与える。

Sociusは、

1. 世界設定を解析
2. 初期人口を生成
3. NPCごとに独立した長寿命AI Sessionを生成
4. 仮想社会を高速に時間進行
5. NPC自身に生活させる
6. 家族・友人・恋愛・対立・職歴・記憶などを創発
7. 世代交代を進行
8. シミュレーション終了
9. 各NPCの人生を圧縮・コンパイル
10. Minecraft向けNPCパッケージを生成

する。

最終出力例：

```text
NPC Package
├── character.json
├── relationships.json
├── memories.json
├── behavior.json
├── schedule.json
├── system_prompt.md
└── skin.png
```

---

# 4. 最重要設計思想

## 4.1 「設定を書く」のではなく「人生を生きさせる」

NPCの友人関係、恋愛、ライバル、職場関係などを親モデルが直接書かない。

親モデルが与えるのは**初期条件**。

その後は、

```text
Time
+
Geography
+
Opportunity
+
Independent Cognition
+
Interaction
+
Memory

→ Society
```

によって社会関係を形成する。

重要：

> **関係性を生成するのではなく、関係性が形成される世界を生成する。**

---

## 4.2 1 NPC = 1 Long-Lived Conversation

本プロジェクトでは、

> **1 NPC = 1 persistent Codex conversation**

として扱う。

NPCの人格・経験・記憶は基本的にそのConversation内に蓄積される。

以前検討した、

```text
Stateless GPT Worker
+
External Character State
```

を人格の本体にはしない。

Harnessは世界状態を管理するが、NPC本人の主観的な人生はConversationに保持する。

---

# 5. Context Management

## 5.1 Context Window

NPC Sessionは原則として、

> **256k context window**

を使用する。

---

## 5.2 Compact Conversation

長期人生を同一Conversationで維持するため、CodexのCompact Conversation機構を利用する。

Compactは単なる技術処理ではなく、

> **NPCの睡眠**

というシミュレーション上の行動と結びつける。

---

## 5.3 Sleep = Memory Consolidation

NPCは適切なタイミングで自発的に `sleep()` Toolを使用しなければならない。

概念：

```text
NPC decides to sleep
       │
       ▼
sleep()
       │
       ├── current day closes
       ├── sleep state begins
       └── conversation compact
```

人間と同様に、

- 夜になった
- 疲れた
- 翌日に仕事や学校がある

などを考慮して本人が睡眠を選択する。

Harnessが毎日強制的にsleepさせる設計にはしない。

その結果、

- 夜更かし
- 睡眠不足
- 会話が長引いて寝ない
- 生活リズムの乱れ

なども発生可能。

---

# 6. Simulation Time Model

時間は**ターン制**。

1日を以下の4ターンに分割する。

```text
Morning
↓
Noon
↓
Evening
↓
Night
↓
Next Day
```

日本語表現：

```text
朝
昼
夕
夜
```

1ターン内でNPCは、

- 移動
- 会話
- 施設利用
- 状況確認
- 睡眠
- ターン終了

などを自律的に判断する。

---

# 7. Parallel Inference / Ordered Tool Application

NPCを単純な逐次for-loopで処理しない。

入場位置が全員分揃ってからNPCの推論を並列に開始する。ToolはBackendの受付順に検証し、その都度世界状態へ反映する。世界状態の更新だけを直列化し、モデル応答の待機で他のNPCのTool処理を止めない。

基本フロー：

```text
TURN START
    │
    ▼
All entry positions confirmed
    │
    ├─────────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼
  NPC A     NPC B     NPC C      ...
    │         │         │
    ▼         ▼         ▼
 Tool A    Tool B    Tool C
    │         │         │
    └─────────┴─────────┘
              │
              ▼
   Serialize state changes in arrival order
              │
              ▼
   Deliver speech / facility responses asynchronously
              │
              ▼
   Continue inference while any activity remains
              │
              ▼
   Wait for activity, deliveries, inference and Compact
              │
              ▼
          TURN END
```

目的：

- 遅いモデルが他のNPCのTool処理を止めない
- 受信順と配信対象を保存し、確定済み行動を巻き戻さない
- 全員が終了・睡眠になり、未完了処理が解消された境界で次ターンへ進む

---

# 8. High-Level Architecture

```text
                         Developer
                            │
                            ▼
                    Parent / Director
                       Codex Session
                            │
              ┌─────────────┴─────────────┐
              │                           │
        Initial Population          Birth Generation
              │                           │
              └─────────────┬─────────────┘
                            ▼
                    Simulation Harness
       ┌──────────────────────────────────────┐
       │ Turn Engine                          │
       │ World State                          │
       │ Geography                            │
       │ Population Registry                  │
       │ Position Registry                    │
       │ Facility Registry                    │
       │ Lifecycle Manager                    │
       │ Message Router                       │
       │ Tool Dispatcher                      │
       │ Barrier / Intent Resolver            │
       └───────────────┬──────────────────────┘
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
      NPC Session  NPC Session   NPC Session
          A            B             C
       256k ctx      256k ctx      256k ctx
          │            │             │
          └────────────┼─────────────┘
                       │
               social interaction
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
       Facility     Facility      Facility
        Agent        Agent         Agent
```

---

# 9. Parent / Director Session

親セッションは社会全体の上位管理者。

## Responsibilities

- 世界条件の理解
- 初期人口設計
- 初期NPC生成
- 初期家族構成
- 初期年齢
- 初期位置
- 初期気質
- 成人NPCの初期職業
- NPC Session spawn
- 新生児生成
- 必要に応じたSimulation supervision
- 最終Character Compilation
- Minecraft出力統合

---


# 10A. Initial Specification Interview

Simulation開始前に、Parent / Director Sessionは必ず**仕様ヒアリングフェーズ**を実行する。

これは単なる必須項目チェックではない。

Claude DesignのQuestionフローに近い思想で、

> **確認 / 摺り合わせ / 不足仕様の発見 / 改善提案**

を目的として、ユーザーへ必ず複数のQUESTIONを提示する。

必要情報が最初の入力ですべて揃っている場合でも、QUESTIONフェーズを省略してはならない。

Parent Sessionは、ユーザーが仕様を明示的に承認するまでPopulation Generation / Simulationを開始しない。

---

# 10B. Required Initial Inputs

初期仕様として最低限、以下を要求する。

## Town / World

```text
Town Setting
Facility List
Facility Descriptions
```

### Town Setting

町そのものの設定。

例：

```text
現代日本の地方都市。
人口減少が進んでいる。
駅前には商店街があり、
郊外には住宅地と学校がある。
若年層は都市部へ流出傾向。
```

自由記述を基本とする。

Parent Sessionはこの設定をそのまま受け取るだけでなく、QUESTIONを用いて、

- 時代
- 地域 / 文化
- 町の規模
- 産業
- 経済状況
- 教育環境
- 生活様式
- 交通
- 社会的特徴
- 特殊ルール

などの曖昧点を確認・提案してよい。

---

## Facility List

町に存在する施設一覧。

例：

```text
- 小学校
- 中学校
- 高校
- 駅
- スーパー
- パン屋
- 病院
- 役所
- 公園
- 会社
```

---

## Facility Description

各施設について、

```text
役割
規模
利用者
職員
利用条件
営業時間 / 活動時間
社会上の意味
他施設との関係
```

などを定義する。

すべてをユーザーが最初から記述する必要はない。

不足している場合はParent SessionがQUESTIONを使って確認し、具体案を提示する。

例：

```text
Facility: 駅前パン屋

Role:
地域住民向けの小規模パン屋。

Staff:
店主1名 + アルバイト2〜3名程度。

Social Role:
学生と近隣住民が日常的に利用し、
NPC同士の接触機会が発生しやすい。

Open:
Morning / Noon / Evening
```

---

# 10C. Population Requirements

初期人口について最低限以下を要求する。

```text
NPC Count
Age Distribution
Sex Ratio
```

## NPC Count

Simulation開始時のGeneration 0人数。

例：

```text
50 NPC
100 NPC
```

---

## Age Distribution

初期NPCの年齢分布。

入力形式は固定しない。

例：

```text
0-12: 15%
13-18: 10%
19-39: 30%
40-64: 30%
65+: 15%
```

または、

```text
現代日本の地方都市に近い人口構成
```

のような自然言語指定でもよい。

曖昧な場合はParent Sessionが具体的な分布案を提案し、ユーザーへ確認する。

---

## Sex Ratio

初期人口の性別比率。

例：

```text
Male: 49%
Female: 51%
```

またはユーザー独自の比率指定を許可する。

Parent Sessionは指定人口と比率から最終人数を整数化し、端数処理を明示する。

---

# 10D. Simulation Length

ユーザーは、

```text
Turn Count
```

を指定する。

1日：

```text
Morning
Noon
Evening
Night
```

の4ターン。

したがって、

```text
4 turns = 1 simulated day
```

を基本単位とする。

ただしGeneration 0 extinctionを終了条件として使用するSimulationでは、

```text
Turn Count = safety / maximum turn limit
```

として扱える。

Parent Sessionは、

- 指定ターンで必ず停止するのか
- Generation 0 extinctionまで実行するのか
- extinction優先 + 最大ターン上限なのか

をQUESTIONで必ず確認する。

---

# 10E. Mandatory QUESTION Phase

Parent SessionはSimulation開始前に、必ず複数のQUESTIONを提示する。

最低要件：

```text
QUESTION count >= 3
```

推奨：

```text
3–8 questions per round
```

質問数は仕様の曖昧さに応じて調整する。

すべての質問を一問ずつ往復する必要はなく、関連するQUESTIONをまとめて提示してよい。

---

# 10F. QUESTION Goals

QUESTIONは以下の4目的のいずれかを持つ。

```text
CONFIRM
ALIGN
DISCOVER
PROPOSE
```

## CONFIRM

ユーザーの指定を確認する。

例：

```text
QUESTION:
町は現代日本を想定していますか？
```

---

## ALIGN

解釈のズレが起きそうな点を摺り合わせる。

例：

```text
QUESTION:
「地方都市」は人口数万人規模を想定していますか、
それとも町村規模でしょうか？
```

---

## DISCOVER

シミュレーションに必要だが未指定の情報を発見する。

例：

```text
QUESTION:
高校卒業後の主な進路は町内就職・進学・町外流出の
どれを中心にしますか？
```

---

## PROPOSE

Parent Sessionからより良い仕様案を提示する。

例：

```text
QUESTION:
友人関係が形成されやすくなるため、
学校・職場以外に「公園」または「商店街」を
交流拠点として追加することを提案します。
追加しますか？
```

---

# 10G. QUESTION Presentation

各QUESTIONでは可能な限り、

```text
Question
Reason
Recommended option
Alternatives
```

を提示する。

例：

```text
QUESTION 3 — 高校卒業後の流出

高校卒業後も全員が町に残る設定でしょうか？

Reason:
世代交代後の人口構成と職場人口に大きく影響します。

Recommended:
70% 町外進学・就職
30% 町内残留

Options:
A. 推奨値を使用
B. 町外流出を少なくする
C. 町外流出を多くする
D. 自由指定
```

質問は単なる入力フォームではなく、

> **Parent Sessionとユーザーによる共同設計**

として扱う。

---

# 10H. Specification Draft

QUESTIONへの回答を受けたParent Sessionは、Simulation開始前に必ず仕様案をまとめる。

例：

```text
SPECIFICATION DRAFT

Town
-----
Setting:
...

Facilities:
...

Population
----------
NPC Count: 100

Age Distribution:
...

Sex Ratio:
...

Simulation
----------
Turns: 400
End Condition:
Generation 0 extinction OR 400 turns

Open Questions:
None
```

---

# 10I. SPEC LOCK

Simulation開始にはユーザーの明示的な承認が必要。

状態：

```text
SPEC_DRAFT
    ↓
QUESTION / REVISION
    ↓
USER APPROVAL
    ↓
SPEC_LOCKED
    ↓
INITIAL POPULATION GENERATION
```

Parent Sessionは `SPEC_LOCKED` より前に、

- NPC Sessionの大量生成
- Facility Agentの本生成
- Society Simulation開始

を行ってはならない。

軽量な仕様検証・候補生成・提案は許可する。

---

# 10J. Canonical Initial Input Schema

内部的には最終仕様を概ね以下の形式へ正規化する。

```yaml
town:
  setting: |
    ...

  facilities:
    - id: school_01
      type: school
      name: ...
      description: |
        ...

population:
  initial_npc_count: 100

  age_distribution:
    - range: 0-12
      ratio: 0.15
    - range: 13-18
      ratio: 0.10
    - range: 19-39
      ratio: 0.30
    - range: 40-64
      ratio: 0.30
    - range: 65+
      ratio: 0.15

  sex_ratio:
    male: 0.49
    female: 0.51

simulation:
  requested_turns: 400
  turns_per_day: 4

  end_condition:
    mode: generation_zero_extinction_with_turn_limit
```

このSchemaは実装時に変更可能。

重要なのは、最初のユーザー入力を直接Simulationへ流さず、

```text
User Intent
    ↓
QUESTION / Design Interview
    ↓
Specification Draft
    ↓
SPEC LOCK
    ↓
Normalized Specification
    ↓
Simulation
```

の順序を必ず守ること。

---

# 10. 初期人口生成

親セッションが最初にNPCを初期化する。

最低限必要な初期情報：

```text
Identity
Age
Initial location
Family relationship
Initial temperament / innate traits
Adult occupation
Household
Basic physical attributes
```

---

# 11. Initial Relationships vs Emergent Relationships

親セッションが最初から設定してよい関係：

```text
Parent / Child
Sibling
Spouse
Household
Family structure
```

シミュレーションによって形成させる関係：

```text
Friend
Best friend
Romantic relationship
Ex-partner
Rival
Enemy
Workplace friendship
Respect
Distrust
Conflict
Mentorship
```

原則として、非家族の社会関係を親が完成状態で直接書かない。

---

# 12. Birth / Generation System

出生イベントが発生した場合、子供の生成のみ親セッションへ差し戻す。

概念：

```text
NPC Society
    │
Birth Event
    │
    ▼
Parent Session
    │
Generate newborn initialization
    │
    ▼
Create new NPC Session
    │
    ▼
Join Simulation
```

親セッションへ渡す候補情報：

```text
Mother
Father
Household
Family circumstances
Parents' basic traits
Current year
Current world conditions
Current location
```

親セッションが生成：

```text
Name
Basic identity
Initial temperament
Basic physical attributes
Other immutable/initial conditions
```

その後の人格は本人の人生で形成する。

---

# 13. Population Strategy

採用方式：

> **開始時に子供と成人を全員固定で出すのではなく、時間進行とともに出生を発生させる。**

開始時点に初期世代を生成する。

Simulation中：

```text
Birth
Aging
Work
Relationships
Family formation
Death
```

を進行する。

---

# 14. Simulation End Condition

終了条件：

> **Generation 0（初期生成されたNPC）が全員死亡し、生存人口がSimulation内で出生した世代のみになった時点。**

概念：

```text
Generation 0
████████████████

time →

██████████
█████
██
0 survivors

STOP
```

この時点では生存NPC全員が、

> **simulation-native characters**

となる。

---

# 15. NPC Session

各NPCは独立したAI Session。

NPCはHarnessに操作される人形ではない。

各ターン、

- 現在位置
- 周囲
- 同一場所の人物
- 利用可能な施設
- 現在時刻 / ターン
- 必要な世界情報

を受け取り、自分自身で行動を決定する。

---

# 16. Turn Start Context

毎ターンHarnessからNPCへ渡す情報の基本形：

```text
Current date / age / time phase
Current location
What exists at this location
Who is currently at this location
Available exits / destinations
Available interaction tools
Available facility interactions
Necessary local world state
```

Harnessは、

```text
学校に行け
働け
この人物と話せ
```

などの直接命令を原則として行わない。

本人が自分のConversation上の人格・記憶・過去・予定を考慮して判断する。

---

# 17. Tool Set — Hackathon MVP

最小構成候補：

```text
move(...)
message(...)
read_status(...)
interact_facility(...)
sleep(...)
end_turn(...)
```

正式Schemaは別設計ファイルで定義する。

---

# 18. move Tool

目的：

> NPCの現在地を変更する。

Harnessが、

- 移動可能性
- 行先
- 世界設定
- 必要に応じた移動時間

を検証する。

---

# 19. message Tool

目的：

> 他NPCへの会話・発話。

Hackathon MVPでは、

> **同一物理空間に存在するNPC同士の通信**

のみ対象とする。

電話、SNS、遠隔通信は将来実装。

Remote Communication:

```text
OUT OF MVP SCOPE
```

---

# 20. read_status Tool

NPCが現在の社会状況を確認する。

例：

- 誰が誰と話しているか
- 同じ場所の状況
- 現在利用中の設備
- 必要なローカル状態

ただし他NPCの内部思考・非公開Conversationは取得不可。

---

# 21. interact_facility Tool

施設とのInteractionに使用。

施設は単なる静的オブジェクトではなく、

> **Facility Agent**

として実装する。

NPC：

```text
interact_facility(target, message/action)
```

Facility Agentが状況に応じて応答する。

---

# 22. Facility Agent

Yes — FacilityもAI Agentとして扱う。

候補：

```text
School
Workplace
Shop
Hospital
Government Office
Household Service
```

Hackathon MVPでは種類を絞る。

例：

## School Agent

- Enrollment
- Attendance
- Class-related response
- Graduation

## Workplace Agent

- Hiring
- Employment
- Attendance
- Job changes

## Shop Agent

- Purchase
- Employment
- Service interaction

---

# 23. Facility Agentの責務

施設Agentは、

```text
施設内部状態
ルール
利用者
職員
サービス
イベント
```

などを保持する。

NPC同士の人格Sessionとは分離する。

---

# 24. Geography

地理的な同席は社会形成の重要条件。

Harnessが管理：

```text
Locations
Facilities
NPC positions
Possible movement
Co-presence
```

友人関係などは物理的接触機会を基盤とする。

MVPでは詳細な秒単位Navigationより、

```text
Location / Facility / Area
```

単位で十分。

Minecraft実装時に必要に応じて座標へ変換する。

---

# 25. Social Formation

社会関係はConversationの人生経験から形成する。

初期構想にあった、

```text
trust = 0.72
affection = 0.81
```

のような固定Social Scoreを人格の正本にはしない。

基本思想：

```text
Shared experiences
+
Repeated interaction
+
Memory
+
Individual interpretation
=
Relationship
```

必要であればHarness側に補助的なindex値を持たせてもよいが、

> 人間関係の正本はNPC自身の人生・記憶

とする。

---

# 26. Shared Event / Subjective Interpretation

同じ出来事でも各NPCの解釈は一致しなくてよい。

例：

```text
Objective Event:
A helped B
```

A：

```text
大したことではなかった
```

B：

```text
助けてもらえて嬉しかった
```

この差は各Conversation内に保持される。

---

# 27. Memory

Memoryの主要な本体はNPC Conversation。

外部Memory Storeを人格の正本にはしない。

ただし以下目的のため、Simulation Harness側にイベントログ等を保持してよい。

```text
Debug
Replay
Visualization
QA
Final Compilation Support
```

---


# 27A. Memory System — Design Principle

本プロジェクトではMemory Toolを実装する。

ただし、

> **Memory Toolを万能な過去検索機構にしてはならない。**

NPCが過去の全出来事を完全・即時・正確に検索できる場合、人間らしい忘却・曖昧さ・主観性が失われる。

したがって、以下を基本原則とする。

```text
Experienced
≠
Remembered
≠
Recallable Now
```

つまり、

```text
経験したこと
↓
記憶として残ったこと
↓
今この瞬間に思い出せること
```

を別概念として扱う。

---

# 27B. Memory Source of Truth

人格・人生記憶の主要な正本は、引き続き

> **NPC自身のPersistent Conversation**

とする。

Memory ToolはConversationを置き換えるものではない。

用途：

```text
Long-term memory support
Cue-based recall
Sleep-time consolidation
Prospective memory
Compaction support
Character compilation support
```

外部Memory Storeのみから人格を再構築する設計にはしない。

---

# 27C. Memory Layers

NPCの記憶を概念的に以下へ分ける。

```text
Working Memory
Episodic Memory
Semantic / Social Memory
Prospective Memory
```

---

## Working Memory

現在のConversation Context。

例：

```text
今何をしているか
今日何が起きたか
直前に誰と話したか
現在の話題
```

原則として専用Toolへ保存しない。

Persistent Conversationそのものを使用する。

---

## Episodic Memory

特定の出来事についての主観的記憶。

例：

```yaml
event:
  people:
    - yuto

  place: school_rooftop

  summary:
    悠斗から進路について相談された

  subjective_interpretation:
    普段は強気なのに、珍しく不安そうだった

  emotions:
    concern: 0.7
    affection: 0.4

  salience: 0.68
```

重要：

> **客観世界ログをそのままNPCの記憶として保存しない。**

同じ出来事でもNPCごとに、

- 注目した部分
- 感情
- 解釈
- 重要度

が異なってよい。

---

## Semantic / Social Memory

複数の経験から形成された、世界・人物・自己についての一般化された理解。

例：

```text
悠斗は強がることが多い
母は朝が早い
あのパン屋は夕方に混む
私は人前で失敗するのが怖い
```

これは、

> 「何月何日に起きた出来事」

ではなく、

> 「私はこう理解している」

という知識・信念。

Repeated Episodic Memoriesから形成可能。

---

## Prospective Memory

未来に実行したいことを覚えておく記憶。

例：

```text
明日悠斗に本を返す
週末に母と買い物へ行く
次に先生に会ったら質問する
```

Prospective Memoryも完全ではない。

適切なCueが存在しても、忘れる可能性を残す。

---

# 27D. Memory Tool Philosophy

Memory ToolはDatabase APIのように扱わない。

禁止思想：

```text
memory_search("Yuto", limit=1000)
```

によって人生全履歴を完全取得すること。

NPCに提供するのは、人間の認知に近い抽象Toolとする。

Hackathon MVP候補：

```text
remember(...)
recall(...)
remind_me(...)
```

---

# 27E. remember Tool

目的：

> NPC自身が「これは覚えておきたい」と判断した経験を長期記憶候補として登録する。

概念Schema：

```text
remember(
  summary,
  why_it_matters,
  people,
  emotion
)
```

重要：

`remember()` の実行 = 永続保存保証

ではない。

Harness / Memory System側で、

- 重要度
- 重複
- Memory Budget
- Sleep時のConsolidation

を考慮し、長期保存・圧縮・破棄を決める。

---

# 27F. recall Tool

目的：

> 現在の状況・人物・場所・話題をCueとして、過去の記憶を思い出す。

概念Schema：

```text
recall(
  cue
)
```

返却は、

```text
0〜少数件のmemory
```

とする。

完全な検索結果一覧を返さない。

例：

```text
Cue:
悠斗 / 学校の屋上

Result:
数年前、この場所で悠斗と将来について
話したことをぼんやり覚えている。

Confidence:
medium
```

Memory Storeに存在するからといって必ず返却しない。

---

# 27G. remind_me Tool

目的：

> Prospective Memoryを形成する。

概念Schema：

```text
remind_me(
  intent,
  subject,
  trigger
)
```

例：

```text
intent:
返す

subject:
悠斗の本

trigger:
明日学校で悠斗に会った時
```

Triggerが成立した場合でも、必ず100%想起させない。

---

# 27H. Cue-Based Recall

RecallはCue依存。

Recallabilityは概念的に、

```text
salience
× recency
× rehearsal
× cue_similarity
× emotional_strength
```

などを考慮する。

正確な数式は実装・実験で決定する。

例：

```text
昨日の重大な喧嘩
→ 高確率で想起

12年前に一度だけ会った人
→ 低確率

毎日会っていた幼馴染
→ 長期間経過後も比較的想起しやすい
```

---

# 27I. Forgetting

忘却はMemory Systemの主要機能。

Memoryは、

```text
保存 / 削除
```

の二値だけでは扱わない。

時間経過で、

- 詳細の消失
- 要約
- 抽象化
- 確信度低下

が発生してよい。

例：

```text
Day 1:
悠斗が赤い傘を持って駅前で30分待っていてくれた。

↓ 1 year

悠斗が雨の日に駅で待っていてくれた。

↓ 10 years

昔、雨の日に悠斗に助けてもらった気がする。
```

重要情報の「意味」が残り、細部が失われる方向を基本とする。

---

# 27J. Memory Consolidation During Sleep

`sleep()` は、

> **Conversation Compact + Memory Consolidation**

を行う重要なLifecycle Event。

概念：

```text
Today's Experience
       │
       ▼
     sleep()
       │
       ├── important experiences selected
       ├── episodic memories consolidated
       ├── repeated experiences generalized
       ├── minor details decay
       ├── prospective memories retained / forgotten
       └── conversation compact
```

今日起きたことをすべて長期保存してはならない。

---

# 27K. Long-Term Memory Budget

Memoryの無限増加を防ぎ、人間らしい選択的記憶を作るため、

> **Sleep単位のLong-Term Memory Budget**

を設ける。

初期案：

```text
3–7 meaningful memories / sleep cycle
```

固定値ではなく、研究・実験で調整可能。

その日に多数のイベントが発生しても、

- 感情的に強い
- 人生上重要
- 自己概念に関係
- 人間関係に影響
- 将来行動に重要

などの経験を優先する。

---

# 27L. Rehearsal and Reinforcement

何度も思い出す・繰り返し経験するMemoryは強化される。

例：

```text
4/10 悠斗と昼食
4/11 悠斗と昼食
4/12 悠斗と昼食
4/13 悠斗と昼食
```

をすべて永久保存する必要はない。

Consolidationにより、

```text
悠斗とはよく昼食を一緒に食べる。
```

というSemantic / Social Memoryへ圧縮可能。

概念：

```text
Repeated Episodes
       ↓
Pattern Recognition
       ↓
Semantic Memory
```

---

# 27M. Social Memory

人間関係を、

```text
trust = 0.81
```

のような単一数値だけで表現しない。

Social Memoryは文章・意味表現を中心とする。

例：

```yaml
person: yuto

belief:
  頼めば助けてくれると思っている

history:
  幼い頃から何度も困った時に助けてもらった

tension:
  ただし進路については考え方が合わない

recent:
  昨日喧嘩したので今は少し話しづらい
```

時間経過とConsolidationによって、

```text
悠斗は信頼できるが、ときどき価値観がぶつかる。
```

のような高次表現へ圧縮してよい。

補助数値を内部Indexとして持つことは許可するが、

> **Relationshipの人格的な正本はNPC自身の経験・記憶・解釈**

とする。

---

# 27N. False Memory Boundary

Hackathon MVPでは、

> **完全に存在しない出来事をMemory Systemが新規捏造することは禁止する。**

許可するもの：

- 詳細を忘れる
- 時刻を曖昧に覚える
- 場所を曖昧に覚える
- 会話内容を要約する
- 相手の意図を誤解する
- 感情によって意味付けが変化する
- 確信度が低下する

禁止：

```text
実際には発生していない重大イベントを、
Memory Systemが過去の事実として新規作成する。
```

原則：

```text
Objective event integrity
        +
Subjective interpretation freedom
```

---

# 27O. Objective Event vs Subjective Memory

Harness側には必要に応じて客観イベントログを保持できる。

例：

```text
Objective Event:
Yuto helped Hana.
```

しかしNPC Memoryは、

Hana：

```text
悠斗は自分が困っていたことに気づいて助けてくれた。
```

Yuto：

```text
たまたま近くにいたので少し手を貸した。
```

など異なってよい。

客観イベントログは主に、

```text
Debug
Replay
Evaluation
Compiler Support
```

用。

NPC自身が通常直接検索するものではない。

---

# 27P. Memory Architecture

概念全体：

```text
               EXPERIENCE
                   │
                   ▼
             Working Memory
        (Persistent Conversation)
                   │
              important?
             /           \
           no             yes
           │               │
           ▼               ▼
         fade        Episodic Trace
                           │
                        sleep()
                           │
               ┌───────────┼───────────┐
               ▼           ▼           ▼
           preserve     compress     discard
               │           │
               └─────┬─────┘
                     ▼
              Long-Term Memory
                     │
          time / rehearsal / cues
                     │
                     ▼
                  decay
                     │
                     ▼
                recall(cue)
                     │
              probabilistic access
```

別系統：

```text
Repeated Episodic Memory
          ↓
Semantic / Social Memory
```

および、

```text
Future Intention
      ↓
Prospective Memory
```

---

# 27Q. Memory Design North Star

Memory System設計で迷った場合は、

> **「どうすればたくさん覚えられるか」より「何を覚え、何を忘れ、どう思い出すか」を優先する。**

完全記憶を持つAIではなく、

> **経験を選択的に記憶し、忘却し、その残った記憶によって人格が形成されるNPC**

を目標とする。


# 28. System Prompt Research Boundary

NPC初期System Promptの具体設計は別研究班。

本体側が要求するInterface：

Input候補：

```text
Identity
Age
Initial temperament
Family information
Initial social setting
Current world rules
Available tools
Behavioral constraints
```

Output：

```text
NPC Initial System Prompt
```

本体チームはPromptの内容を固定しない。

研究班成果を差し替え可能にする。

---

# 29. Character Evolution

NPCは初期Promptから開始するが、その後の人物像は長期Conversationによって変化する。

理想：

```text
Initial temperament
      ↓
Family life
      ↓
Childhood
      ↓
School
      ↓
Friendship
      ↓
Conflict
      ↓
Love
      ↓
Work
      ↓
Success / Failure
      ↓
Current Person
```

「現在の性格」を最初から完成状態として与えない。

---

# 30. Death

NPCは年齢・世界条件等に従って死亡可能。

死亡したNPC SessionはSimulationから除外する。

ただし、

```text
Conversation / life history
```

はSimulation archiveとして保持可能にする。

死亡は他NPCの人生へ影響する重大イベントになり得る。

---

# 31. Parent SessionとNPC Sessionの境界

## Parentが決定

```text
Initial world
Initial population
Family skeleton
Birth initialization
Final compilation
```

## NPC自身が決定

```text
Daily behavior
Movement
Conversation targets
Friendship
Conflict
Romance
Personal goals
Use of facilities
Sleep timing
Subjective interpretation
```

## Harnessが決定

```text
Time
Turn boundary
World snapshot
Position consistency
Tool routing
Simultaneous resolution
Birth/death events
System-level constraints
```

---

# 32. Minecraftとの関係

Minecraft Fabric 26.2はReference Implementation。

Socius CoreとMinecraft Adapterを可能な限り分離する。

```text
Socius Core
├── Parent Orchestrator
├── Simulation Harness
├── NPC Sessions
├── Facility Agents
├── Turn Engine
├── Lifecycle System
└── Character Compiler

Minecraft Adapter
├── NPC Spawn
├── Skin
├── Navigation
├── Schedule
├── Behavior
└── Dialogue Runtime
```

---

# 33. Minecraft Output

各最終NPCについて最低限：

```text
Identity
Appearance
Life summary
Family
Important relationships
Important memories
Current personality
Speech tendency
Goals
Behavior profile
Schedule
Skin
Dialogue prompt
```

---

# 34. Skin Generation

最終的なSkin生成方式は別途設計。

第一候補：

```text
Base
+
Face
+
Hair
+
Top
+
Bottom
+
Accessory
+
Palette
```

のprocedural layer方式。

入力：

- 年齢
- 職業
- 好み
- 人格
- 所属
- 生活背景

---

# 35. Character Compiler

Simulation終了後、NPCの人生をゲームRuntime向けに圧縮する。

入力：

```text
NPC Conversation
Compaction history (if accessible)
Simulation event log
Family state
Current world state
```

出力：

```text
Character Genome
Runtime System Prompt
Behavior Config
Schedule
Social Summary
Appearance Config
```

具体的なSystem Prompt生成は別研究班成果を利用。

---

# 36. Production Flow

```text
Developer Request
       ↓
World Initialization
       ↓
Population Initialization
       ↓
Spawn NPC Sessions
       ↓
Run Society Simulation
       ↓
Birth / Aging / Death
       ↓
Generation 0 Extinction
       ↓
Compile Characters
       ↓
Generate Minecraft Assets
       ↓
Integrate
       ↓
Verify
```

---

# 37. Hackathon MVP Scope

必須：

- Parent Session
- NPC child/subagent sessions
- Facility Agent
- Morning / Noon / Evening / Night
- Simultaneous turn resolution
- Location system
- Local message tool
- Facility interaction
- Sleep + Compact
- Birth
- Aging
- Death
- Generation 0 end condition
- Final Character Compilation
- Minecraftへの最低限の出力

---

# 38. Explicitly Out of Scope — Hackathon

以下は将来機能。

- Phone
- SNS
- Email
- Long-distance messaging
- Complex transportation simulation
- Full economic simulation
- Political simulation
- Highly detailed health simulation
- Large-scale city simulation
- Perfect psychological realism
- Full procedural Minecraft world generation
- Thousands of simultaneously active NPCs

---

# 39. 最初のPrototype

最初から100人規模で始めない。

推奨：

```text
Phase 1
2 NPC + 1 Facility

Phase 2
5 NPC + 2 Facilities

Phase 3
10 NPC

Phase 4
Birth / Aging / Death

Phase 5
Generation transition

Phase 6
Minecraft Integration
```

---

# 40. First Technical Milestone

以下が成功すれば最初のProof of Concept成立：

```text
5 NPC
1 House
1 School
1 Workplace
4 turns/day
multiple days
local conversation
facility interaction
self-directed sleep
conversation compact
emergent friendship
```

人間が「AとBは友人」と設定していないにもかかわらず、

> Simulationの結果としてAとBが互いを友人として認識する

ことを確認する。

---

# 41. Research Tracks

## R1 — NPC System Prompt Research

担当：別研究班

目的：

- 長期人格維持
- 初期気質の表現
- Compact耐性
- Tool使用方針
- 自律行動品質

---

## R2 — Simulation Harness

本体。

- Turn Engine
- Barrier
- World Snapshot
- Position
- Tool routing
- Lifecycle

---

## R3 — Society Emergence Evaluation

評価方法：

- 人間関係が自然に形成されるか
- 似た初期条件でも違う人生になるか
- 同一人物が時間的に一貫するか
- コンパクション後も重要人物を覚えているか
- 初期条件に存在しない社会関係が創発するか

---

## R4 — Character Compiler

Simulationの長い人生から、

- Character bible
- Runtime prompt
- Behavior
- Minecraft assets

を生成。

---

# 42. Evaluation Metrics候補

定量評価候補：

```text
Relationship Emergence Rate
Relationship Diversity
Contradiction Rate
Memory Retention
Cross-Agent Consistency
Turn Completion Rate
Sleep Compliance
Compact Failure Rate
Simulation Cost / simulated year
Simulation Wall Time / simulated year
```

定性評価：

```text
Does this character feel like they have lived a life?
Are relationships causally explainable?
Do two characters remember shared history differently?
Does behavior remain consistent with prior experiences?
```

---

# 43. Debug / Visualization

最低限ログ：

```text
Turn
NPC
Location
Action
Tool call
Message
Sleep
Birth
Death
Facility interaction
```

望ましいVisualization：

```text
Timeline
Population graph
Family tree
Location occupancy
Conversation network
Relationship graph
Generation graph
```

---

# 44. Determinism / Replay

可能な範囲で、

- Turn number
- Session IDs
- World snapshots
- Tool calls
- Agent outputs
- Parent-generated birth data

を保存する。

完全なLLM deterministic再現は保証しないが、

> **Simulation inspection / partial replay**

を可能にする。

---

# 45. Suggested Repository Structure

```text
socius/
├── PROJECT_MASTER.md
│
├── docs/
│   ├── architecture/
│   ├── research/
│   │   ├── npc-prompt/
│   │   ├── society-evaluation/
│   │   └── character-compiler/
│   └── decisions/
│
├── core/
│   ├── parent/
│   ├── simulation/
│   │   ├── turn/
│   │   ├── world/
│   │   ├── lifecycle/
│   │   └── routing/
│   ├── agents/
│   ├── facilities/
│   └── compiler/
│
├── adapters/
│   └── minecraft-fabric/
│
├── schemas/
│   ├── world/
│   ├── npc/
│   ├── facility/
│   └── tools/
│
├── experiments/
│
└── tests/
```

---

# 46. Decision Log — Confirmed

以下は2026-09-12時点の確定事項。

1. Track 2で提出する。
2. MinecraftはReference Implementation。
3. 親セッションが大量のNPCサブエージェントを生成する。
4. 1 NPC = persistent Codex conversation。
5. NPC Context Windowは256kを前提とする。
6. Compact Conversationを使用する。
7. `sleep()` とCompactを結びつける。
8. NPCは睡眠を自律判断する。
9. 1日は朝・昼・夕・夜の4ターン。
10. 入場位置の確定後、各NPCが現在の公開状況を参照する。
11. 行動決定は並列。
12. Toolを受付順に即時反映し、ターン境界で未完了処理の解消を待つ。
13. 遠隔通信はHackathonでは実装しない。
14. FacilityはAI Agent。
15. 家族関係は初期条件として親が生成する。
16. 非家族の社会関係は原則Simulationで形成する。
17. 出生時のNPC初期化だけParent Sessionへ戻す。
18. 時間進行とともに子供をspawnする方式を採用する。
19. 現行段階はターン上限で終了する。死亡・絶滅条件は次段階とする。
20. NPC System Promptの具体研究は別研究班へ委譲する。

---

# 47. Open Questions

まだ固定しない項目：

- Parent SessionとNPC Sessionsの正確なCodex App Server API構成
- Aging速度
- Simulation 1年を何日分として表現するか
- Death probability / lifespan
- Romance / marriage / childbirth trigger
- Sleep不足の世界効果
- Final Character Compilerの圧縮形式
- Minecraft NPC Runtime方式
- Skin asset pipeline

---

# 48. 優先実装順

次に実装する順序：

```text
1. Agent Session abstraction
2. World State
3. Turn Engine
4. Barrier / Intent handling
5. move / message / end_turn
6. Facility Agent
7. sleep / Compact
8. Multi-day simulation
9. Emergent relationship experiment
10. Birth
11. Aging / Death
12. Generation end condition
13. Character Compiler
14. Minecraft adapter
```

---

# 49. Development Rule

実装前に不要な複雑化をしない。

原則：

> **LLMが本当に必要な部分だけAIに任せ、世界整合性・ターン・位置・LifecycleはHarnessが厳密に管理する。**

同時に、

> **NPC本人の主観・人格・記憶・意思決定をHarness側の数値モデルに置き換えすぎない。**

この2つのバランスが本プロジェクトの核心。

---

# 50. North Star Demo

最終デモで見せたいもの：

```text
Initial Population Spawn
        ↓
Society starts living
        ↓
NPCs independently move
        ↓
They meet
        ↓
They talk
        ↓
Friendships emerge
        ↓
They work / study
        ↓
They sleep and compact their memories
        ↓
They age
        ↓
Children are born
        ↓
Older generation dies
        ↓
Generation 0 disappears
        ↓
Living characters are compiled
        ↓
NPCs appear in Minecraft
```

審査員に伝えるべきこと：

> **We never authored these characters' histories.  
> The production tool simulated the lives that created them.**

---

# 51. Final Principle

このプロジェクトの設計判断で迷った場合、以下を優先する。

1. Track 2の開発ツールとして価値があるか
2. 人物設定を直接生成するより人生をシミュレーションできるか
3. NPC自身の主観を保持できるか
4. 世界整合性はHarnessが保証できるか
5. Hackathon期間内で実装可能か
6. Minecraft以外にも展開可能なCore設計か

---

**END OF PROJECT MASTER**
