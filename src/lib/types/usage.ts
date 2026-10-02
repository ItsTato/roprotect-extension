import type * as v from 'valibot';
import type { UsageResponseSchema } from '../schemas/usage';

export type UsageResponse = v.InferOutput<typeof UsageResponseSchema>;

export interface UsageServiceTotals {
	service: string;
	single: number;
	batch: number;
	total: number;
}

export interface UsageOutcomeCount {
	outcome: string;
	count: number;
}

// Popup-facing projection of `/v1/usage`. Raw key ids and scanned user ids are
// dropped in the background so they never travel over the message channel.
export interface ApiUsage {
	label: string | null;
	totalRequests: number;
	successCount: number;
	successRate: number;
	avgLatencyMs: number;
	outcomes: UsageOutcomeCount[];
	services: UsageServiceTotals[];
	recentUserCount: number;
	firstSeen: number | null;
	lastSeen: number | null;
	updatedAt: number;
	trackedKeyCount: number;
	hasApiKey: boolean;
}
