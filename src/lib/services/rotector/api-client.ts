import { API_ACTIONS } from '../../types/constants';
import type {
	ApiResponse,
	ExportResult,
	GroupStatus,
	GroupTrackedUsersResponse,
	MembershipBadgeUpdatePayload,
	MembershipStatus,
	MembershipVerificationChallenge,
	OutfitSnapshotByIdResponse,
	OutfitSnapshotByNameResponse,
	QueueLimitsData,
	QueueResult,
	RequestOptions,
	RobloxUserDiscordLookup,
	TranslationResult,
	UserStatus
} from '../../types/api';
import type { ApiUsage } from '../../types/usage';
import { restrictedAccessStore } from '../../stores/restricted-access';
import { getAbortError } from '../../utils/abort';
import { buildResponseError } from '../../utils/api/api-error';
import { getLoggedInUserId } from '../../utils/client-id';
import { get } from 'svelte/store';
import { logger } from '../../utils/logging/logger';

// The background HTTP layer owns retries + Retry-After + safe-method gating
// Stacking retries here on top of that produced MAX_RETRIES² fetches per failure
async function sendMessage<T>(
	action: string,
	data: Record<string, unknown> = {},
	options: RequestOptions = {}
): Promise<T> {
	if (options.signal?.aborted) {
		throw getAbortError(options.signal);
	}

	const clientId = getLoggedInUserId();
	const message = { action, ...(clientId && { clientId }), ...data };
	const response: ApiResponse<T> = await browser.runtime.sendMessage(message);

	if (response.success) {
		return response.data as T;
	}
	throw buildResponseError(response);
}

class RotectorApiClient {
	async checkUser(userId: string | number, options?: RequestOptions): Promise<UserStatus> {
		return sendMessage<UserStatus>(
			API_ACTIONS.CHECK_USER_STATUS,
			{ userId, ...(options?.apiConfig && { apiConfig: options.apiConfig }) },
			options
		);
	}

	async checkGroup(groupId: string | number, options?: RequestOptions): Promise<GroupStatus> {
		return sendMessage<GroupStatus>(API_ACTIONS.CHECK_GROUP_STATUS, { groupId }, options);
	}

	async checkMultipleUsers(
		userIds: Array<string | number>,
		options: RequestOptions = {}
	): Promise<UserStatus[]> {
		return sendMessage<UserStatus[]>(
			API_ACTIONS.CHECK_MULTIPLE_USERS,
			{
				userIds,
				...(options.apiConfig && { apiConfig: options.apiConfig }),
				...(options.lookupContext && { lookupContext: options.lookupContext })
			},
			options
		);
	}

	async checkMultipleGroups(
		groupIds: Array<string | number>,
		options: RequestOptions = {}
	): Promise<GroupStatus[]> {
		return sendMessage<GroupStatus[]>(
			API_ACTIONS.CHECK_MULTIPLE_GROUPS,
			{
				groupIds,
				...(options.lookupContext && { lookupContext: options.lookupContext })
			},
			options
		);
	}

	async getGroupTrackedUsers(
		groupId: string | number,
		cursor?: string,
		limit = 24,
		active?: 'true' | 'false'
	): Promise<GroupTrackedUsersResponse> {
		return sendMessage<GroupTrackedUsersResponse>(API_ACTIONS.GET_GROUP_TRACKED_USERS, {
			groupId,
			cursor,
			limit,
			active
		});
	}

	async queueUser(
		userId: string | number,
		outfitNames: string[] = [],
		outfitIds: number[] = [],
		inappropriateProfile = false,
		inappropriateFriends = false,
		inappropriateGroups = false,
		captchaToken?: string
	): Promise<QueueResult> {
		const { isRestricted } = get(restrictedAccessStore);
		if (isRestricted) {
			const loggedInUserId = getLoggedInUserId();
			if (loggedInUserId !== userId.toString()) {
				throw new Error('Cannot queue users while access is restricted');
			}
		}

		return sendMessage<QueueResult>(API_ACTIONS.QUEUE_USER, {
			userId,
			outfitNames,
			outfitIds,
			inappropriateProfile,
			inappropriateFriends,
			inappropriateGroups,
			captchaToken
		});
	}

