# Research References Tool
BibTeX を解析し、Notion データベースにタイトル・参考文献などを反映

- **Notion テンプレート**  
  https://www.notion.so/33c42aec6987805c9626d5149e410862?v=ed242aec698783edb2a288bcdfec29a1&source=copy_link
- **Webアプリ**  
  https://research-references-tool.vercel.app/

---

## セットアップ

1. **テンプレートを複製**
   - 上記 Notion テンプレートのリンクを開き、右上から `複製` をクリック
   - 以下のプロパティを持つデータベースを用意
     `チェックボックス`、`BibTeX`、`論文名`、`参考文献(スライド)`、`参考文献`、`種類`、`URL`、`論文PDF`

2. **Notion Integration トークンを作成**
   - 複製したデータベースの右上から `接続` → `インテグレーションを開発` から新しいインテグレーションの作成
   - 名前，関連ワークスペースを入力し、保存後に表示される `Internal Integration Token` （または内部インテグレーションシークレット）をコピー

3. **インテグレーションを招待**
   - 複製したデータベースの右上から `接続` から作成したインテグレーションを追加
   - 読み書き権限を付与

4. **データベースIDを取得**
   - データベース URL の
     `https://www.notion.so/DATABASE_ID>?...`
     に含まれる `<DATABASE_ID>` をコピー

5. **Webアプリに入力**
   - https://research-references-tool.vercel.app/ を開く
   - `Notion Token` と `Database ID` を入力して保存
   - 実行ボタンを押すと、チェックした行が更新される

---

## ワークフロー

1. Notion の `BibTeX` 列に `@...{...}` を貼り付け、チェックをオン
2. Webアプリで実行
3. Notion の各ページに以下が自動反映される
   - 論文名
   - 参考文献(スライド)
   - 参考文献
   - 種類
   - URL
   - 論文PDF
   - チェックボックスはオフに戻る

---

## プロパティ一覧

| プロパティ | タイプ | 説明 |
|---|---|---|
| チェックボックス | Checkbox | 処理対象の行を指定 |
| BibTeX | Rich text | BibTeX エントリ全文 |
| 論文名 | Title | BibTeX の `title` を自動入力 |
| 参考文献(スライド) | Rich text | スライド用の参考文献形式 |
| 参考文献 | Rich text | 通常の参考文献形式 |
| 種類 | Rich text | 雑誌論文 / 会議論文 / arXiv など |
| URL | URL | alphaXiv の URL |
| 論文PDF | Files | 論文 PDF ファイル |
| 備考 | Rich text | 手動メモ用 |
                | Rich text  | 引用件数何件とか, どんな論文か手動入力          |

 

