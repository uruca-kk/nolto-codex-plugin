# Nolto — Codex CLI Plugin

Codex CLI から Nolto の MCP サーバーに接続し、プランの登録・フェーズ進捗の報告・ステータスの確認をスキルで操作できる公式プラグインです。

このプラグインは以下を一括でインストールします:

- **MCP サーバー設定** (`https://nolto.app/mcp` への接続)
- **3 つのスキル** (`register-plan` / `report-progress` / `plan-status`)

v0.1.0 では bundled MCP サーバー + 3 つのスキルが含まれます。Stop hook によるキューフラッシュは `templates/codex-hooks.json` をプロジェクトの `.codex/hooks.json` にコピーすることで有効化します（codex-cli 0.137.0 では plugin-bundled hooks が removed フラグになったため、プロジェクトフックとして同梱しています）。

---

## インストール

### 1. マーケットプレイスを登録する

```bash
codex plugin marketplace add uruca-kk/nolto-codex-plugin
```

### 2. プラグインをインストールする

```bash
codex plugin add nolto@nolto
```

**注意**: `/plugin` スラッシュコマンドおよび `codex plugin install` は Claude Code の機能です。Codex CLI では上記の `codex plugin marketplace add` / `codex plugin add` コマンドを使ってください。

---

## 初回 OAuth 認証

インストール後、最初に MCP ツールを呼び出すと（例:「Nolto のプロジェクト一覧を見せて」）、OAuth 2.1 + PKCE の同意画面が表示されます。承認するとトークンが Codex CLI に保存され、以降は自動的に認証されます。

明示的に認証フローを開始する場合:

```bash
codex mcp login nolto
```

---

## ヘッドレス / CI 環境

SSH リモートやコンテナなど、ブラウザを開けない環境では OAuth（`codex mcp login`）が完了できません。代わりに以下を使ってください。

### 推奨: `nolto login`（device-code フロー）

