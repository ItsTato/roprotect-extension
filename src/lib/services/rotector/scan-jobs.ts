import { fetchAllFriendIds } from '../roblox/friends';
import { fetchAllUserGroupIds } from '../roblox/groups';
import { groupStatusService } from './entity-status';
import { queryMultipleUsers, getEnabledCustomApis, isSystemApi } from './unified-query';
import { getAssetUrl } from '../../utils/assets';
import type { UserStatus } from '../../types/api';
import type { CombinedStatus, CustomApiResult, CustomApiConfig } from '../../types/custom-api';
import { LOOKUP_CONTEXT, STATUS } from '../../types/constants';
import {
	calculateStatusBadges,
	pickHighestSeverityCustomFlag,
	pickHighestSeveritySystemResult
} from '../../utils/status/status-utils';

const SCAN_PHASE_CHECK_START = 30;
const SCAN_PHASE_CHECK_RANGE = 70;
const FRIEND_SCAN_PROGRESS_MAX = 95;

export type ScanCategory =
	| 'unsafe'
	| 'redacted'
	| 'mixed'
	| 'pending'
	| 'past'
	| 'provisional'
	| 'queued'
	| 'outfit'
	| 'integration'
	| 'unknown'
	| 'safe';
export type ScanCounts = Map<ScanCategory, number>;

// Per-provider resolution counts surfaced alongside the percentage so the bar
// can show e.g. "(65/248 SIGMANET, 80/248 RAB, 20/248 TASE)".
export interface ScanProviderProgress {
	apiId: string;
	apiName: string;
	logoUrl: string;
	fallbackLogoUrl: string;
	resolved: number;
}

export interface ScanProgressDetail {
	total: number;
	providers: ScanProviderProgress[];
}

export type ScanProgressCallback = (pct: number, detail?: ScanProgressDetail) => void;

// Dedicated readout-only logos for the scan progress chips. These deliberately
// differ from the provider's landscapeImageDataUrl (used by tooltip tabs etc):
// small circular crops that stay legible at 14px.
// Drop the provider's cropped readout logo at this path and `wxt prepare` will
// pick it up as a valid PublicPath (until then the cast below stands in).
const SCAN_PROVIDER_LOGO_OVERRIDES: Record<string, string> = {
	'system-pasc': getAssetUrl('/assets/pasc-scan.png'),
	'system-scsn': getAssetUrl('/assets/scsn-scan.png'),
	'system-rab': getAssetUrl('/assets/rab-scan.png'),
	'system-tase': getAssetUrl('/assets/tase-scan.png')
};
const PROVIDER_ORDER = ['system-scsn', 'system-rab', 'system-tase', 'system-pasc'];
// Deterministic display order regardless of store ordering. Unknown ids sort
// last so a future provider never jumps ahead of the known ones.
function sortProviders<T extends { apiId: string }>(providers: T[]): T[] {
	const orderOf = (apiId: string): number => {
		const index = PROVIDER_ORDER.indexOf(apiId);
		return index === -1 ? PROVIDER_ORDER.length : index;
	};
	return [...providers].toSorted((a, b) => orderOf(a.apiId) - orderOf(b.apiId));
}

// PASC always renders in the strip, whether or not whoami reports it: a
// display-only entry that never enters the progress denominator.
function withPascChip(providers: ScanProviderProgress[]): ScanProviderProgress[] {
	if (providers.some((p) => p.apiId === 'system-pasc')) return providers;
	return sortProviders([
		...providers,
		{
			apiId: 'system-pasc',
			apiName: 'PASC',
			logoUrl: getAssetUrl('/assets/pasc-scan.png'),
			fallbackLogoUrl: '',
			resolved: 0
		}
	]);
}

