import { REASON_KEYS } from '../../types/constants';
import type { CombinedStatus } from '../../types/custom-api';
import type { EntityStatus } from '../../types/api';
import { extractFlaggedOutfits, type FlaggedOutfitInfo } from './violation-formatter';
import { pickHighestSeveritySystemResult } from './status-utils';

// The verdict that stands for the user across the system providers, so a flagged RAB/TASE
// result is never hidden behind a clean SIGMANET one.
function getSystemApiData<T extends EntityStatus>(
	combined: CombinedStatus<T> | null | undefined
): T | undefined {
	return pickHighestSeveritySystemResult(combined)?.[1].data;
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

// Get the membership badge from system API data, if present (user only).
// Scans every provider rather than reading the representative verdict's copy: membership is a
// profile attribute that only one of the services may report, so a stricter verdict elsewhere
// must not make the badge disappear.
export function getRotectorMembershipBadge(combined: CombinedStatus | null | undefined) {
	if (!combined) return null;

	for (const [id, result] of combined.entries()) {
		if (!id.startsWith('system-') || !result.data) continue;
		if (!('membershipBadge' in result.data)) continue;
		if (result.data.membershipBadge) return result.data.membershipBadge;
	}

	return null;
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
