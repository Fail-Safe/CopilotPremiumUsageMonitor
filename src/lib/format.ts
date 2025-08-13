/* Pure formatting & selection helpers extracted for unit testing */
export function computeUsageBar(percent: number, segments = 10) {
    if (!isFinite(percent)) percent = 0;
    percent = Math.max(0, Math.min(100, Math.round(percent)));
    const pctFraction = percent / 100;
    const filled = Math.round(pctFraction * segments);
    return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, segments - filled));
}

export function formatRelativeTime(fromTs: number, now: number = Date.now()): string {
    try {
        const diffMs = now - fromTs;
        if (diffMs < 0) return 'just now';
        const sec = Math.floor(diffMs / 1000);
        if (sec < 1) return 'just now';
        if (sec < 45) return `${sec}s ago`;
        if (sec < 90) return '1m ago';
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return hr * 60 === min ? `${hr}h ago` : `${hr}h ${min % 60}m ago`;
        const day = Math.floor(hr / 24);
        if (day < 7) return `${day}d ago`;
        const wk = Math.floor(day / 7);
        if (wk < 4) return `${wk}w ago`;
        const mo = Math.floor(day / 30);
        if (mo < 12) return `${mo}mo ago`;
        const yr = Math.floor(day / 365);
        return `${yr}y ago`;
    } catch { return ''; }
}

export interface IconSelectionInput {
    percent: number;
    warnAt: number;
    dangerAt: number;
    error?: string | undefined | null;
    mode: 'personal' | 'org' | 'auto';
    override?: string | undefined;
}

export interface IconSelectionResult {
    icon: string;
    forcedColor?: 'charts.yellow' | 'charts.red' | 'errorForeground' | undefined;
    staleTag: string;
}

const KNOWN_ICONS: Record<string, true> = {
    account: true, organization: true, graph: true, pulse: true, dashboard: true, repo: true, rocket: true, flame: true,
    star: true, cloud: true, shield: true, zap: true, beaker: true, 'circuit-board': true, bell: true, globe: true,
    gear: true, history: true, calendar: true, tag: true, info: true, search: true, workspace: true,
    'folder-active': true, 'symbol-method': true, 'symbol-variable': true, plug: true
};

export function pickIcon(input: IconSelectionInput): IconSelectionResult {
    let baseIcon = input.mode === 'personal' ? 'account' : 'organization';
    let icon = baseIcon;
    let forcedColor: IconSelectionResult['forcedColor'];
    let staleTag = '';
    if (input.error) {
        const lower = input.error.toLowerCase();
        if (lower.includes('404')) icon = 'question';
        else if (lower.includes('401') || lower.includes('403') || lower.includes('permission')) icon = 'key';
        else if (lower.includes('network')) icon = 'cloud-offline';
        else icon = 'warning';
        staleTag = ' [stale]';
        if (icon === 'key' || icon === 'warning') forcedColor = 'errorForeground';
        else forcedColor = 'charts.yellow';
    } else if (input.override) {
        const candidate = input.override.toLowerCase();
        if (/^[a-z0-9-]{2,}$/i.test(candidate) && KNOWN_ICONS[candidate]) {
            icon = candidate;
        }
    }
    return { icon, forcedColor, staleTag };
}