// Zeroed readout for the friend-ID fetch phase (0→30%), so the provider strip
// renders from the start instead of waiting for the first batch answer.
// Always includes the PASC chip, even with no system provider accessible.
function buildZeroedDetail(total: number): ScanProgressDetail {
	const systemApis = getEnabledCustomApis().filter(isSystemApi);
	const providers = sortProviders(
		systemApis.map((api) => ({
			apiId: api.id,
			apiName: api.name,
			logoUrl: SCAN_PROVIDER_LOGO_OVERRIDES[api.id] ?? api.landscapeImageDataUrl ?? '',
			fallbackLogoUrl: api.landscapeImageDataUrl ?? '',
			resolved: 0
		}))
	);
	return { total, providers: withPascChip(providers) };
}

function flagToCategory(flagType: number): ScanCategory {
	switch (flagType) {
		case STATUS.FLAGS.PENDING: {
			return 'pending';
		}
		case STATUS.FLAGS.UNSAFE: {
			return 'unsafe';
		}
		case STATUS.FLAGS.REDACTED: {
			return 'redacted';
		}
		case STATUS.FLAGS.MIXED: {
			return 'mixed';
		}
		case STATUS.FLAGS.PAST_OFFENDER: {
			return 'past';
		}
		case STATUS.FLAGS.PROVISIONAL: {
			return 'provisional';
		}
		case STATUS.FLAGS.QUEUED: {
			return 'queued';
		}
		case STATUS.FLAGS.SAFE: {
			return 'safe';
		}
		default: {
			return 'unknown';
		}
	}
}

// One bucket per friend, plus whether a custom API was among the sources that flagged them
interface ScanBucket {
	category: ScanCategory | null;
	fromIntegration: boolean;
}

// The system provider whose verdict represents the friend: the most severe one across
// SIGMANET/RAB/TASE, so a clean service cannot mask a detection from a sibling one.
function getSystemApiResult(
	combined: CombinedStatus<UserStatus>
): Pick<CustomApiResult<UserStatus>, 'data' | 'error' | 'loading'> | null {
	const worst = pickHighestSeveritySystemResult(combined);
	if (!worst) return null;
	const result = worst[1];
	return { data: result.data, error: result.error, loading: result.loading };
}

// Picks one bucket per friend, applying outfit/queued overrides. Custom APIs are bucketed by the
// severity they actually reported instead of a single catch-all, but a non-flagged system API
// verdict never masks a partner's detection.
function combinedResultToCategory(combined: CombinedStatus<UserStatus>): ScanBucket {
	const systemResult = getSystemApiResult(combined);
	const data = systemResult?.data;
	const customFlagType = pickHighestSeverityCustomFlag(combined);
	const customCategory = customFlagType === null ? null : flagToCategory(customFlagType);
	const fromIntegration = customCategory !== null;

	// System APIs unreachable: still surface custom-API detections rather than dropping the entity,
	// which would both hide the only available signal and shrink the scan total.
	if (!data) {
		return { category: customCategory, fromIntegration };
	}

	if (calculateStatusBadges(data).isOutfitOnly && customCategory === null) {
		return { category: 'outfit', fromIntegration };
	}

	const isProcessedQueue = data.flagType === STATUS.FLAGS.QUEUED && data.processed === true;
	const category = isProcessedQueue ? 'safe' : flagToCategory(data.flagType);

	// 'safe' and 'outfit' are both non-flagged verdicts, so a partner's detection outranks them
	// and inherits the severity it reported
	if (customCategory !== null && (category === 'safe' || category === 'outfit')) {
		return { category: customCategory, fromIntegration };
	}

	return { category, fromIntegration };
}

function increment(counts: ScanCounts, category: ScanCategory): void {
	counts.set(category, (counts.get(category) ?? 0) + 1);
}

