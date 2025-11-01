import * as vscode from 'vscode';
import { RECENT_DATA_WINDOW_HOURS, STABILITY_THRESHOLD } from '../constants';

export interface UsageSnapshot {
    timestamp: number;
    totalQuantity: number;
    includedUsed: number;
    spend: number;
    included: number;
}

export interface DailyAggregate {
    date: string;                     // "2025-11-01"
    totalRequests: number;
    totalSpend: number;
    includedUsed: number;
    included: number;
    avgHourlyRate: number;
    peakHourlyRate: number;
    snapshotCount: number;
}

export interface MonthlyAggregate {
    month: string;                    // "2025-11"
    totalRequests: number;
    totalSpend: number;
    includedUsed: number;
    avgDailyRate: number;
    peakDailyRate: number;
    daysActive: number;
}

export interface UsageHistory {
    snapshots: UsageSnapshot[];       // Detailed snapshots (last 30 days)
    dailyAggregates: DailyAggregate[]; // Daily summaries (last 90 days)
    monthlyAggregates: MonthlyAggregate[]; // Monthly summaries (last 24 months)
    lastCollectionTime: number;
    lastArchiveCheck: number;         // Timestamp of last archive maintenance
}

export interface UsageTrend {
    hourlyRate: number;
    dailyProjection: number;
    weeklyProjection: number;
    monthlyProjection?: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    confidence: 'high' | 'medium' | 'low';
}

const HISTORY_KEY = 'copilotPremiumUsageMonitor.usageHistory';
const MAX_DETAILED_SNAPSHOTS = 720;    // 30 days at 1-hour intervals
const MAX_DAILY_AGGREGATES = 90;       // 90 days of daily summaries
const MAX_MONTHLY_AGGREGATES = 24;     // 24 months of monthly summaries
const ARCHIVE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // Check daily for archiving

export class UsageHistoryManager {
    constructor(private context: vscode.ExtensionContext) { }

    async collectSnapshot(currentData: {
        totalQuantity: number;
        includedUsed: number;
        spend: number;
        included: number;
    }): Promise<void> {
        const now = Date.now();
        const history = this.getHistory();

        const snapshot: UsageSnapshot = {
            timestamp: now,
            totalQuantity: currentData.totalQuantity,
            includedUsed: currentData.includedUsed,
            spend: currentData.spend,
            included: currentData.included
        };

        // Add new snapshot
        history.snapshots.push(snapshot);
        history.lastCollectionTime = now;

        // Check if we need to archive old data (daily check)
        if (now - history.lastArchiveCheck > ARCHIVE_CHECK_INTERVAL) {
            await this.archiveOldData(history, now);
            history.lastArchiveCheck = now;
        }

        // Keep only recent detailed snapshots (last 30 days)
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        history.snapshots = history.snapshots.filter(s => s.timestamp > thirtyDaysAgo);

        // Limit detailed snapshots by count as well
        if (history.snapshots.length > MAX_DETAILED_SNAPSHOTS) {
            history.snapshots = history.snapshots.slice(-MAX_DETAILED_SNAPSHOTS);
        }

        await this.saveHistory(history);
    }

    shouldCollectSnapshot(): boolean {
        const config = vscode.workspace.getConfiguration('copilotPremiumUsageMonitor');
        const intervalMinutes = Number(config.get('refreshIntervalMinutes') ?? 5);
        const intervalMs = intervalMinutes * 60 * 1000;

        const history = this.getHistory();
        const timeSinceLastCollection = Date.now() - history.lastCollectionTime;

        return timeSinceLastCollection >= intervalMs;
    }

    getHistory(): UsageHistory {
        const stored = this.context.globalState.get<UsageHistory>(HISTORY_KEY);
        if (!stored) {
            return {
                snapshots: [],
                dailyAggregates: [],
                monthlyAggregates: [],
                lastCollectionTime: 0,
                lastArchiveCheck: 0
            };
        }
        // Migrate old format if needed
        if (!stored.dailyAggregates) {
            (stored as any).dailyAggregates = [];
        }
        if (!stored.monthlyAggregates) {
            (stored as any).monthlyAggregates = [];
        }
        if (!stored.lastArchiveCheck) {
            (stored as any).lastArchiveCheck = 0;
        }
        return stored;
    }

