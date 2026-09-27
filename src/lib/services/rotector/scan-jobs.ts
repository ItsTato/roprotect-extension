import { fetchAllFriendIds } from '../roblox/friends';
import { fetchAllUserGroupIds } from '../roblox/groups';
import { groupStatusService } from './entity-status';
import { queryMultipleUsers } from './unified-query';
import { ROTECTOR_API_ID } from '../../stores/custom-apis';
import type { UserStatus } from '../../types/api';
import type { CombinedStatus } from '../../types/custom-api';
import { LOOKUP_CONTEXT, STATUS } from '../../types/constants';
import {
	calculateStatusBadges,
	pickHighestSeverityCustomFlag
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

// Picks one bucket per friend, applying outfit/queued overrides. Custom APIs are bucketed by the
// severity they actually reported instead of a single catch-all, but a non-flagged Rotector
// verdict never masks a partner's detection.
function combinedResultToCategory(combined: CombinedStatus<UserStatus>): ScanBucket {
	const data = combined.get(ROTECTOR_API_ID)?.data;
	const customFlagType = pickHighestSeverityCustomFlag(combined);
	const customCategory = customFlagType === null ? null : flagToCategory(customFlagType);
	const fromIntegration = customCategory !== null;

	// Rotector unreachable: still surface custom-API detections rather than dropping the entity,
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
	onProgress: (pct: number) => void,
	signal: AbortSignal
): Promise<ScanCounts> {
	const counts: ScanCounts = new Map();

	const friendIds = await fetchAllFriendIds(
		userId,
		(fetched) => onProgress(Math.min(fetched * 0.15, SCAN_PHASE_CHECK_START)),
		signal
	);

	if (friendIds.length === 0) return counts;

	onProgress(SCAN_PHASE_CHECK_START);

	const lookupContext = isOwnFriends ? LOOKUP_CONTEXT.FRIENDS : undefined;
	const completed = new Set<string>();
	const total = friendIds.length;

	const results = await queryMultipleUsers(
		friendIds.map((id) => id.toString()),
		{
			lookupContext,
			signal,
			onUpdate: (friendId, combined) => {
				const r = combined.get(ROTECTOR_API_ID);
				if (!r || r.loading || completed.has(friendId)) return;
				completed.add(friendId);
				const pct = SCAN_PHASE_CHECK_START + (completed.size / total) * SCAN_PHASE_CHECK_RANGE;
				onProgress(Math.min(pct, FRIEND_SCAN_PROGRESS_MAX));
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
	onProgress: (pct: number) => void,
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