	async getQueueLimits(): Promise<QueueLimitsData> {
		return sendMessage<QueueLimitsData>(API_ACTIONS.GET_QUEUE_LIMITS, {});
	}

	async getUsage(): Promise<ApiUsage> {
		return sendMessage<ApiUsage>(API_ACTIONS.GET_USAGE, {});
	}

	async getMembershipStatus(): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(API_ACTIONS.EXTENSION_GET_MEMBERSHIP_STATUS, {});
	}

	async updateMembershipBadge(payload: MembershipBadgeUpdatePayload): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(
			API_ACTIONS.EXTENSION_UPDATE_MEMBERSHIP_BADGE,
			payload as Record<string, unknown>
		);
	}

	async clearMembershipBadge(): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(API_ACTIONS.EXTENSION_CLEAR_MEMBERSHIP_BADGE, {});
	}

	async getMembershipVerification(robloxUserId: number): Promise<MembershipVerificationChallenge> {
		return sendMessage<MembershipVerificationChallenge>(
			API_ACTIONS.EXTENSION_GET_MEMBERSHIP_VERIFICATION,
			{ robloxUserId }
		);
	}

	async confirmMembershipVerification(robloxUserId: number): Promise<MembershipStatus> {
		return sendMessage<MembershipStatus>(API_ACTIONS.EXTENSION_CONFIRM_MEMBERSHIP_VERIFICATION, {
			robloxUserId
		});
	}

	async translateTexts(
		texts: string[],
		targetLanguage: string,
		sourceLanguage = 'en'
	): Promise<TranslationResult> {
		return sendMessage<TranslationResult>(API_ACTIONS.TRANSLATE_TEXT, {
			texts,
			targetLanguage,
			sourceLanguage
		});
	}

	async exportGroupTrackedUsers(
		groupId: string | number,
		format: 'json' | 'csv',
		columns: string[],
		sort: string,
		order: 'asc' | 'desc'
	): Promise<ExportResult> {
		return sendMessage<ExportResult>(API_ACTIONS.EXPORT_GROUP_TRACKED_USERS, {
			groupId,
			exportFormat: format,
			exportColumns: columns,
			exportSort: sort,
			exportOrder: order
		});
	}

	async lookupRobloxUserDiscord(userId: string | number): Promise<RobloxUserDiscordLookup> {
		return sendMessage<RobloxUserDiscordLookup>(API_ACTIONS.LOOKUP_ROBLOX_USER_DISCORD, {
			userId
		});
	}

	async lookupOutfitsByName(
		userId: string | number,
		names: string[]
	): Promise<OutfitSnapshotByNameResponse> {
		return sendMessage<OutfitSnapshotByNameResponse>(API_ACTIONS.LOOKUP_OUTFITS_BY_NAME, {
			userId,
			names
		});
	}

	async lookupOutfitsById(
		userId: string | number,
		ids: string[]
	): Promise<OutfitSnapshotByIdResponse> {
		return sendMessage<OutfitSnapshotByIdResponse>(API_ACTIONS.LOOKUP_OUTFITS_BY_ID, {
			userId,
			ids
		});
	}

	async fetchOutfitImages(imageUrls: string[]): Promise<Array<string | null>> {
		return sendMessage<Array<string | null>>(API_ACTIONS.FETCH_OUTFIT_IMAGES, {
			imageUrls
		});
	}

	async whoami(apiKey: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
		logger.debug('[apiClient] whoami called', {
			apiKeyPrefix: `${apiKey.slice(0, 8)}...`,
			apiKeyLength: apiKey.length
		});
		const result = await sendMessage<{ success: boolean; data?: unknown; error?: string }>(
			API_ACTIONS.API_WHOAMI,
			{ apiKey }
		);
		logger.debug('[apiClient] whoami response', {
			success: result.success,
			hasError: !!result.error,
			hasData: !!result.data,
			error: result.error
		});
		return result;
	}
}

export const apiClient = new RotectorApiClient();