    private async saveHistory(history: UsageHistory): Promise<void> {
        await this.context.globalState.update(HISTORY_KEY, history);
    }

    calculateTrend(): UsageTrend | null {
        const history = this.getHistory();
        const snapshots = history.snapshots;

        if (snapshots.length < 2) {
            return null; // Need at least 2 data points
        }

        // Sort by timestamp to ensure chronological order
        snapshots.sort((a, b) => a.timestamp - b.timestamp);

        // Calculate rate based on recent data points
        const recentSnapshots = snapshots.slice(-12); // Last 12 snapshots for trend
        if (recentSnapshots.length < 2) {
            return null;
        }

        const firstSnapshot = recentSnapshots[0];
        const lastSnapshot = recentSnapshots[recentSnapshots.length - 1];
        const timeSpanHours = (lastSnapshot.timestamp - firstSnapshot.timestamp) / (1000 * 60 * 60);

        if (timeSpanHours <= 0) {
            return null;
        }

        // Calculate requests per hour
        const requestsIncrease = lastSnapshot.totalQuantity - firstSnapshot.totalQuantity;
        const hourlyRate = requestsIncrease / timeSpanHours;

        // Calculate projections
        const dailyProjection = hourlyRate * 24;
        const weeklyProjection = dailyProjection * 7;
        const monthlyProjection = dailyProjection * 30;

        // Determine trend direction
        const midPoint = Math.floor(recentSnapshots.length / 2);
        const firstHalf = recentSnapshots.slice(0, midPoint);
        const secondHalf = recentSnapshots.slice(midPoint);

        const firstHalfAvgRate = this.calculateAverageRate(firstHalf);
        const secondHalfAvgRate = this.calculateAverageRate(secondHalf);

        let trend: 'increasing' | 'decreasing' | 'stable';
        const rateDifference = secondHalfAvgRate - firstHalfAvgRate;
        const threshold = hourlyRate * STABILITY_THRESHOLD; // 10% threshold for stability

        if (Math.abs(rateDifference) < threshold) {
            trend = 'stable';
        } else if (rateDifference > 0) {
            trend = 'increasing';
        } else {
            trend = 'decreasing';
        }

        // Determine confidence based on data consistency
        const confidence = this.calculateConfidence(recentSnapshots, hourlyRate);

        return {
            hourlyRate,
            dailyProjection,
            weeklyProjection,
            monthlyProjection,
            trend,
            confidence
        };
    }

    private calculateAverageRate(snapshots: UsageSnapshot[]): number {
        if (snapshots.length < 2) return 0;

        let totalRate = 0;
        let intervals = 0;

        for (let i = 1; i < snapshots.length; i++) {
            const timeSpanHours = (snapshots[i].timestamp - snapshots[i - 1].timestamp) / (1000 * 60 * 60);
            if (timeSpanHours > 0) {
                const requestsIncrease = snapshots[i].totalQuantity - snapshots[i - 1].totalQuantity;
                totalRate += requestsIncrease / timeSpanHours;
                intervals++;
            }
        }

        return intervals > 0 ? totalRate / intervals : 0;
    }

    private calculateConfidence(snapshots: UsageSnapshot[], expectedRate: number): 'high' | 'medium' | 'low' {
        if (snapshots.length < 6) return 'low';

        // Calculate variance in rates
        const rates: number[] = [];
        for (let i = 1; i < snapshots.length; i++) {
            const timeSpanHours = (snapshots[i].timestamp - snapshots[i - 1].timestamp) / (1000 * 60 * 60);
            if (timeSpanHours > 0) {
                const requestsIncrease = snapshots[i].totalQuantity - snapshots[i - 1].totalQuantity;
                rates.push(requestsIncrease / timeSpanHours);
            }
        }

        if (rates.length === 0) return 'low';

        const variance = this.calculateVariance(rates);
        const coefficientOfVariation = expectedRate > 0 ? Math.sqrt(variance) / expectedRate : 0;

        if (coefficientOfVariation < 0.3) return 'high';
        if (coefficientOfVariation < 0.7) return 'medium';
        return 'low';
    }

    private calculateVariance(numbers: number[]): number {
        if (numbers.length === 0) return 0;

        const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
        const squaredDifferences = numbers.map(n => Math.pow(n - mean, 2));
        return squaredDifferences.reduce((sum, n) => sum + n, 0) / numbers.length;
    }

