import type { CombinedStatus, CustomApiConfig, CustomApiResult } from '../../types/custom-api';
import type { GroupStatus, UserStatus } from '../../types/api';
import { apiClient } from './api-client';
import { customApis } from '../../stores/custom-apis';
import { restrictedAccessStore } from '../../stores/restricted-access';
import { settings } from '../../stores/settings';
import { getLoggedInUserId } from '../../utils/client-id';
import { logger } from '../../utils/logging/logger';
import { startTrace } from '../../utils/logging/perf-tracer';
import { TRACE_CATEGORIES } from '../../types/performance';
import { chunkArray } from '../../utils/array';
import { abortableSleep, getAbortError } from '../../utils/abort';
import { parseUserStatus } from '../../schemas/rotector';
import { asApiError } from '../../utils/api/api-error';
import { API_CONFIG, LOOKUP_CONTEXT, STATUS } from '../../types/constants';
import { SETTINGS_KEYS } from '../../types/settings';
import {
	isActionableResult,
	pickHighestSeveritySystemResult
} from '../../utils/status/status-utils';
import { get } from 'svelte/store';

interface QueryMultipleUsersOptions {
	lookupContext?: string | undefined;
	signal?: AbortSignal | undefined;
	onUpdate?: ((userId: string, status: CombinedStatus<UserStatus>) => void) | undefined;
}

const SYSTEM_API_IDS = ['system-scsn', 'system-rab', 'system-tase'] as const;

function shouldBlockLookup(userId: string): boolean {
	const { isRestricted } = get(restrictedAccessStore);
	return isRestricted && getLoggedInUserId() !== userId;
}

function createRestrictedResult(): CombinedStatus<UserStatus> {
	const enabledApis = getEnabledCustomApis();
	return new Map(
		enabledApis.map((api) => [
			api.id,
			{
				apiId: api.id,
				apiName: api.name,
				error: 'restricted_access',
				loading: false,
				timestamp: Date.now(),
				landscapeImageDataUrl: api.landscapeImageDataUrl
			}
		])
	);
}

export function getEnabledCustomApis(): CustomApiConfig[] {
	const s = get(settings);
	const experimentalCustomApisEnabled = s[SETTINGS_KEYS.EXPERIMENTAL_CUSTOM_APIS_ENABLED];

	return get(customApis)
		.filter((api) => api.enabled && (api.isSystem || experimentalCustomApisEnabled))
		.toSorted((a, b) => a.order - b.order);
}

export function isSystemApi(api: CustomApiConfig): boolean {
	return !!api.isSystem && SYSTEM_API_IDS.includes(api.id as (typeof SYSTEM_API_IDS)[number]);
}

// Query a single user with progressive updates as each API completes
export function queryUserProgressive(
	userId: string,
	onUpdate: (status: CombinedStatus<UserStatus>) => void
): () => void {
	if (shouldBlockLookup(userId)) {
		onUpdate(createRestrictedResult());
		return () => {};
	}

	const enabledApis = getEnabledCustomApis();
	const controller = new AbortController();

	// Handle case where no APIs are enabled - return a "no APIs" status
	if (enabledApis.length === 0) {
		const noApisStatus = new Map<string, CustomApiResult<UserStatus>>([
			[
				'no-apis',
				{
					apiId: 'no-apis',
					apiName: 'No APIs Configured',
					error: 'No APIs available. Enter your RoProtect API key in the extension settings.',
					loading: false,
					timestamp: Date.now(),
					landscapeImageDataUrl: ''
				}
			]
		]);
		onUpdate(noApisStatus);
		return () => controller.abort();
	}

	const apiResults = new Map<string, CustomApiResult<UserStatus>>(
		enabledApis.map((api) => [
			api.id,
			{
				apiId: api.id,
				apiName: api.name,
				loading: true,
				landscapeImageDataUrl: api.landscapeImageDataUrl
			}
		])
	);
	onUpdate(new Map(apiResults));

	enabledApis.forEach(async (api) => {
		const apiSignal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(API_CONFIG.PROGRESSIVE_API_TIMEOUT)
		]);
		const base = {
			apiId: api.id,
			apiName: api.name,
			loading: false,
			timestamp: Date.now(),
			landscapeImageDataUrl: api.landscapeImageDataUrl
		};
		try {
			const result = await apiClient.checkUser(userId, {
				apiConfig: api,
				signal: apiSignal
			});

			if (controller.signal.aborted) return;

			apiResults.set(api.id, { ...base, data: result });
			onUpdate(new Map(apiResults));
		} catch (error) {
			if (controller.signal.aborted) return;

			apiResults.set(api.id, {
				...base,
				error: asApiError(error).message
			});
			onUpdate(new Map(apiResults));
		}
	});

	return () => {
		controller.abort();
	};
}

