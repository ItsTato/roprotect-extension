import type { UserStatus, GroupStatus } from '../../types/api';
import type { CombinedStatus, CustomApiResult } from '../../types/custom-api';
import { RO_PROTECT_API_ID } from '../../stores/custom-apis';
import { getAssetUrl } from '../assets';
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
				landscapeImageDataUrl: getAssetUrl('/assets/sigmanet-dark.png')
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
					landscapeImageDataUrl: getAssetUrl('/assets/sigmanet-dark.png')
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
				landscapeImageDataUrl: getAssetUrl('/assets/sigmanet-dark.png')
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

// True if any API result is in the actionable set (UNSAFE, PENDING, MIXED, REDACTED).
// A present PASC record is authoritative: its verdict replaces the other providers
// everywhere, including downgrades to SAFE. Only the PASC result decides the flag
// state in that case; the automatic providers are not consulted.
export function isFlagged<T extends UserStatus | GroupStatus>(
	status: CombinedStatus<T> | null
): boolean {
	if (!status) return false;
	const pasc = authoritativePascResult(status);
	if (pasc) return isActionableResult(pasc);
	return [...status.values()].some(isActionableResult);
}

// First actionable API result. Prefers the authoritative PASC verdict, then system APIs in
// order (SIGMANET, RAB, TASE), then any custom API. When PASC has a present but
// non-actionable record, no other provider may re-flag the entity.
export function getFlaggingResult<T extends UserStatus | GroupStatus>(
	status: CombinedStatus<T> | null
): CustomApiResult<T> | undefined {
	if (!status) return undefined;

	const pasc = authoritativePascResult(status);
	if (pasc) return isActionableResult(pasc) ? pasc : undefined;

	// System APIs have priority in order: pasc > scsn > rab > tase
	const systemOrder = ['system-pasc', 'system-scsn', 'system-rab', 'system-tase'];

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

// The system providers, most trusted first. Only used to break ties between equally severe
// verdicts, never to let a milder provider outrank a more severe one.
const SYSTEM_API_ORDER = ['system-pasc', 'system-scsn', 'system-rab', 'system-tase'] as const;

type SystemApiId = (typeof SYSTEM_API_ORDER)[number];

// The badge text the proxy attaches when the user has no PASC record at all.
// Kept as negative evidence only: when the proxy adds an explicit presence
// field, or a record has positive evidence (access badge / PASC reasons), the
// marker wording no longer matters. Absent all evidence we fail closed and
// treat the result as "no record" so a changed miss marker can never become an
// authoritative SAFE override.
export const PASC_MISSING_BADGE = 'PASC - Not in database';

const PASC_ACCESS_BADGE = /^Access (0|A1|A2|M1|M2)$/;
const PASC_REASON_KEYS = ['PASC Finding', 'Internal Review', 'Case Files'] as const;

// True when the system-pasc result carries a real record (full or flag-only).
// Misses, errors, and still-loading results are not records and must never
// override the automatic verdicts.
export function isPascRecordPresent<T extends UserStatus | GroupStatus>(
	result: CustomApiResult<T> | undefined | null
): boolean {
	const data = result?.data;
	if (!data) return false;

	// Preferred contract: the proxy states presence explicitly.
	if ('pascRecordPresent' in data && typeof data.pascRecordPresent === 'boolean') {
		return data.pascRecordPresent;
	}
	if ('pascMissing' in data && typeof data.pascMissing === 'boolean') {
		return !data.pascMissing;
	}

	const badges = 'badges' in data && Array.isArray(data.badges) ? data.badges : [];
	if (badges.some((badge) => badge.text === PASC_MISSING_BADGE)) return false;

	// Positive structural evidence: a released access level names a record, and
	// PASC-owned reason entries only exist on one.
	if (badges.some((badge) => PASC_ACCESS_BADGE.test(badge.text))) return true;
	const reasons = data.reasons;
	if (PASC_REASON_KEYS.some((key) => key in reasons)) return true;

	// Ambiguous shape (e.g. a flag-only record with no badges): fail closed.
	return false;
}

// The PASC result only when it is a real, present record with a known verdict.
// An unknown flag (a backend value this build cannot interpret) must not
// override the automatic providers in either direction: falling through keeps
// the last known-good verdict instead of silently clearing an unsafe one.
function authoritativePascResult<T extends UserStatus | GroupStatus>(
	status: CombinedStatus<T>
): CustomApiResult<T> | undefined {
	const pasc = status.get('system-pasc');
	if (!pasc || !isPascRecordPresent(pasc)) return undefined;
	if (pasc.data?.flagType === STATUS.FLAGS.UNKNOWN) return undefined;
	return pasc;
}

// Replace one provider's data in a combined status, returning a new Map so
// SvelteMap-backed callers see the write. Used after a PASC save/refresh so
// header, list flags, and profile warnings all observe the same verdict.
export function withUpdatedProviderData<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T>,
	apiId: string,
	data: T
): CombinedStatus<T> {
	const next = new Map(combined);
	const existing = next.get(apiId);
	next.set(apiId, {
		apiId,
		apiName: existing?.apiName ?? 'PASC',
		...(existing?.landscapeImageDataUrl !== undefined && {
			landscapeImageDataUrl: existing.landscapeImageDataUrl
		}),
		data,
		loading: false,
		timestamp: Date.now()
	});
	return next;
}