    getRecentSnapshots(hours: number = 24): UsageSnapshot[] {
        const history = this.getHistory();
        const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);

        return history.snapshots
            .filter(s => s.timestamp > cutoffTime)
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    getDataSize(): { snapshots: number; estimatedKB: number } {
        const history = this.getHistory();
        const jsonString = JSON.stringify(history);
        const estimatedKB = Math.round(jsonString.length / 1024 * 100) / 100;
        // Align with UI/tests that reason about "recent" data most of the time.
        // Prefer count for last 48 hours when available; otherwise fall back to total.
        const cutoff = Date.now() - (RECENT_DATA_WINDOW_HOURS * 60 * 60 * 1000);
        const recent = history.snapshots.filter(s => s.timestamp > cutoff).length;
        const count = recent > 0 ? recent : history.snapshots.length;
        return { snapshots: count, estimatedKB };
    }

    async clearHistory(): Promise<void> {
        await this.context.globalState.update(HISTORY_KEY, undefined);
    }

    /**
     * Archive old snapshots into daily and monthly aggregates
     * Maintains hybrid storage: detailed recent, aggregated historical
     */
    private async archiveOldData(history: UsageHistory, now: number): Promise<void> {
        // 1. Aggregate snapshots older than 30 days into daily aggregates
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        const oldSnapshots = history.snapshots.filter(s => s.timestamp <= thirtyDaysAgo);
        
        if (oldSnapshots.length > 0) {
            const newDailyAggregates = this.aggregateSnapshotsByDay(oldSnapshots);
            
            // Merge with existing daily aggregates (avoid duplicates)
            const existingDates = new Set(history.dailyAggregates.map(d => d.date));
            for (const daily of newDailyAggregates) {
                if (!existingDates.has(daily.date)) {
                    history.dailyAggregates.push(daily);
                }
            }
        }

        // 2. Aggregate daily records older than 90 days into monthly aggregates
        const ninetyDaysAgo = now - (90 * 24 * 60 * 60 * 1000);
        const oldDailies = history.dailyAggregates.filter(d => {
            const dailyTimestamp = new Date(d.date).getTime();
            return dailyTimestamp <= ninetyDaysAgo;
        });

        if (oldDailies.length > 0) {
            const newMonthlyAggregates = this.aggregateDailyByMonth(oldDailies);
            
            // Merge with existing monthly aggregates (avoid duplicates)
            const existingMonths = new Set(history.monthlyAggregates.map(m => m.month));
            for (const monthly of newMonthlyAggregates) {
                if (!existingMonths.has(monthly.month)) {
                    history.monthlyAggregates.push(monthly);
                }
            }

            // Remove old daily aggregates that have been archived
            const oldDailyDates = new Set(oldDailies.map(d => d.date));
            history.dailyAggregates = history.dailyAggregates.filter(d => !oldDailyDates.has(d.date));
        }

        // 3. Limit monthly aggregates to 24 months
        if (history.monthlyAggregates.length > MAX_MONTHLY_AGGREGATES) {
            history.monthlyAggregates.sort((a, b) => b.month.localeCompare(a.month)); // Newest first
            history.monthlyAggregates = history.monthlyAggregates.slice(0, MAX_MONTHLY_AGGREGATES);
        }

        // 4. Limit daily aggregates to 90 days
        if (history.dailyAggregates.length > MAX_DAILY_AGGREGATES) {
            history.dailyAggregates.sort((a, b) => b.date.localeCompare(a.date)); // Newest first
            history.dailyAggregates = history.dailyAggregates.slice(0, MAX_DAILY_AGGREGATES);
        }
    }