[`@nolto/cli`](https://www.npmjs.com/package/@nolto/cli)（>= 0.3.0）の `nolto login` は、**別端末（スマホ・ラップトップ）のブラウザ**で承認するだけのヘッドレス向け認証です。

```bash
npm install -g @nolto/cli
nolto login --client codex
```

表示 URL を任意の端末で承認すると、トークンを取得して `codex mcp add nolto --url https://nolto.app/mcp --bearer-token-env-var NOLTO_TOKEN` を実行します（`NOLTO_TOKEN` を環境に設定してください）。

### 代替: 手動で Personal API Token を渡す

```bash
codex mcp add nolto --url https://nolto.app/mcp --bearer-token-env-var NOLTO_TOKEN
```

> **セキュリティ上の注意**: Personal API Token は `mcp:read` と `mcp:write` の両スコープを持ちます。パスワードと同様に扱い、**ソースコードにトークンを直書きしないでください**。CI やコンテナではシークレットマネージャーに保管し、環境変数経由で渡してください。

CLI ツール ([`@nolto/cli`](https://www.npmjs.com/package/@nolto/cli)) も CI パイプラインに適しています:

```bash
npm install -g @nolto/cli
nolto init
```

---

## スキルの使い方

### register-plan — プランを登録する

ローカルのマークダウンファイルを Nolto に登録します。H1 がプランタイトル、H2 が各フェーズとして自動抽出されます。

```
> implementation_plan.md を Nolto に登録して
```

Codex がファイルを読み込み、タイトル・フェーズを抽出して `register_plan` を呼び出します。登録後に planId と確認 URL が返されます。

### report-progress — 進捗を報告する

フェーズのステータス変更・テスト結果の記録・最終レビューの承認/差し戻しを行います。

```
> フェーズ 2 を完了にして
> テスト結果「合格」をラウンド 1 として記録して
> このプランのレビューで GO を出して
```

それぞれ `update_phase_status`、`record_phase_test_result`、`record_plan_review` が呼ばれます。

### plan-status — 状況を確認する

進行中のプランをエンジニア以外にも伝わる平易な日本語で要約します。

```
> Nolto の進行中プランを教えて
> このプランのフェーズ進捗は？
```

`list_plans` と `get_plan` を組み合わせて現在のステータスをまとめます。

---

## プランテンプレート / AGENTS.md サンプル

プラグインに **2 つのテンプレートファイル**が同梱されています:

| ファイル（リポジトリ内） | 説明 |
|---|---|
| `plugins/nolto/templates/plan-template.md` | Nolto 推奨プランテンプレート（日本語・フェーズ・ステータス例付き） |
| `plugins/nolto/templates/AGENTS.md.sample` | プロジェクトの `AGENTS.md` に貼り付けるガイドラインスニペット |

> インストール後はプラグインキャッシュ
> （`$CODEX_HOME/plugins/cache/nolto/nolto/<version>/templates/`）にも同じファイルが展開されます。

### 使い方

1. `AGENTS.md.sample` の内容をプロジェクトの `AGENTS.md` に貼り付けます。これにより、このプロジェクトで Codex がプランを作成するたびに Nolto の規則に従ったフォーマットで書かれるようになります。
2. 実際にプランを書くときは `plan-template.md` を出発点にコピーして編集してください。

### プランは日本語で書く理由

Nolto の分類器パイプライン（型1 = 実装プラン）は本文をそのまま日本語ビューに表示します。英語で書くと非エンジニア向けの可視化が読みづらくなるため、プラン本文は日本語で記述してください。

### ステータスマーカーの 3 つのルール

チェックボックスによる判定は**そのセクション自身の本文**が対象です。`###` サブフェーズのチェックは親 `##` フェーズには**伝播しません**。フェーズ（`##`）のステータスは、見出しマーカーを付けるか、サブフェーズを作らず見出し直下にチェックリストを置くことで設定します。

| ステータス | 判定方法（そのセクション自身の本文） |
|---|---|
| 完了 | H2 見出しに「✅」「完了」「済」を含める、またはチェックボックスが全部 `- [x]` |
| 進行中 | H2 見出しに「進行中」「着手」を含める、または `- [x]` と `- [ ]` が混在 |
| 未着手 | チェックボックスが全部 `- [ ]`、またはチェックボックスが無い |

見出しマーカー（「✅」「進行中」など）は、見出し行または本文の最初の 1 行でのみ認識されます。深い行に書いても拾われません。

---

## Stop フック (.codex/hooks.json)

codex-cli 0.137.0 では `plugin_hooks` が `removed → false` になっており、プラグインが自動的に Stop hook を登録することはできません。そのため、Stop hook はプロジェクトフックとして別途設定します。

### 設定方法

プロジェクト直下に `.codex/hooks.json`（ユーザーグローバルなら `~/.codex/hooks.json`）を作成し、
以下を貼り付けます。プラグイン同梱の `plugins/nolto/templates/codex-hooks.json` と同じ内容です:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "nolto flush --detach", "timeout": 10 }
        ]
      }
    ]
  }
}
```

インストール済みプラグインのキャッシュからコピーする場合:

```bash
cp "$CODEX_HOME/plugins/cache/nolto/nolto/0.1.0/templates/codex-hooks.json" .codex/hooks.json
```

### 前提条件

- `@nolto/cli >= 0.2.0` が PATH 上にインストールされていること
- `NOLTO_TOKEN` 環境変数（または `nolto init` で設定したトークン）が設定されていること

### 動作フロー

Codex セッション中にモデルが `nolto queue <sub> <args>` を呼び出すと、進捗情報がプロジェクトの `.nolto/pending.jsonl` にオフラインで追記されます（トークン不要）。セッション終了時に Stop フック (`codex-hooks.json`) が自動的に `nolto flush --detach` を実行します。

`nolto flush --detach` はバックグラウンドプロセスを二重フォーク（detach + unref）して即座に戻るため、Codex のフック待機をブロックしません。バックグラウンドワーカーがキューの各エントリを Nolto MCP サーバーに送信します。

### ノンブロッキング保証

- トークン未設定・ネットワークエラー・429 レート制限のいずれの場合も、同期ワーカーは **常に exit 0** を返します。
- エラーはプロジェクトの `.nolto/flush.log` に記録されます。キューは保持されるため、次回セッション終了時に再送が試みられます。
- Codex のセッションが中断されることはありません。

### ダイレクトコールとキュー版の使い分け

`report-progress` スキルによるダイレクト MCP 呼び出し（デフォルト）とキュー版は**どちらか一方**を使用してください。同じ更新に両方を使うと二重送信が発生します。

| 用途 | 方法 |
|------|------|
| 即時反映が必要 / 観測可能にしたい | `report-progress` スキル（ダイレクト呼び出し） |
| セッション終了時にまとめて送りたい | `nolto queue` + Stop フック |

---

## ライセンス

MIT — 詳細は [LICENSE](./LICENSE) を参照してください。

---

## リンク

- [プラグインリポジトリ（uruca-kk/nolto-codex-plugin）](https://github.com/uruca-kk/nolto-codex-plugin)
- [Nolto 公式サイト](https://nolto.app)
- [MCP セットアップガイド](https://nolto.app/docs/guides/mcp-setup)
- [CLI ガイド](https://nolto.app/docs/guides/cli)
- [MCP ツールリファレンス](https://nolto.app/docs/reference/mcp-tools)
- [メインリポジトリ](https://github.com/uruca-kk/nolto)
