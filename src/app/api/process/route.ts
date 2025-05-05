import { NextResponse } from "next/server"
import { Client } from "@notionhq/client"
import { toJSON as parseBibJSON } from "bibtex-parse-js"
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
    "The International Conference on Learning Representations": "ICLR",
    "Advances in Neural Information Processing Systems": "NeurIPS",
    "SIGKDD Conference on Knowledge Discovery and Data Mining": "KDD",
    "Conference on Computer Vision and Pattern Recognition": "CVPR",
    // 他の必要な略称を追加
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
      const typeDesc = typeMap[typeKey] ?? typeKey

      // パース
      const parsedArray = parseBibJSON(cleanBib)
      if (parsedArray.length === 0) continue
      const rawTags = parsedArray[0].entryTags

      // 小文字キーで正規化（value を string として扱う）
      const entryTags: EntryTags = {}
      for (const [key, value] of Object.entries(rawTags)) {
        entryTags[key.toLowerCase()] = value as string
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

      // 著者処理
      const authorsRaw = entryTags.author.split(" and ")
      const isJa = /[\u3000-\u9fff]/.test(authorsRaw[0])

      // 会議名取得
      const confName = entryTags.booktitle || entryTags.journal || ""
      const confAbbr = confAbbrev[confName]

      // スライド用参考文献
      let slideRef: string
      const firstRaw = authorsRaw[0]
      const yearShort = entryTags.year.slice(2)
      if (typeKey === "inproceedings") {
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
        if (confAbbr) {
          abbreviation = confAbbr;
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