    private aggregateSnapshotsByDay(snapshots: UsageSnapshot[]): DailyAggregate[] {
        const dailyMap = new Map<string, UsageSnapshot[]>();

        // Group snapshots by day
        for (const snapshot of snapshots) {
            const date = new Date(snapshot.timestamp);
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            
            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, []);
            }
            dailyMap.get(dateKey)!.push(snapshot);
        }

        // Create daily aggregates
        const dailyAggregates: DailyAggregate[] = [];
        
        for (const [date, daySnapshots] of dailyMap.entries()) {
            if (daySnapshots.length === 0) continue;

            daySnapshots.sort((a, b) => a.timestamp - b.timestamp);
            const first = daySnapshots[0];
            const last = daySnapshots[daySnapshots.length - 1];

            const totalRequests = last.totalQuantity - first.totalQuantity;
            const totalSpend = last.spend - first.spend;
            const includedUsed = last.includedUsed - first.includedUsed;
            
            // Calculate hourly rates
            const hourlyRates: number[] = [];
            for (let i = 1; i < daySnapshots.length; i++) {
                const timeSpanHours = (daySnapshots[i].timestamp - daySnapshots[i - 1].timestamp) / (1000 * 60 * 60);
                if (timeSpanHours > 0) {
                    const requestsIncrease = daySnapshots[i].totalQuantity - daySnapshots[i - 1].totalQuantity;
                    hourlyRates.push(requestsIncrease / timeSpanHours);
                }
            }

            const avgHourlyRate = hourlyRates.length > 0 
                ? hourlyRates.reduce((sum, r) => sum + r, 0) / hourlyRates.length 
                : 0;
            const peakHourlyRate = hourlyRates.length > 0 ? Math.max(...hourlyRates) : 0;

            dailyAggregates.push({
                date,
                totalRequests,
                totalSpend,
                includedUsed,
                included: last.included,
                avgHourlyRate,
                peakHourlyRate,
                snapshotCount: daySnapshots.length
            });
        }

        return dailyAggregates;
    }

    private aggregateDailyByMonth(dailyAggregates: DailyAggregate[]): MonthlyAggregate[] {
        const monthlyMap = new Map<string, DailyAggregate[]>();

        // Group daily aggregates by month
        for (const daily of dailyAggregates) {
            const monthKey = daily.date.substring(0, 7); // "2025-11"
            
            if (!monthlyMap.has(monthKey)) {
                monthlyMap.set(monthKey, []);
            }
            monthlyMap.get(monthKey)!.push(daily);
        }

        // Create monthly aggregates
        const monthlyAggregates: MonthlyAggregate[] = [];
        
        for (const [month, monthDailies] of monthlyMap.entries()) {
            if (monthDailies.length === 0) continue;

            const totalRequests = monthDailies.reduce((sum, d) => sum + d.totalRequests, 0);
            const totalSpend = monthDailies.reduce((sum, d) => sum + d.totalSpend, 0);
            const includedUsed = monthDailies.reduce((sum, d) => sum + d.includedUsed, 0);
            
            const avgDailyRate = monthDailies.reduce((sum, d) => sum + d.avgHourlyRate * 24, 0) / monthDailies.length;
            const peakDailyRate = Math.max(...monthDailies.map(d => d.avgHourlyRate * 24));
            const daysActive = monthDailies.length;

            monthlyAggregates.push({
                month,
                totalRequests,
                totalSpend,
                includedUsed,
                avgDailyRate,
                peakDailyRate,
                daysActive
            });
        }

        return monthlyAggregates;
    }

    /**
     * Get monthly aggregates for historical comparison
     */
    getMonthlyHistory(): MonthlyAggregate[] {
        const history = this.getHistory();
        return [...history.monthlyAggregates].sort((a, b) => b.month.localeCompare(a.month));
    }

    /**
     * Get daily aggregates for mid-term trending
     */
    getDailyHistory(days: number = 90): DailyAggregate[] {
        const history = this.getHistory();
        const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
        const cutoffDateStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;
        
        return history.dailyAggregates
            .filter(d => d.date >= cutoffDateStr)
            .sort((a, b) => b.date.localeCompare(a.date));
    }

    /**
     * Compare current month to previous months
     */
    getMonthComparison(currentMonthRequests: number): { 
        currentMonth: string; 
        previousMonths: Array<{ month: string; requests: number; difference: number; percentChange: number }> 
    } | null {
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthlyHistory = this.getMonthlyHistory();

        if (monthlyHistory.length === 0) {
            return null;
        }

        const comparisons = monthlyHistory
            .filter(m => m.month !== currentMonth)
            .slice(0, 6) // Last 6 months
            .map(m => ({
                month: m.month,
                requests: m.totalRequests,
                difference: currentMonthRequests - m.totalRequests,
                percentChange: m.totalRequests > 0 
                    ? ((currentMonthRequests - m.totalRequests) / m.totalRequests) * 100 
                    : 0
            }));

        return {
            currentMonth,
            previousMonths: comparisons
        };
    }
}
