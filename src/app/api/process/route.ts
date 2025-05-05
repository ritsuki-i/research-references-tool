import { NextResponse } from "next/server"
import { Client } from "@notionhq/client"
import { toJSON } from "bibtex-parse-js"
const parseBibJSON = toJSON as (input: string) => {
  citationKey: string
  entryType: string
  entryTags: Record<string, string>
}[]
import xml2js from "xml2js"
import { UpdatePageParameters, PageObjectResponse } from "@notionhq/client/build/src/api-endpoints"

type EntryTags = Record<string, string>

export async function POST(req: Request) {
  const { token, databaseId } = await req.json()
  const notion = new Client({ auth: token })

  // BibTeXの種類マッピング
  const typeMap: Record<string, string> = {
    article: "雑誌論文",
    inproceedings: "会議論文",
    conference: "会議論文",
    misc: "arXiv論文",
  }

  // 会議名略称マッピング
  const confAbbrev: Record<string, string> = {
    // 機械学習の3大トップカンファレンス
    "International Conference on Machine Learning": "ICML",             // :contentReference[oaicite:0]{index=0}
    "International Conference on Learning Representations": "ICLR",    // :contentReference[oaicite:1]{index=1}
    "Conference on Neural Information Processing Systems": "NeurIPS",  // :contentReference[oaicite:2]{index=2}

    // 人工知能全般系
    "AAAI Conference on Artificial Intelligence": "AAAI",              // :contentReference[oaicite:3]{index=3}
    "International Joint Conference on Artificial Intelligence": "IJCAI", // :contentReference[oaicite:4]{index=4}

    // データマイニング＆知識発見
    "European Conference on Machine Learning and Principles and Practice of Knowledge Discovery in Databases": "ECML PKDD", // :contentReference[oaicite:5]{index=5}
    "Conference on Knowledge Discovery and Data Mining": "KDD",        // :contentReference[oaicite:6]{index=6}

    // 統計学・AI 結合分野
    "International Conference on Artificial Intelligence and Statistics": "AISTATS", // :contentReference[oaicite:7]{index=7}
    "Conference on Uncertainty in Artificial Intelligence": "UAI",     // :contentReference[oaicite:8]{index=8}

    // コンピュータビジョン系
    "Conference on Computer Vision and Pattern Recognition": "CVPR",    // :contentReference[oaicite:9]{index=9}
    "IEEE/CVF International Conference on Computer Vision": "ICCV",    // :contentReference[oaicite:10]{index=10}
    "European Conference on Computer Vision": "ECCV",                  // :contentReference[oaicite:11]{index=11}

    // パターン認識・信号処理系
    "International Conference on Data Mining": "ICDM",                 // :contentReference[oaicite:12]{index=12}
    "International Conference on Pattern Recognition": "ICPR",         // :contentReference[oaicite:13]{index=13}

    // 自然言語処理系
    "Annual Meeting of the Association for Computational Linguistics": "ACL", // :contentReference[oaicite:14]{index=14}
    "Conference on Empirical Methods in Natural Language Processing": "EMNLP", // :contentReference[oaicite:15]{index=15}

    // 強化学習・理論系（おまけ）
    "Conference on Learning Theory": "COLT",                            // :contentReference[oaicite:16]{index=16}
    "International Conference on Autonomous Agents and Multiagent Systems": "AAMAS", // :contentReference[oaicite:17]{index=17}
  }

  try {
    const { results } = await notion.databases.query({
      database_id: databaseId,
      filter: { property: "チェックボックス", checkbox: { equals: true } },
    })

    for (const row of results) {
      const page = row as PageObjectResponse

      const bibBlocks = (page.properties["BibTeX"] as {
        type: "rich_text"
        rich_text: { plain_text: string }[]
      }).rich_text

      const rawBib = bibBlocks.map(b => b.plain_text).join("\n")

      // クリーンアップ
      const cleanBib = rawBib
        .trim()
        .split(/\r?\n/)
        .map((line, i, arr) =>
          i < arr.length - 1 && arr[i + 1].trim() === "}" && line.trim().endsWith(",")
            ? line.replace(/,+$/, "")
            : line
        )
        .join("\n")
        .replace(/@(\w+)\{([^,]*?)\s+([^,]*?),/, (_m, t, a, b) => `@${t}{${a}${b},`)

      // 種類取得
      const typeMatch = cleanBib.match(/^@(\w+)\{/)
      const typeKey = typeMatch ? typeMatch[1].toLowerCase() : ""

      // パース
      const parsedArray = parseBibJSON(cleanBib)
      if (parsedArray.length === 0) continue
      const rawTags = parsedArray[0].entryTags

      // 小文字キーで正規化（value を string として扱う）
      const entryTags: EntryTags = {}
      for (const [key, value] of Object.entries(rawTags)) {
        entryTags[key.toLowerCase()] = value as string
      }

      // 著者処理
      const authorsRaw = entryTags.author.split(" and ")
      const isJa = /[\u3000-\u9fff]/.test(authorsRaw[0])

      // 会議名取得
      const confNameRaw = entryTags.booktitle ?? entryTags.journal ?? "";
      const confName = String(confNameRaw);
      // 会議名略称／短縮語の適用
      const shortenMap: Record<string, string> = {
        International: "Int.",
        Conference: "Conf.",
        Recognition: "Recognit.",
      }
      let confAbbreviation: string
      if (confAbbrev[confName]) {
        confAbbreviation = confAbbrev[confName]
      } else {
        const parenMatch = confName.match(/\(([^)]+)\)/)
        if (parenMatch) {
          // 括弧内の略称を使用
          confAbbreviation = parenMatch[1]
        } else {
          // 標準短縮語を適用
          confAbbreviation = confName
            .split(" ")
            .map(w => shortenMap[w] || w)
            .join(" ")
        }
      }

      // arXiv補完
      if (!entryTags.journal && entryTags.eprint) {
        const xml = await fetch(
          `http://export.arxiv.org/api/query?id_list=${entryTags.eprint}`
        ).then(r => r.text())
        const xmlObj = await xml2js.parseStringPromise(xml)
        const feedEntry = Array.isArray(xmlObj.feed.entry)
          ? xmlObj.feed.entry[0]
          : xmlObj.feed.entry
        entryTags.journal = feedEntry["arxiv:comment"]?.[0] ?? `arXiv preprint arXiv:${entryTags.eprint}`
        entryTags.year = feedEntry.published[0].slice(0, 4)
      }

      // スライド用参考文献
      let slideRef: string
      const firstRaw = authorsRaw[0]
      const yearShort = entryTags.year.slice(2)
      if (typeKey === 'misc') {
        const surname = isJa
          ? firstRaw.split(/, | /)[0]
          : firstRaw.includes(', ')
            ? firstRaw.split(', ')[0]
            : firstRaw.split(' ').pop()!;
        slideRef =
          `[${surname}, ’${yearShort}] ${surname}: ${entryTags.title}, ` +
          `arXiv preprint arXiv:${entryTags.eprint} (${entryTags.year}).`;
      }
      else if (typeKey === "inproceedings") {
        // 会議論文: 略称とページ番号付き
        const parts = firstRaw.includes(", ") ? firstRaw.split(", ") : firstRaw.split(" ")
        const lastName = isJa ? parts[0] : parts[parts.length - 1]
        let initials = ""
        if (!isJa) {
          initials = parts.slice(0, parts.length - 1).map(n => n[0] + ".").join(" ")
        }
        const slideAuth = isJa
          ? lastName
          : (authorsRaw.length > 1 ? `${lastName}, ${initials}, et al.` : `${lastName}, ${initials}`)
        let abbreviation: string;
        if (confAbbreviation) {
          abbreviation = confAbbreviation;
        } else {
          const parenMatch = confName.match(/\(([^)]+)\)/);
          abbreviation = parenMatch ? parenMatch[1] : confName.split(' ').map(w => w[0].toUpperCase()).join('');
        }
        const pages = entryTags.pages ? `pp. ${entryTags.pages}` : ""
        slideRef = `[${lastName}, ’${yearShort}] ${slideAuth}: ${entryTags.title}, In ${abbreviation}${pages ? `, ${pages}` : ""} (${entryTags.year}).`
      } else if (isJa) {
        // 日本語論文
        const nameParts = firstRaw.includes(", ") ? firstRaw.split(", ") : firstRaw.split(" ")
        const surname = nameParts[0]
        const slideAuth = authorsRaw.length > 1 ? surname + "ら" : surname
        let base = `[${surname}, ’${yearShort}] ${slideAuth}: ${entryTags.title}, ${entryTags.journal || entryTags.booktitle}`
        if (entryTags.volume) {
          base += `, Vol. ${entryTags.volume}, No. ${entryTags.number}, pp. ${entryTags.pages}`
        }
        slideRef = `${base} (${entryTags.year}).`
      } else {
        // 英文論文
        const parts = firstRaw.includes(", ") ? firstRaw.split(", ") : firstRaw.split(" ")
        const lastName = parts[parts.length - 1]
        const initials = parts.slice(0, -1).map(n => n[0] + ".").join(" ")
        const slideAuth = authorsRaw.length > 1 ? `${lastName}, ${initials}, et al.` : `${lastName}, ${initials}`
        let base = `[${lastName}, ’${yearShort}] ${slideAuth}: ${entryTags.title}, ${entryTags.journal}`
        if (entryTags.volume) {
          base += `, Vol. ${entryTags.volume}, No. ${entryTags.number}, pp. ${entryTags.pages}`
        }
        slideRef = `${base} (${entryTags.year}).`
      }

      // 通常参考文献
      const formatListEng = (list: string[]) => {
        if (list.length === 1) return list[0]
        if (list.length === 2) return `${list[0]} and ${list[1]}`
        return `${list.slice(0, -1).join(', ')} and ${list.slice(-1)[0]}`
      }
      let normalAuthList: string[]
      if (isJa) {
        normalAuthList = authorsRaw.map(a => a.replace(/, | /g, ''))
      } else {
        normalAuthList = authorsRaw.map(a => {
          if (a.includes(', ')) return a
          const p = a.split(/, | /)
          const last = p.pop()!
          const init = p.map(n => n[0] + '.').join(' ')
          return `${last}, ${init}`
        })
      }
      const normalAuth = isJa ? normalAuthList.join(', ') : formatListEng(normalAuthList)
      let normalRef: string
      // arXiv 論文の場合
      if (typeKey === 'misc') {
        normalRef = `${normalAuth}: ${entryTags.title}, arXiv preprint arXiv:${entryTags.eprint} (${entryTags.year}).`
      } else if (typeKey === 'inproceedings') {
        // 会議論文通常参照: In Proceedings of FullName (Abbr)
        const full = `In Proceedings of ${confName}`
        normalRef = `${normalAuth}: ${entryTags.title}, ${full}, ${entryTags.year}.`
      } else if (entryTags.volume) {
        normalRef = `${normalAuth}: ${entryTags.title}, ${entryTags.journal}, Vol. ${entryTags.volume}, No. ${entryTags.number}, pp. ${entryTags.pages} (${entryTags.year}).`
      } else if (entryTags.publisher) {
        normalRef = `${normalAuth}: ${entryTags.title}, ${entryTags.publisher} (${entryTags.year}).`
      } else {
        normalRef = `${normalAuth}: ${entryTags.title} (${entryTags.year}).`
      }

      // 基本の種類ラベル
      const baseType = typeMap[typeKey] ?? typeKey
      // 種類に実際の媒体名（雑誌名／会議名）を追加
      let typeDesc = baseType
      if (typeKey === 'article' && entryTags.journal) {
        typeDesc = `${baseType} (${entryTags.journal})`
      } else if (typeKey === 'inproceedings' && confName) {
        typeDesc = `${baseType} (${confName})`
      }

      // 更新
      const props: UpdatePageParameters["properties"] = {
        論文名: {
          title: [
            {
              type: "text",
              text: { content: entryTags.title },
            },
          ],
        },
        "参考文献(スライド)": {
          rich_text: [
            {
              type: "text",
              text: { content: slideRef },
            },
          ],
        },
        参考文献: {
          rich_text: [
            {
              type: "text",
              text: { content: normalRef },
            },
          ],
        },
        種類: {
          rich_text: [
            {
              type: "text",
              text: { content: typeDesc },
            },
          ],
        },
        チェックボックス: {
          checkbox: false,
        },
      }

      // URLがある場合だけ追加（型安全に追加）
      if (entryTags.url) {
        props.URL = {
          url: entryTags.url,
        }
      }

      await notion.pages.update({ page_id: row.id, properties: props })
    }

    return NextResponse.json({ message: "✅ 更新完了" })
  } catch (e) {
    const err = e as Error
    return NextResponse.json({ message: `❌ エラー: ${err.message}` }, { status: 500 })
  }
}