// Fans user IDs across every enabled API, routing system APIs through the cache-aware userStatusService and honoring restricted-access mode
export async function queryMultipleUsers(
	userIds: string[],
	options?: QueryMultipleUsersOptions
): Promise<Map<string, CombinedStatus<UserStatus>>> {
	const lookupContext = options?.lookupContext;
	const signal = options?.signal;
	const onUpdate = options?.onUpdate;

	if (signal?.aborted) {
		throw getAbortError(signal);
	}

	const { isRestricted } = get(restrictedAccessStore);
	if (isRestricted && lookupContext !== LOOKUP_CONTEXT.FRIENDS) {
		const restrictedResult = createRestrictedResult();
		return new Map(userIds.map((userId) => [userId, restrictedResult]));
	}

	const endTrace = startTrace(TRACE_CATEGORIES.API, 'queryMultipleUsers', {
		userCount: userIds.length,
		lookupContext
	});
	const enabledApis = getEnabledCustomApis();

	// Handle case where no APIs are enabled
	if (enabledApis.length === 0) {
		const noApisStatus = new Map<string, CustomApiResult<UserStatus>>([
			[
				'no-apis',
				{
					apiId: 'no-apis',
					apiName: 'No APIs Configured',
					error: 'No APIs available. Enter your RoProtect API key in the extension settings.',
					loading: false,
					timestamp: Date.now(),
					landscapeImageDataUrl: ''
				}
			]
		]);
		return new Map(userIds.map((userId) => [userId, new Map(noApisStatus)]));
	}

	const results = new Map<string, CombinedStatus<UserStatus>>();
	for (const userId of userIds) {
		results.set(
			userId,
			new Map(
				enabledApis.map((api) => [
					api.id,
					{
						apiId: api.id,
						apiName: api.name,
						loading: true,
						landscapeImageDataUrl: api.landscapeImageDataUrl
					}
				])
			)
		);
	}

	const setApiResult = (
		userId: string,
		api: CustomApiConfig,
		partial: { data?: UserStatus; error?: string }
	) => {
		const combined = results.get(userId);
		if (!combined) return;
		combined.set(api.id, {
			apiId: api.id,
			apiName: api.name,
			...partial,
			loading: false,
			timestamp: Date.now(),
			landscapeImageDataUrl: api.landscapeImageDataUrl
		});
		onUpdate?.(userId, new Map(combined));
	};

	const systemApis = enabledApis.filter(isSystemApi);
	const customApisList = enabledApis.filter((api) => !isSystemApi(api));

	// A batch response omits users the upstream has no record of. Left unset, that entry
	// would carry neither data nor error with loading already false, which is
	// indistinguishable from a request still in flight and leaves the UI on "Checking..."
	// forever. The single-lookup endpoint reports those same users as flagType SAFE, so
	// mirror that rather than inventing an error.
	const resolveBatchEntry = (userId: string, userStatus: UserStatus | undefined): UserStatus =>
		userStatus ?? parseUserStatus({ id: Number.parseInt(userId, 10), flagType: STATUS.FLAGS.SAFE });

	logger.debug('Unified batch query starting:', {
		userCount: userIds.length,
		totalApis: enabledApis.length,
		systemApis: systemApis.map((a) => a.id),
		customApis: customApisList.map((a) => a.id)
	});

	const systemPromise = (async () => {
		if (systemApis.length === 0) return;

		// Fire each system provider's batched fetch in parallel. Requests within
		// the same provider remain sequential via chunking + BATCH_DELAY.
		await Promise.all(
			systemApis.map(async (api) => {
				const toFetch: string[] = [];
				for (const userId of userIds) {
					toFetch.push(userId);
				}
				if (toFetch.length === 0) return;

				const processChunk = async (chunk: string[]): Promise<void> => {
					try {
						const apiStatuses = await apiClient.checkMultipleUsers(chunk, {
							apiConfig: api,
							signal,
							lookupContext
						});
						if (signal?.aborted) return;
						const userMap = new Map(apiStatuses.map((s) => [s.id.toString(), s]));
						for (const userId of chunk) {
							setApiResult(userId, api, { data: resolveBatchEntry(userId, userMap.get(userId)) });
						}
					} catch (error) {
						if (signal?.aborted) return;
						const errorMessage = asApiError(error).message;
						for (const userId of chunk) {
							setApiResult(userId, api, { error: errorMessage });
						}
						logger.error('System API batch error:', {
							apiId: api.id,
							apiName: api.name,
							chunkSize: chunk.length,
							error: errorMessage
						});
					}
				};

				const chunks = chunkArray(toFetch, API_CONFIG.BATCH_SIZE);
				for (const [i, chunk] of chunks.entries()) {
					if (i > 0) await abortableSleep(API_CONFIG.BATCH_DELAY, signal);
					if (signal?.aborted) throw getAbortError(signal);
					await processChunk(chunk);
				}
			})
		);
	})();

	const customPromise = (async () => {
		if (customApisList.length === 0) return;
		const chunks = chunkArray(userIds, API_CONFIG.BATCH_SIZE);

		for (const [i, chunk] of chunks.entries()) {
			if (i > 0) {
				await abortableSleep(API_CONFIG.BATCH_DELAY, signal);
			}
			if (signal?.aborted) throw getAbortError(signal);

			await Promise.all(
				customApisList.map(async (api) => {
					try {
						const apiStatuses = await apiClient.checkMultipleUsers(chunk, {
							signal,
							apiConfig: api
						});
						if (signal?.aborted) return;
						const userMap = new Map(apiStatuses.map((s) => [s.id.toString(), s]));
						for (const userId of chunk) {
							setApiResult(userId, api, {
								data: resolveBatchEntry(userId, userMap.get(userId))
							});
						}
					} catch (error) {
						if (signal?.aborted) return;
						const errorMessage = asApiError(error).message;
						for (const userId of chunk) {
							setApiResult(userId, api, { error: errorMessage });
						}
						logger.error('Custom API batch error:', {
							chunkSize: chunk.length,
							apiId: api.id,
							apiName: api.name,
							error: errorMessage
						});
					}
				})
			);
		}
	})();

	await Promise.all([systemPromise, customPromise]);

	if (signal?.aborted) throw getAbortError(signal);

	logger.debug('Unified batch query completed:', {
		userCount: userIds.length,
		totalApis: enabledApis.length
	});

	endTrace();
	return results;
}