export async function scanFriendsForUser(
	userId: string,
	isOwnFriends: boolean,
	onProgress: ScanProgressCallback,
	signal: AbortSignal
): Promise<ScanCounts> {
	const counts: ScanCounts = new Map();

	const friendIds = await fetchAllFriendIds(
		userId,
		(fetched) => {
			onProgress(Math.min(fetched * 0.15, SCAN_PHASE_CHECK_START), buildZeroedDetail(fetched));
		},
		signal
	);

	if (friendIds.length === 0) return counts;

	onProgress(SCAN_PHASE_CHECK_START, buildZeroedDetail(friendIds.length));

	const lookupContext = isOwnFriends ? LOOKUP_CONTEXT.FRIENDS : undefined;
	const completed = new Set<string>();
	const total = friendIds.length;

	const results = await queryMultipleUsers(
		friendIds.map((id) => id.toString()),
		{
			lookupContext,
			signal,
			onUpdate: (friendId, combined, providers) => {
				// Completion tracks every enabled API the user can actually access —
				// system providers plus custom ones — so a friend counts once all of
				// *their* sources have answered, whichever those are.
				const enabledIds: string[] = getEnabledCustomApis().map((api: CustomApiConfig) => api.id);
				if (enabledIds.length === 0) return; // no APIs configured at all

				const allResolved = enabledIds.every((id: string) => {
					const result = combined.get(id);
					return result && !result.loading;
				});
				if (allResolved && !completed.has(friendId)) {
					completed.add(friendId);
				}

				// Advance on ANY provider's answers, not just fully-resolved friends:
				// holding the bar until the slowest provider finishes its first chunk
				// is what pinned it at 30%. System providers report per-provider counts;
				// with none accessible (custom-only), fall back to per-friend completion.
				if (providers.length === 0) {
					const pct = SCAN_PHASE_CHECK_START + (completed.size / total) * SCAN_PHASE_CHECK_RANGE;
					onProgress(Math.min(pct, FRIEND_SCAN_PROGRESS_MAX));
					return;
				}
				const resolvedSum = providers.reduce((sum, p) => sum + p.resolved, 0);
				const pct =
					SCAN_PHASE_CHECK_START +
					(resolvedSum / (total * providers.length)) * SCAN_PHASE_CHECK_RANGE;
				const detail: ScanProgressDetail = {
					total,
					providers: withPascChip(
						sortProviders(providers).map((p) => ({
							apiId: p.apiId,
							apiName: p.apiName,
							logoUrl: SCAN_PROVIDER_LOGO_OVERRIDES[p.apiId] ?? p.logoUrl,
							fallbackLogoUrl: p.logoUrl,
							resolved: p.resolved
						}))
					)
				};
				onProgress(Math.min(pct, FRIEND_SCAN_PROGRESS_MAX), detail);
			}
		}
	);

	for (const combined of results.values()) {
		const { category, fromIntegration } = combinedResultToCategory(combined);
		if (category) increment(counts, category);
		// Overlaps the severity buckets above, so the scan bar keeps it out of its total
		if (fromIntegration) increment(counts, 'integration');
	}

	return counts;
}

export async function scanGroupsForUser(
	userId: string,
	onProgress: ScanProgressCallback,
	signal: AbortSignal
): Promise<ScanCounts> {
	const counts: ScanCounts = new Map();

	const groupIds = await fetchAllUserGroupIds(
		userId,
		(fetched) => onProgress(Math.min(fetched * 0.15, SCAN_PHASE_CHECK_START)),
		signal
	);

	if (groupIds.length === 0) return counts;

	onProgress(SCAN_PHASE_CHECK_START);

	const results = await groupStatusService.getStatuses(
		groupIds.map((id) => id.toString()),
		{
			lookupContext: LOOKUP_CONTEXT.GROUPS,
			signal,
			onProgress: (completed, total) => {
				onProgress(SCAN_PHASE_CHECK_START + (completed / total) * SCAN_PHASE_CHECK_RANGE);
			}
		}
	);

	for (const status of results.values()) {
		if (!status) continue;
		increment(counts, flagToCategory(status.flagType));
	}

	return counts;
}
