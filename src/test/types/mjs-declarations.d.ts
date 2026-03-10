declare module '../../../scripts/update-plan-data' {
    export function extractTableRows(html: string): { headers: string[]; premiumCells: string[] };
    export function parseNumberFromCell(text: string | null | undefined): number | null;
}

declare module '../../../scripts/update-plan-data.mjs' {
    export function extractTableRows(html: string): { headers: string[]; premiumCells: string[] };
    export function parseNumberFromCell(text: string | null | undefined): number | null;
}

declare module '../../../scripts/release-bump' {
    export function sanitizeChangelogInner(raw: string | null | undefined): string;
}

declare module '../../../scripts/release-bump.mjs' {
    export function sanitizeChangelogInner(raw: string | null | undefined): string;
}

// Allow importing of any .mjs module as `any` to avoid missing declaration errors
declare module '*.mjs' {
    const anyExport: any;
    export default anyExport;
}

// No fallback to avoid overshadowing explicit module declarations above.
