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
type ArxivFeed = {
  feed?: {
    entry?: ArxivEntry[] | ArxivEntry
  }
}
type ArxivEntry = {
  title?: string[]
  id?: string[]
  published?: string[]
  "arxiv:comment"?: string[]
}

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

  function formatPages(raw: string): string {
    // 連続ハイフンを1つにまとめ
    const range = raw.replace(/\s*-+\s*/g, "--")
    // 先頭に p をつける
    return `pp. ${range}`;
  }

  function toTitleCase(title: string): string {
    const sanitizedTitle = title.replace(/[{}]/g, "")
    const smallWords = new Set([
      "a", "an", "the",
      "and", "but", "or", "for", "nor",
      "of", "in", "to", "for", "at", "by", "up",
    ])

    const hasInternalCaps = (word: string): boolean =>
      /[a-z][A-Z]|[A-Z][a-z].*[A-Z]|[A-Z]{2,}/.test(word)

    const capitalizeWord = (word: string): string => {
      if (!word || hasInternalCaps(word)) return word
      return word[0].toUpperCase() + word.slice(1).toLowerCase()
    }

    const splitToken = (token: string): { prefix: string; core: string; suffix: string } => {
      const prefix = token.match(/^[^A-Za-z0-9]*/)?.[0] ?? ""
      const suffix = token.match(/[^A-Za-z0-9]*$/)?.[0] ?? ""
      const core = token.slice(prefix.length, token.length - suffix.length)
      return { prefix, core, suffix }
    }

    const tokens = sanitizedTitle.trim().split(/\s+/)
    let forceCapitalizeNext = true

    return tokens.map((token, tokenIndex) => {
      const { prefix, core, suffix } = splitToken(token)
      if (!core) return token

      const normalized = core.split("-").map((part, partIndex, parts) => {
        if (!part || hasInternalCaps(part)) return part
        const lower = part.toLowerCase()
        const isFirst = tokenIndex === 0 && partIndex === 0
        const isLast = tokenIndex === tokens.length - 1 && partIndex === parts.length - 1
        const shouldLowercase = !forceCapitalizeNext && !isFirst && !isLast && smallWords.has(lower)
        return shouldLowercase ? lower : capitalizeWord(part)
      }).join("-")

      forceCapitalizeNext = /:$/.test(suffix)
      return `${prefix}${normalized}${suffix}`
    }).join(" ")
  }

  function normalizeConferenceName(raw: string): string {
    return raw
      .trim()
      .replace(/^(?:in\s+)?proceedings\s+of\s+(?:the\s+)?/i, "")
      .replace(/^\d{4}\s+/, "")
      .replace(/^\d+(?:st|nd|rd|th)\s+/i, "")
      .replace(/\s+/g, " ")
      .trim()
  }

  function stripDuplicateConferenceAbbreviation(name: string, abbreviation?: string): string {
    if (!abbreviation) return name
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return name.replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`, "i"), "").trim()
  }

  function normalizeLookupTitle(title: string): string {
    return title
      .replace(/[{}]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  }

  function makeNotionPdfFileName(title: string): string {
    const sanitized = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim()
    const suffix = ".pdf"
    const maxBaseLength = 100 - suffix.length
    const base = sanitized.slice(0, maxBaseLength).trim()
    return `${base || "paper"}${suffix}`
  }

  async function fetchArxivXml(
    url: string,
    context: { mode: "title" | "id"; query: string }
  ): Promise<string | null> {
    try {
      const response = await fetch(url)
      const text = await response.text()
      if (!response.ok) {
        console.error("arXiv query:", context)
        console.error("arXiv status:", response.status)
        console.error("arXiv content-type:", response.headers.get("content-type"))
        console.error("arXiv final url:", response.url)
        console.error("arXiv body head:", text.slice(0, 200))
        return null
      }
      const trimmed = text.trimStart()
      if (!trimmed.startsWith("<")) {
        console.error("arXiv query:", context)
        console.error("arXiv status:", response.status)
        console.error("arXiv content-type:", response.headers.get("content-type"))
        console.error("arXiv final url:", response.url)
        console.error("arXiv body head:", text.slice(0, 200))
        return null
      }
      return text
    } catch (error) {
      console.error("arXiv query:", context)
      console.error("arXiv fetch error:", error)
      return null
    }
  }

  async function findArxivByTitle(title: string): Promise<{ absUrl: string; pdfUrl: string } | null> {
    const queryTitle = title.replace(/[{}]/g, "").trim()
    if (!queryTitle) return null

    const params = new URLSearchParams({
      search_query: `ti:"${queryTitle}"`,
      start: "0",
      max_results: "5",
    })
    const xml = await fetchArxivXml(
      `https://export.arxiv.org/api/query?${params.toString()}`,
      { mode: "title", query: queryTitle }
    )
    if (!xml) return null

    let xmlObj: ArxivFeed
    try {
      xmlObj = await xml2js.parseStringPromise(xml)
    } catch (error) {
      console.error("arXiv query:", { mode: "title", query: queryTitle })
      console.error("arXiv XML parse error:", error)
      console.error("arXiv body head:", xml.slice(0, 200))
      return null
    }
    const entries = xmlObj.feed?.entry
      ? (Array.isArray(xmlObj.feed.entry) ? xmlObj.feed.entry : [xmlObj.feed.entry])
      : []

    const expected = normalizeLookupTitle(queryTitle)
    for (const entry of entries) {
      const entryTitle = String(entry.title?.[0] ?? "").replace(/\s+/g, " ").trim()
      const normalizedEntryTitle = normalizeLookupTitle(entryTitle)
      if (
        normalizedEntryTitle === expected ||
        normalizedEntryTitle.includes(expected) ||
        expected.includes(normalizedEntryTitle)
      ) {
        const id = String(entry.id?.[0] ?? "").trim()
        if (!id) continue
        const absUrl = id.replace(/^http:\/\//, "https://")
        const arxivId = absUrl.split("/abs/")[1]
        if (!arxivId) continue
        return {
          absUrl,
          pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
        }
      }
    }

    return null
  }

  /** LaTeX の簡易アクセント表記を Unicode 文字に置換 */
  function decodeLatexAccents(str: string): string {

    // accentChar：' ` ^ " ~ のいずれか
    // letter    ：A–Z,a–z のいずれか
    const re = /\\(['`^"~])\{?([A-Za-z])\}?/g;
    // matches は [ [ fullMatch, accentChar, letter, index, input ], … ] の配列になります

    const maps: Record<string, Record<string, string>> = {
      "'": { a: "á", A: "Á", e: "é", E: "É", i: "í", I: "Í", o: "ó", O: "Ó", u: "ú", U: "Ú", n: "ñ", N: "Ñ" },
      "`": { a: "à", A: "À", e: "è", E: "È", i: "ì", I: "Ì", o: "ò", O: "Ò", u: "ù", U: "Ù" },
      "^": { a: "â", A: "Â", e: "ê", E: "Ê", i: "î", I: "Î", o: "ô", O: "Ô", u: "û", U: "Û" },
      "\"": { a: "ä", A: "Ä", e: "ë", E: "Ë", i: "ï", I: "Ï", o: "ö", O: "Ö", u: "ü", U: "Ü" },
      "~": { a: "ã", A: "Ã", o: "õ", O: "Õ", n: "ñ", N: "Ñ" },
    };

    const result = str.replace(re, (_m, accent: string, letter: string) => {
      const table = maps[accent];
      return (table && table[letter]) || letter;
    });

    return result;
  }


  function parseAuthor(a: string): { family: string; initials: string } {

    const normalized = decodeLatexAccents(a);

    let family: string;
    let givenParts: string[];

    if (normalized.includes(",")) {
      // カンマ区切り "Family, Given1 Given2 …"
      const [fam, ...rest] = normalized.split(/\s*,\s*/);
      family = fam;
      // rest は ["Given1 Given2 …"] なので、結合して空白分割
      givenParts = rest.join(" ").trim().split(/\s+/);
    } else {
      // 空白区切り "Given1 Given2 … Family"
      const parts = normalized.trim().split(/\s+/);
      family = parts.pop()!;         // 最後を family
      givenParts = parts;           // 残りが名の各パート
    }

    const initials = givenParts
      .map(name => name[0].toUpperCase() + ".")
      .join(" ");

    return { family, initials };
  }

  // 会議名略称マッピング
  const confAbbrev: Record<string, string> = {
    // 機械学習の3大トップカンファレンス
    "International Conference on Machine Learning": "ICML",             // :contentReference[oaicite:0]{index=0}
    "International Conference on Learning Representations": "ICLR",    // :contentReference[oaicite:1]{index=1}
    "Neural Information Processing Systems": "NeurIPS",  // :contentReference[oaicite:2]{index=2}
    "Unifying Representations in Neural Models":"UniReps",

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

  const journalAbbrev: Record<string, string> = {
    "Transactions on Machine Learning Research": "TMLR",
    "TMLR": "TMLR",
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
      const authorsRaw = entryTags.author.split(/\s+and\s+/);
      const n = authorsRaw.length;
      const isJa = /[\u3000-\u9fff]/.test(authorsRaw[0])

      // 会議名取得
      const confNameRaw = entryTags.booktitle ?? entryTags.journal ?? "";
      const confName = normalizeConferenceName(String(confNameRaw));
      // ① マッピングキーのうち、confNameRaw に含まれるものを検索
      const matchedKey = Object.keys(confAbbrev).find(key => {
        const a = confNameRaw.toLowerCase();  // 小文字化してケース無視
        const b = key.toLowerCase();          // 小文字化してケース無視

        // a が b を含む、または b が a を含む
        return a.includes(b) || b.includes(a);
      });
      let confAbbreviation: string
      if (matchedKey) {
        // マップにあったキーなら、その略称を使う
        confAbbreviation = confAbbrev[matchedKey];
      } else {
        const parenMatch = confName.match(/\(([^)]+)\)/)
        if (parenMatch) {
          // 括弧内の略称を使用
          confAbbreviation = parenMatch[1]
        } else {
          // 会議名略称／短縮語の適用
          const shortenMap: Record<string, string> = {
            International: "Int.",
            Conference: "Conf.",
            Recognition: "Recognit.",
          }

          // 標準短縮語を適用
          confAbbreviation = confName
            .split(" ")
            .map(w => shortenMap[w] || w)
            .join(" ")
        }
      }
      const journalNameRaw = String(entryTags.journal ?? "")
      const matchedJournalKey = Object.keys(journalAbbrev).find(key => {
        const a = journalNameRaw.toLowerCase()
        const b = key.toLowerCase()
        return a.includes(b) || b.includes(a)
      })
      const journalDisplayName = matchedJournalKey
        ? `${matchedJournalKey} (${journalAbbrev[matchedJournalKey]})`
        : journalNameRaw
      const confDisplayName = stripDuplicateConferenceAbbreviation(confName, confAbbreviation)
      const titleText = toTitleCase(entryTags.title)
      const arxivMatch = await findArxivByTitle(titleText)
      const alphaXivUrl = arxivMatch?.absUrl
        ? arxivMatch.absUrl.replace("https://arxiv.org/abs/", "https://www.alphaxiv.org/abs/")
        : null
      // console.log("arXiv title lookup:", {
      //   title: titleText,
      //   found: !!arxivMatch,
      //   absUrl: arxivMatch?.absUrl ?? null,
      //   alphaXivUrl,
      //   pdfUrl: arxivMatch?.pdfUrl ?? null,
      // })
      const isConferenceLikeArticle =
        typeKey === "article" &&
        !!entryTags.journal &&
        (
          /^(?:in\s+)?proceedings\s+of/i.test(confNameRaw) ||
          /\b(conference|symposium|workshop|meeting)\b/i.test(confNameRaw) ||
          !!matchedKey
        )
      const effectiveTypeKey = isConferenceLikeArticle ? "inproceedings" : typeKey

      // arXiv補完
      if (!entryTags.journal && entryTags.eprint) {
        const xml = await fetchArxivXml(
          `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(entryTags.eprint)}`,
          { mode: "id", query: entryTags.eprint }
        )
        if (xml) {
          try {
            const xmlObj = await xml2js.parseStringPromise(xml)
            const feedEntry = Array.isArray(xmlObj.feed.entry)
              ? xmlObj.feed.entry[0]
              : xmlObj.feed.entry
            if (feedEntry) {
              entryTags.journal = feedEntry["arxiv:comment"]?.[0] ?? `arXiv preprint arXiv:${entryTags.eprint}`
              entryTags.year = feedEntry.published[0].slice(0, 4)
            }
          } catch (error) {
            console.error("arXiv query:", { mode: "id", query: entryTags.eprint })
            console.error("arXiv XML parse error:", error)
            console.error("arXiv body head:", xml.slice(0, 200))
          }
        }
      }

      // スライド用参考文献
      let slideRef: string
      const firstRaw = authorsRaw[0]
      const yearShort = entryTags.year.slice(2)
      if (effectiveTypeKey === 'misc') {
        let slideAuth: string;
        if (n === 1) {
          // 1名 → "Family, I."
          const { family, initials } = parseAuthor(authorsRaw[0]);
          slideAuth = `${family}, ${initials}`;

        } else if (n === 2) {
          // 2名 → "Family1, I. and Family2, J."
          const a1 = parseAuthor(authorsRaw[0]);
          const a2 = parseAuthor(authorsRaw[1]);
          slideAuth = `${a1.family}, ${a1.initials} and ${a2.family}, ${a2.initials}`;

        } else {
          // 3名以上 → "Family1, I., et al."
          const first = parseAuthor(authorsRaw[0]);
          slideAuth = `${first.family}, ${first.initials}, et al.`;
        }
        const surname = isJa
          ? slideAuth.split(/, | /)[0]
          : slideAuth.includes(', ')
            ? slideAuth.split(', ')[0]
            : slideAuth.split(' ').pop()!;
        slideRef =
          `[${surname}, ’${yearShort}] ${slideAuth}: ${titleText}, ` +
          `arXiv preprint arXiv:${entryTags.eprint} (${entryTags.year}).`;
      }
      else if (effectiveTypeKey === "inproceedings") {
        // 会議論文: 略称とページ番号付き
        let slideAuth: string;
        if (n === 1) {
          // 1名 → "Family, I."
          const { family, initials } = parseAuthor(authorsRaw[0]);
          slideAuth = `${family}, ${initials}`;

        } else if (n === 2) {
          // 2名 → "Family1, I. and Family2, J."
          const a1 = parseAuthor(authorsRaw[0]);
          const a2 = parseAuthor(authorsRaw[1]);
          slideAuth = `${a1.family}, ${a1.initials} and ${a2.family}, ${a2.initials}`;

        } else {
          // 3名以上 → "Family1, I., et al."
          const first = parseAuthor(authorsRaw[0]);
          slideAuth = `${first.family}, ${first.initials}, et al.`;
        }
        let abbreviation: string;
        if (confAbbreviation) {
          abbreviation = confAbbreviation;
        } else {
          const parenMatch = confName.match(/\(([^)]+)\)/);
          abbreviation = parenMatch ? parenMatch[1] : confName.split(' ').map(w => w[0].toUpperCase()).join('');
        }
        const vol = entryTags.volume ? entryTags.volume : ""
        const number = entryTags.volume ? entryTags.number : ""
        const pages = entryTags.pages ? formatPages(entryTags.pages) : ""
        const surname = isJa
          ? slideAuth.split(/, | /)[0]
          : slideAuth.includes(', ')
            ? slideAuth.split(', ')[0]
            : slideAuth.split(' ').pop()!;
        slideRef = `[${surname}, ’${yearShort}] ${slideAuth}: ${titleText}, Proceedings of ${confDisplayName}${abbreviation && abbreviation.toLowerCase() !== confDisplayName.toLowerCase() ? ` (${abbreviation})` : ""}${vol ? `, Vol. ${vol}` : ""}${number ? `, No. ${number}` : ""}${pages ? `, ${pages}` : ""} (${entryTags.year}).`
      } else if (isJa) {
        // 日本語論文
        const nameParts = firstRaw.includes(", ") ? firstRaw.split(", ") : firstRaw.split(" ")
        const surname = nameParts[0]
        const slideAuth = authorsRaw.length > 1 ? surname + "ら" : surname
        let base = `[${surname}, ’${yearShort}] ${slideAuth}: ${titleText}, ${entryTags.journal || entryTags.booktitle}`
        if (entryTags.volume) {
          // 巻は必ず出す
          base += `, Vol. ${entryTags.volume}`;

          // 号があれば追加
          if (entryTags.number) {
            base += `, No. ${entryTags.number}`;
          }

          // ページがあれば追加（“p12-14” 形式でひとつハイフン）
          if (entryTags.pages) {
            base += `, ${formatPages(entryTags.pages)}`;
          }
        }
        slideRef = `${base} (${entryTags.year}).`
      } else {
        // 英文論文
        let slideAuth: string;
        if (n === 1) {
          // 1名 → "Family, I."
          const { family, initials } = parseAuthor(authorsRaw[0]);
          slideAuth = `${family}, ${initials}`;
        } else if (n === 2) {
          // 2名 → "Family1, I. and Family2, J."
          const a1 = parseAuthor(authorsRaw[0]);
          const a2 = parseAuthor(authorsRaw[1]);
          slideAuth = `${a1.family}, ${a1.initials} and ${a2.family}, ${a2.initials}`;
        } else {
          // 3名以上 → "Family1, I., et al."
          const first = parseAuthor(authorsRaw[0]);
          slideAuth = `${first.family}, ${first.initials}, et al.`;
        }
        const surname = isJa
          ? slideAuth.split(/, | /)[0]
          : slideAuth.includes(', ')
            ? slideAuth.split(', ')[0]
            : slideAuth.split(' ').pop()!;
        let base = `[${surname}, ’${yearShort}] ${slideAuth}: ${titleText}, ${journalDisplayName}`
        if (entryTags.volume) {
          // 巻は必ず出す
          base += `, Vol. ${entryTags.volume}`;

          // 号があれば追加
          if (entryTags.number) {
            base += `, No. ${entryTags.number}`;
          }

          // ページがあれば追加（“p12-14” 形式でひとつハイフン）
          if (entryTags.pages) {
            base += `, ${formatPages(entryTags.pages)}`;
          }
        }
        slideRef = `${base} (${entryTags.year}).`
      }

      // 通常参考文献
      if (effectiveTypeKey === "inproceedings") {
        const slideVenue = confAbbreviation ? `In ${confAbbreviation}` : `Proceedings of the ${confDisplayName}`
        slideRef = slideRef.replace(
          /Proceedings of .*?(?=(?:, Vol\.|, No\.|, pp\.| \())/,
          slideVenue
        )
        if (confAbbreviation) {
          const escaped = confAbbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          slideRef = slideRef.replace(new RegExp(`In ${escaped}\\s*\\(${escaped}\\)`), `In ${confAbbreviation}`)
        }
      }

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
          const { family, initials } = parseAuthor(a);
          return `${family}, ${initials}`;  // 例: "Loftus, T. J."
        });
      }
      const normalAuth = isJa ? normalAuthList.join(', ') : formatListEng(normalAuthList)
      let normalRef: string
      // arXiv 論文の場合
      if (effectiveTypeKey === 'misc') {
        normalRef = `${normalAuth}: ${titleText}, arXiv preprint arXiv:${entryTags.eprint} (${entryTags.year}).`
      } else if (effectiveTypeKey === 'inproceedings') {
        // 会議論文通常参照: Proceedings of FullName (Abbr)
        let full = `Proceedings of the ${confDisplayName}`
        if (confAbbreviation && confAbbreviation.toLowerCase() !== confDisplayName.toLowerCase()) {
          full += ` (${confAbbreviation})`
        }
        if (entryTags.volume) {
          full += `, Vol. ${entryTags.volume}`;
        }

        // 号があれば追加
        if (entryTags.number) {
          full += `, No. ${entryTags.number}`;
        }

        // ページがあれば追加（“p12-14” 形式でひとつハイフン）
        if (entryTags.pages) {
          full += `, ${formatPages(entryTags.pages)}`;
        }
        normalRef = `${normalAuth}: ${titleText}, ${full} (${entryTags.year}).`
      } else if (entryTags.volume) {
        let base = "";
        // 巻は必ず出す
        base += `Vol. ${entryTags.volume}`;

        // 号があれば追加
        if (entryTags.number) {
          base += `, No. ${entryTags.number}`;
        }

        // ページがあれば追加（“p12-14” 形式でひとつハイフン）
        if (entryTags.pages) {
          base += `, ${formatPages(entryTags.pages)}`;
        }
        normalRef = `${normalAuth}: ${titleText}, ${journalDisplayName}, ` + base + ` (${entryTags.year}).`
      } else if (effectiveTypeKey === 'article' && entryTags.journal) {
        normalRef = `${normalAuth}: ${titleText}, ${journalDisplayName} (${entryTags.year}).`
      } else if (entryTags.publisher) {
        normalRef = `${normalAuth}: ${titleText}, ${entryTags.publisher} (${entryTags.year}).`
      } else {
        normalRef = `${normalAuth}: ${titleText} (${entryTags.year}).`
      }

      // 基本の種類ラベル
      const baseType = typeMap[effectiveTypeKey] ?? effectiveTypeKey
      // 種類に実際の媒体名（雑誌名／会議名）を追加
      let typeDesc = baseType
      if (effectiveTypeKey === 'article' && entryTags.journal) {
        typeDesc = `${baseType} (${journalDisplayName})`
      } else if (effectiveTypeKey === 'inproceedings' && confName) {
        typeDesc = `${baseType} (${confName})`
      }

      // 更新
      const props: UpdatePageParameters["properties"] = {
        論文名: {
          title: [
            {
              type: "text",
              text: { content: titleText },
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
      if (alphaXivUrl) {
        props.URL = {
          url: alphaXivUrl,
        }
        console.log("URL source:", { title: titleText, source: "alphaxiv", url: alphaXivUrl })
      } else if (entryTags.url) {
        props.URL = {
          url: entryTags.url,
        }
        console.log("URL source:", { title: titleText, source: "bibtex", url: entryTags.url })
      } else {
        console.log("URL source:", { title: titleText, source: "none", url: null })
      }

      if (arxivMatch?.pdfUrl) {
        props["論文PDF"] = {
          files: [
            {
              name: makeNotionPdfFileName(titleText),
              type: "external",
              external: { url: arxivMatch.pdfUrl },
            },
          ],
        }
        console.log("PDF source:", { title: titleText, attached: true, url: arxivMatch.pdfUrl })
      } else {
        console.log("PDF source:", { title: titleText, attached: false, url: null })
      }

      await notion.pages.update({ page_id: row.id, properties: props })
    }

    return NextResponse.json({ message: "✅ 更新完了" })
  } catch (e) {
    const err = e as Error
    return NextResponse.json({ message: `❌ エラー: ${err.message}` }, { status: 500 })
  }
}
