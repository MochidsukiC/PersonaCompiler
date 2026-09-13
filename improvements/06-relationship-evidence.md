# 06 — NPCパッケージ内の関係参照を整合させる

Compilerが関係を採用したのに、その関係の根拠となる記憶を採用しなかった場合、relationships.jsonからmemories.jsonへの参照が切れたまま生成が成功していました。

採用した関係のevidenceが指す全記憶について、本人・ID・revisionが一致し、memoryIdsにも採用されていることを生成確定前に検証します。不一致はNPCごとの具体的な生成エラーになります。Compilerプロンプトにも同じ規則を明記しました。選ばれていない記憶の自動追加はしません。

## 確認方法

`npx vitest run --config vitest.backend.config.ts tests/backend/compiler.test.ts -t "requires selected relationships"`でモデル推論なしに確認できます。

- 関係だけ採用、根拠記憶を未採用: エラー
- 関係と同じrevisionの根拠記憶を採用: 成功
- 同じIDでも記憶のrevisionが違う: エラー
- 関係を採用しない: 関係のための記憶選択は不要

修正前のソースで最初のケースが誤って成功することを再現しました。ログ: `.local/polish-20260914/relationship-reproduction.log`、exit 1、対象1件FAIL・絞り込み対象外7件skip。

## 抽象化・互換性

人物・記憶・方向別関係のデータ整合性だけを扱います。ゲームエンジン、戦闘、会話UI、クエスト、実時間の進行方式は規定しません。出力形式は変更せず、既存ファイルは書き換えません。この規則は今後生成するパッケージに適用します。

## 検証

cwdはリポジトリルート。修正後ソースでbuild・typecheck・lint、単体40・backend121・native保存4・Electron E2E14が成功（各exit 0）。ログは`.local/polish-20260914/relationship-{typecheck,lint,test,persistence,e2e}.log`。

CLI接続検証の初回は、2つのNode Workerがnative終了しexit 1でした。アサーションを弱めず、他の検証を終えた同じソース・設定で`npm run test:connection`を単独実行したところ、7件PASS・exit 0でした（`relationship-connection-isolated.log`）。最終の各ゲートの合計は186件PASSです。初回ログ: `relationship-connection.log`、対象7件中5件PASS・2件未完了。終了codeは3221225477と3221226505、native終了の原因は未確定で、修正済みとはしていません。

## 戻し方

`git log --oneline -- improvements/06-relationship-evidence.md`でこの修正のコミットを確認し、`git revert <commit>`してください。
