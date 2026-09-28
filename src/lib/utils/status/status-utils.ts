import type { UserStatus, GroupStatus } from '../../types/api';
import type { CombinedStatus, CustomApiResult } from '../../types/custom-api';
import { RO_PROTECT_API_ID } from '../../stores/custom-apis';
import { getAssetUrl } from '../assets';
import type { PublicPath } from 'wxt/browser';
import { REASON_KEYS, STATUS } from '../../types/constants';

export const FIRST_DETECTION_FLAG_TYPES = new Set<number>([
	STATUS.FLAGS.UNSAFE,
	STATUS.FLAGS.PENDING,
	STATUS.FLAGS.MIXED,
	STATUS.FLAGS.PROVISIONAL,
	STATUS.FLAGS.PAST_OFFENDER,
	STATUS.FLAGS.REDACTED
]);

// Create a CombinedStatus representing an error state (e.g., restricted access)
export function createErrorCombinedStatus<T extends UserStatus | GroupStatus>(
	error: string
): CombinedStatus<T> {
	const id = RO_PROTECT_API_ID;
	return new Map([
		[
			id,
			{
				apiId: id,
				apiName: 'RoProtect',
				error,
				loading: false,
				timestamp: Date.now(),
				landscapeImageDataUrl: getAssetUrl('/assets/sigmanet-dark.png' as PublicPath)
			}
		]
	]);
}

// Wrap GroupStatus in CombinedStatus structure for StatusIndicator
export function wrapGroupStatus(
	groupStatus: GroupStatus | null,
	isLoading = false,
	error?: string
): CombinedStatus<GroupStatus> | null {
	if (error) {
		return createErrorCombinedStatus<GroupStatus>(error);
	}

	if (isLoading) {
		const id = RO_PROTECT_API_ID;
		return new Map([
			[
				id,
				{
					apiId: id,
					apiName: 'RoProtect',
					loading: true,
					landscapeImageDataUrl: getAssetUrl('/assets/sigmanet-dark.png' as PublicPath)
				}
			]
		]);
	}

	if (!groupStatus) return null;

	const id = RO_PROTECT_API_ID;
	return new Map([
		[
			id,
			{
				apiId: id,
				apiName: 'RoProtect',
				data: groupStatus,
				loading: false,
				timestamp: Date.now(),
				landscapeImageDataUrl: getAssetUrl('/assets/sigmanet-dark.png' as PublicPath)
			}
		]
	]);
}

// Outfit-only requires the only reason to be AVATAR_OUTFIT and not be reportable or unsafe
export function calculateStatusBadges(status: UserStatus | null | undefined): StatusBadges {
	const isReportable = status?.isReportable ?? false;

	if (!status?.reasons) {
		return {
			isReportable,
			isOutfitOnly: false,
			hasCrossSignal: false
		};
	}

	const reasonTypes = Object.keys(status.reasons);
	const hasOutfitReason = reasonTypes.includes(REASON_KEYS.AVATAR_OUTFIT);
	const isOutfitOnly =
		hasOutfitReason &&
		reasonTypes.length === 1 &&
		!isReportable &&
		status.flagType !== STATUS.FLAGS.UNSAFE;

	const hasProfileReason = reasonTypes.includes(REASON_KEYS.USER_PROFILE);
	const hasCrossSignal = hasProfileReason && reasonTypes.length > 1;

	return {
		isReportable,
		isOutfitOnly,
		hasCrossSignal
	};
}

// True if any API result is in the actionable set (UNSAFE, PENDING, MIXED, REDACTED)
export function isFlagged<T extends UserStatus | GroupStatus>(
	status: CombinedStatus<T> | null
): boolean {
	if (!status) return false;
	return [...status.values()].some(isActionableResult);
}

// First actionable API result. Prefers system APIs in order: SIGMANET, RAB, TASE, then any custom API.
export function getFlaggingResult<T extends UserStatus | GroupStatus>(
	status: CombinedStatus<T> | null
): CustomApiResult<T> | undefined {
	if (!status) return undefined;

	// System APIs have priority in order: scsn > rab > tase
	const systemOrder = ['system-scsn', 'system-rab', 'system-tase'];

	for (const id of systemOrder) {
		const result = status.get(id);
		if (result && isActionableResult(result)) {
			return result;
		}
	}

	// Fall back to any other system API
	for (const [_id, result] of status.entries()) {
		if (result.apiId.startsWith('system-') && isActionableResult(result)) {
			return result;
		}
	}

	// Then any custom API
	for (const result of status.values()) {
		if (isActionableResult(result)) return result;
	}

	return undefined;
}

// The most severe actionable flagType any custom API reported, or null when none flagged.
// Ignores SAFE and non-actionable verdicts so callers can treat null as "no integration signal".
export function pickHighestSeverityCustomFlag<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T> | null
): number | null {
	if (!combined) return null;

	let worst: number | null = null;
	let worstRank = ACTIONABLE_FLAG_SEVERITY.length;

	for (const [apiId, result] of combined.entries()) {
		if (!result.data) continue;
		// Skip system APIs - we only want custom/user-configured APIs here
		if (apiId.startsWith('system-')) continue;
		const rank = ACTIONABLE_FLAG_SEVERITY.indexOf(result.data.flagType);
		if (rank === -1) continue;
		if (rank < worstRank) {
			worstRank = rank;
			worst = result.data.flagType;
		}
	}

	return worst;
}

// The custom API verdict to render when system APIs have nothing usable (unreachable or still
// pending). An actionable flag always wins so a partner detection is never downgraded to a
// SAFE-looking icon just because another provider answered first.
export function pickCustomApiFallback<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T> | null
): CustomApiResult<T> | undefined {
	if (!combined) return undefined;

	let firstWithData: CustomApiResult<T> | undefined;

	for (const [apiId, result] of combined.entries()) {
		if (apiId.startsWith('system-') || !result.data) continue;
		if (isActionableResult(result)) return result;
		firstWithData ??= result;
	}

	return firstWithData;
}

// Picks the first system API that has data, in priority order
export function pickFirstSystemApiResult<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T> | null
): CustomApiResult<T> | undefined {
	if (!combined) return undefined;

	const systemOrder = ['system-scsn', 'system-rab', 'system-tase'];

	for (const id of systemOrder) {
		const result = combined.get(id);
		if (result?.data) return result;
	}

	// Fall back to any system API with data
	for (const [id, result] of combined.entries()) {
		if (id.startsWith('system-') && result.data) return result;
	}

	return undefined;
}

const ACTIONABLE_FLAG_TYPES = new Set<number>([
	STATUS.FLAGS.UNSAFE,
	STATUS.FLAGS.PENDING,
	STATUS.FLAGS.MIXED,
	STATUS.FLAGS.REDACTED
]);

// Same actionable set ordered most severe first, so a user flagged by several custom APIs is
// bucketed by its worst verdict rather than by whichever API happened to answer first
const ACTIONABLE_FLAG_SEVERITY: readonly number[] = [
	STATUS.FLAGS.UNSAFE,
	STATUS.FLAGS.REDACTED,
	STATUS.FLAGS.MIXED,
	STATUS.FLAGS.PENDING
];

// Check if an individual API result has flagged the entity
export function isActionableResult<T extends UserStatus | GroupStatus>(
	result: CustomApiResult<T>
): boolean {
	return !!result.data && ACTIONABLE_FLAG_TYPES.has(result.data.flagType);
}

interface StatusBadges {
	isReportable: boolean;
	isOutfitOnly: boolean;
	hasCrossSignal: boolean;
}
