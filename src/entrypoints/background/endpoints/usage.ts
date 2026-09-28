import { API_CONFIG } from '@/lib/types/constants';
import { SETTINGS_KEYS } from '@/lib/types/settings';
import { parseUsageResponse } from '@/lib/schemas/usage';
import type { ApiUsage, UsageOutcomeCount, UsageServiceTotals } from '@/lib/types/usage';
import { getStorage } from '@/lib/utils/storage';
import { logger } from '@/lib/utils/logging/logger';
import { makeHttpRequest } from '../http-client';

const SERVICE_ORDER = ['scsn', 'rab', 'tase'] as const;

function emptyUsage(hasApiKey: boolean): ApiUsage {
	return {
		label: null,
		totalRequests: 0,
		successCount: 0,
		successRate: 0,
		avgLatencyMs: 0,
		outcomes: [],
		services: [],
		recentUserCount: 0,
		firstSeen: null,
		lastSeen: null,
		updatedAt: 0,
		trackedKeyCount: 0,
		hasApiKey
	};
}

// `/v1/usage` reports every key on the account, so pick the row belonging to the
// key this extension is configured with. Falls back to the only row when the
// account has a single key.
function selectKeyId(keyIds: string[], apiKey: string): string | null {
	const normalized = apiKey.trim();
	const exact = keyIds.find((id) => id === normalized);
	if (exact) return exact;
	const prefixed = keyIds.find((id) => normalized.startsWith(id));
	if (prefixed) return prefixed;
	return keyIds.length === 1 ? (keyIds[0] ?? null) : null;
}

function orderServices(services: UsageServiceTotals[]): UsageServiceTotals[] {
	return services.toSorted((a, b) => {
		const aIndex = SERVICE_ORDER.indexOf(a.service as (typeof SERVICE_ORDER)[number]);
		const bIndex = SERVICE_ORDER.indexOf(b.service as (typeof SERVICE_ORDER)[number]);
		if (aIndex === -1 && bIndex === -1) return a.service.localeCompare(b.service);
		if (aIndex === -1) return 1;
		if (bIndex === -1) return -1;
		return aIndex - bIndex;
	});
}

export async function getApiUsage(): Promise<ApiUsage> {
	const storedApiKey = await getStorage<string>('sync', SETTINGS_KEYS.API_KEY, '');
	const apiKey = storedApiKey.trim();
	if (!apiKey) {
		return emptyUsage(false);
	}

	try {
		const response = await makeHttpRequest(API_CONFIG.ENDPOINTS.USAGE, {
			method: 'GET',
			// The endpoint answers with a bare object rather than the `{data}` envelope.
			rawResponse: true,
			parse: parseUsageResponse
		});

		const keyIds = Object.keys(response.keys);
		const selectedId = selectKeyId(keyIds, apiKey);
		const entry = selectedId === null ? undefined : response.keys[selectedId];

		if (!entry) {
			logger.warn('[Background] Usage response had no entry for the configured key', {
				trackedKeyCount: keyIds.length
			});
			return { ...emptyUsage(true), updatedAt: response.updatedAt };
		}

		const outcomes: UsageOutcomeCount[] = Object.entries(entry.byOutcome)
			.map(([outcome, count]) => ({ outcome, count }))
			.toSorted((a, b) => b.count - a.count);

		const services = orderServices(
			Object.entries(entry.byService).map(([service, totals]) => {
				const single = totals?.single ?? 0;
				const batch = totals?.batch ?? 0;
				return { service, single, batch, total: single + batch };
			})
		);

		const successCount = entry.byOutcome['ok'] ?? 0;
		const totalRequests = entry.totalRequests;

		return {
			label: entry.label,
			totalRequests,
			successCount,
			successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 0,
			avgLatencyMs: entry.avgLatencyMs,
			outcomes,
			services,
			// Only the count is surfaced; the ids stay in the background.
			recentUserCount: entry.recentUserIds.length,
			firstSeen: entry.firstSeen,
			lastSeen: entry.lastSeen,
			updatedAt: response.updatedAt,
			trackedKeyCount: keyIds.length,
			hasApiKey: true
		};
	} catch (error) {
		logger.error('[Background] Failed to load API usage:', {
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
