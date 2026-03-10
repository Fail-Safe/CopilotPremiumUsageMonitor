declare module '../../../scripts/update-plan-data.mjs' {
    export function extractTableRows(html: string): { headers: string[]; premiumCells: string[] };
    export function parseNumberFromCell(text: string | null | undefined): number | null;
}

declare module '../../../scripts/release-bump.mjs' {
    export function sanitizeChangelogInner(raw: string | null | undefined): string;
}
