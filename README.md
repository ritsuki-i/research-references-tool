# Research References Tool

**Notionテンプレート**＋**Next.jsアプリ**で、BibTeX を自動解析し Notion データベースにタイトル・参考文献を反映します。

- 🗂 **Notion テンプレート**（構造のみ、サンプルデータなし）  
  https://mousy-archduke-e39.notion.site/1e942aec698780f98a46f4a5dd26d44c?v=1e942aec698781b1bccf000cb8f06254&pvs=74  
- 🚀 **Webアプリ**  
  https://research-references-tool.vercel.app/  

---

## 📝 クイックスタート

1. **Notion Integration トークンを作成**  
   - Notion の「設定とメンバー」→「インテグレーション」→「新しいインテグレーションを作成」  
   - 名前を入力し（例：BibTeX Tool）、保存後に表示される “Internal Integration Token” をコピー（`ntn_…`）。

2. **テンプレートを複製**  
   - 上記 Notion テンプレートのリンクを開き、右上の「Duplicate」をクリック。  
   - 以下プロパティを持つ空のデータベースが複製されます：  
     `チェックボックス`、`BibTeX`、`論文名`、`参考文献(スライド)`、`参考文献`、`種類`、`URL`

3. **インテグレーションを招待**  
   - 複製したデータベースの「Share」→「Invite」→ 作成したインテグレーションを選択。  
   - 読み書きの権限を付与。

4. **データベースIDを取得**  
   - 複製したデータベースのページURLから、  
     ```
     https://www.notion.so/…/<DATABASE_ID>?…
     ```  
     の `<DATABASE_ID>`（32文字の英数字部分）をコピー。

5. **Webアプリに入力**  
   - https://research-references-tool.vercel.app/ を開き、  
   - 「Notion Token」「Database ID」を貼り付けて「保存」、  
   - 「実行」ボタンを押すとチェックした行が自動更新されます。

---

## 🛠️ ワークフロー

1. **Notion 側**で、`BibTeX` 列に `@…{…}` を貼り付け、チェックをオン  
2. **Webアプリ**で「実行」  
3. Notion の各ページに以下が自動入力される：  
   - 論文名  
   - 参考文献(スライド)  
   - 参考文献  
   - 種類  
   - URL（存在すれば）  
   - チェックボックスはオフ

---

## 📦 プロパティ概要

| プロパティ               | タイプ      | 説明                                         |
|--------------------------|-------------|----------------------------------------------|
| チェックボックス         | Checkbox    | ✅ を付けた行を処理                           |
| BibTeX                   | Rich text   | BibTeX エントリ全文を貼り付け                |
| 論文名                   | Title       | BibTeX の `title` を自動入力                 |
| 参考文献(スライド)       | Rich text   | スライド向け簡略形式                          |
| 参考文献                 | Rich text   | フル形式                                     |
| 種類                     | Rich text   | “雑誌論文” / “会議論文” / “arXiv論文”       |
| URL                      | URL         | BibTeX の `url` を自動入力                   |
| 概要                      | Rich text  | 引用件数何件とか, どんな論文か手動入力          |

 
