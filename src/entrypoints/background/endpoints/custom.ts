import * as v from 'valibot';
import type { UserStatus } from '@/lib/types/api';
import type { CustomApiConfig } from '@/lib/types/custom-api';
import { makeHttpRequest } from '../http-client';
import { CustomApiResponseEnvelopeSchema, parseUserStatusResponse } from '@/lib/schemas/custom-api';
import { logger } from '@/lib/utils/logging/logger';
import { validateEntityId, processBatchEntityIds } from '@/lib/utils/dom/sanitizer';

// Strip the {success, data?, error?} envelope used by custom APIs
function unwrapCustomApiResponse(payload: unknown): unknown {
	const result = v.safeParse(CustomApiResponseEnvelopeSchema, payload);
	if (!result.success) {
		throw new Error(
			'Invalid response format: must be {success: boolean, data?: unknown, error?: string}'
		);
	}
	if (!result.output.success) {
		throw new Error(result.output.error ?? 'API returned error without message');
	}
	if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
		throw new Error('Invalid response format: success=true but missing data field');
	}
	return result.output.data;
}

// Hits the custom API single endpoint and validates the {success, data} envelope plus the user-status schema
export async function customApiCheckUser(
	apiConfig: CustomApiConfig,
	userId: string | number
): Promise<UserStatus> {
	const sanitizedUserId = validateEntityId(userId);

	logger.debug('Background: Custom API check user', {
		apiId: apiConfig.id,
		apiName: apiConfig.name,
		userId: sanitizedUserId
	});

	const fullUrl = apiConfig.singleUrl.replace('{userId}', sanitizedUserId);

	return makeHttpRequest<UserStatus>(fullUrl, {
		method: 'GET',
		customApi: apiConfig,
		timeout: apiConfig.timeout,
		rawResponse: true,
		parse: (payload) => {
			const data = unwrapCustomApiResponse(payload);
			try {
				return parseUserStatusResponse(data) as UserStatus;
			} catch (error) {
				const summary = v.isValiError(error) ? v.summarize(error.issues) : String(error);
				throw new Error(`Invalid response schema: ${summary}`, { cause: error });
			}
		}
	});
}

// Posts batch IDs and validates each value of the response data object against the user-status schema
export async function customApiCheckMultipleUsers(
	apiConfig: CustomApiConfig,
	userIds: Array<string | number>
): Promise<UserStatus[]> {
	const sanitizedUserIds = processBatchEntityIds(userIds);

	logger.debug('Background: Custom API check multiple users', {
		apiId: apiConfig.id,
		apiName: apiConfig.name,
		count: sanitizedUserIds.length
	});

	return makeHttpRequest<UserStatus[]>(apiConfig.batchUrl, {
		method: 'POST',
		body: JSON.stringify({ ids: sanitizedUserIds.map((id) => Number.parseInt(id, 10)) }),
		customApi: apiConfig,
		timeout: apiConfig.timeout,
		rawResponse: true,
		parse: (payload) => {
			const data = unwrapCustomApiResponse(payload);
			if (!data || typeof data !== 'object' || Array.isArray(data)) {
				throw new Error('Batch response data must be an object with user IDs as keys');
			}
			try {
				return Object.values(data).map((entry) => parseUserStatusResponse(entry)) as UserStatus[];
			} catch (error) {
				const summary = v.isValiError(error) ? v.summarize(error.issues) : String(error);
				throw new Error(`Invalid response schema in batch: ${summary}`, { cause: error });
			}
		}
	});
}

interface WhoamiResponse {
	services: string[];
	endpoints: Record<string, { single: string; batch: string }>;
	label: string;
	fingerprint: string;
	isAdmin: boolean;
	rateLimitPerMinute: number;
	limits: Record<string, number>;
}

interface WhoamiApiResponse {
	success: boolean;
	data?: WhoamiResponse;
	error?: string;
}

export async function apiWhoami(
	apiKey: string
): Promise<{ success: boolean; data?: WhoamiResponse; error?: string }> {
	const apiDomain =
		process.env['NODE_ENV'] === 'development' || process.argv.includes('dev')
			? 'roprotect-dev.tlet.xyz'
			: 'roprotect.tlet.xyz';
	const url = `https://${apiDomain}/v1/whoami`;

	logger.debug('Background: API whoami', { apiKey: `${apiKey.slice(0, 8)}...` });

	try {
		const response = await makeHttpRequest<WhoamiResponse>(url, {
			method: 'GET',
			headers: {
				'X-Auth-Token': apiKey
			},
			timeout: 10_000,
			rawResponse: true,
			parse: (payload) => {
				const parsed = payload as WhoamiApiResponse;
				if (!parsed.success) {
					throw new Error(parsed.error ?? 'API returned error without message');
				}
				if (!parsed.data) {
					throw new Error('API returned success but missing data');
				}
				return parsed.data;
			}
		});

		return { success: true, data: response };
	} catch (error) {
		logger.error('API whoami failed:', error);
		const err = error as Error;
		return { success: false, error: err.message };
	}
}
