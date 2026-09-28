import { REASON_KEYS } from '../../types/constants';
import type { CombinedStatus } from '../../types/custom-api';
import type { EntityStatus } from '../../types/api';
import { extractFlaggedOutfits, type FlaggedOutfitInfo } from './violation-formatter';

const SYSTEM_API_ORDER = ['system-scsn', 'system-rab', 'system-tase'] as const;

function getSystemApiData<T extends EntityStatus>(
	combined: CombinedStatus<T> | null | undefined
): T | undefined {
	if (!combined) return undefined;

	// Try system APIs in priority order
	for (const id of SYSTEM_API_ORDER) {
		const data = combined.get(id)?.data;
		if (data) return data;
	}

	// Fall back to any system API
	for (const [id, result] of combined.entries()) {
		if (id.startsWith('system-') && result.data) {
			return result.data;
		}
	}

	return undefined;
}

// Get flagged outfit info from a combined status map (user only)
export function getRotectorOutfitEvidence(
	combined: CombinedStatus | null | undefined
): FlaggedOutfitInfo[] | null {
	const data = getSystemApiData(combined);
	if (!data) return null;
	const evidence = data.reasons[REASON_KEYS.AVATAR_OUTFIT]?.evidence;
	if (!evidence) return null;
	return extractFlaggedOutfits(evidence);
}

// Get the membership badge from system API data, if present (user only)
export function getRotectorMembershipBadge(combined: CombinedStatus | null | undefined) {
	const data = getSystemApiData(combined);
	if (!data || !('membershipBadge' in data)) return null;
	return data.membershipBadge ?? null;
}

interface VisibleBadgesInput {
	isGroup: boolean;
	isReportable: boolean;
	isQueued: boolean;
	customApiFlagCount: number;
	hasMembership: boolean;
}

// Map each visible badge to its "badge-stack-N" position class, in stack order
export function getBadgeStackClasses(opts: VisibleBadgesInput): Record<string, string> {
	const classes: Record<string, string> = {};
	let i = 0;
	if (!opts.isGroup && opts.isReportable) classes['reportable'] = `badge-stack-${String(++i)}`;
	if (opts.isQueued) classes['queue'] = `badge-stack-${String(++i)}`;
	if (opts.customApiFlagCount > 0) classes['integration'] = `badge-stack-${String(++i)}`;
	if (opts.hasMembership) classes['membership'] = `badge-stack-${String(i + 1)}`;
	return classes;
}
