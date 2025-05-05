// types/bibtex-parse-js.d.ts
declare module 'bibtex-parse-js' {
    export interface BibTeXTag {
        citationKey: string
        entryType: string
        entryTags: Record<string, string>
    }

    export function toJSON(bibtex: string): BibTeXTag[]
}