export function countCustomApiFlags<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T>
): number {
	let count = 0;
	for (const [apiId, result] of combined.entries()) {
		if (apiId.startsWith('system-')) continue;
		if (isActionableResult(result)) count++;
	}
	return count;
}

// Choose the default active tab for a combined status
export function pickDefaultTab<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T>,
	preferred: string | undefined
): string | null {
	if (preferred && combined.has(preferred)) return preferred;

	const values = [...combined.values()];
	const allSettled = values.every((result) => !result.loading);
	if (!allSettled) return null;

	// Open on the most severe provider verdict rather than the first to answer, so a clean
	// SIGMANET result cannot mask a TASE detection on the user's own tooltip
	const worstSystem = pickHighestSeveritySystemResult(combined);
	if (worstSystem) return worstSystem[0];

	// Fall back to first custom API with a detection
	const firstCustomWithDetection = [...combined.entries()].find(
		([id, result]) =>
			!id.startsWith('system-') && result.data && result.data.flagType !== STATUS.FLAGS.SAFE
	);

	if (firstCustomWithDetection) {
		return firstCustomWithDetection[0];
	}

	// Fall back to first system API (even if no data)
	for (const id of SYSTEM_API_IDS) {
		if (combined.has(id)) return id;
	}

	// Fall back to first custom API
	for (const [id] of combined.entries()) {
		if (!id.startsWith('system-')) return id;
	}

	return null;
}