// The system provider whose verdict should stand for the user as a whole, as [apiId, result].
//
// RoProtect runs three independent services (SIGMANET, RAB, TASE) and they regularly disagree:
// a user can be clean on one and flagged on another. Taking whichever provider answered first
// would let a clean SIGMANET verdict hide a TASE detection, so an actionable flag from any
// provider wins outright and the most severe one wins among several. When nothing is
// actionable the order above decides, which keeps non-flagged states such as QUEUED or
// PROVISIONAL intact.
//
// PASC sits above all of that: a present PASC record replaces the computed verdict
// outright (even a downgrade to SAFE), so it is checked first. Absent, errored, or
// still-loading PASC results fall through to the automatic verdicts.
export function pickHighestSeveritySystemResult<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T> | null | undefined
): [string, CustomApiResult<T>] | undefined {
	if (!combined) return undefined;

	// PASC verdict override: a present PASC record (full or flag-only) replaces
	// the computed verdict outright — even when it is lower than (or contradicts)
	// the automatic providers, including downgrades to SAFE. Misses, errors, and
	// pending results fall through to the automatic verdicts below.
	const pasc = authoritativePascResult(combined);
	if (pasc) {
		return ['system-pasc', pasc];
	}

	let best: [string, CustomApiResult<T>] | undefined;
	let bestRank = ACTIONABLE_FLAG_SEVERITY.length;

	const consider = (id: string, result: CustomApiResult<T>) => {
		if (!result.data) return;
		const rank = ACTIONABLE_FLAG_SEVERITY.indexOf(result.data.flagType);
		if (rank !== -1) {
			if (rank < bestRank) {
				bestRank = rank;
				best = [id, result];
			}
			return;
		}
		best ??= [id, result];
	};

	for (const id of SYSTEM_API_ORDER) {
		const result = combined.get(id);
		if (result) consider(id, result);
	}

	// RoProtect can add services later, so consider any other system provider too rather than
	// silently dropping a verdict from a service this build has never heard of
	for (const [id, result] of combined.entries()) {
		if (id.startsWith('system-') && !SYSTEM_API_ORDER.includes(id as SystemApiId)) {
			consider(id, result);
		}
	}

	return best;
}

export interface SystemApiSummary<T> {
	data: T | undefined;
	loading: boolean;
	error: string | null;
}

const NO_SYSTEM_APIS: SystemApiSummary<never> = { data: undefined, loading: false, error: null };

// Collapses the system providers into the single verdict/signal the call sites used to read off
// a lone 'system-roprotect' entry. That id no longer exists now that RoProtect is queried as
// three separate services, so reading it directly always missed every verdict and left callers
// stuck on their "no data yet" state.
//
// Once any provider has answered, that verdict stands on its own: a slower sibling must not hold
// the UI in its loading state, and a failing sibling must not overwrite a real verdict with an
// error. Loading and error therefore only surface while no provider has produced data.
export function getSystemApiSummary<T extends UserStatus | GroupStatus>(
	combined: CombinedStatus<T> | null | undefined
): SystemApiSummary<T> {
	if (!combined) return NO_SYSTEM_APIS;

	const data = pickHighestSeveritySystemResult(combined)?.[1].data;
	if (data) return { data, loading: false, error: null };

	let sawSystem = false;
	let loading = false;
	let error: string | null = null;

	for (const [id, result] of combined.entries()) {
		if (!id.startsWith('system-')) continue;
		sawSystem = true;
		if (result.loading) loading = true;
		if (result.error && error === null) error = result.error;
	}

	return sawSystem ? { data: undefined, loading, error } : NO_SYSTEM_APIS;
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
