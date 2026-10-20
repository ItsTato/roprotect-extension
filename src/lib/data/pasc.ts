// Shared PASC types, clearance ranks, and flag presentation data. The PASC tab
// renders real lookup data mapped by `utils/status/pasc-record.ts`; there is no
// mock record in the production path.
//
// Visibility rule: the PASC flag is public to every clearance (0+) and overrides
// the other providers' flags. Only the case details (notes, files, provider
// context, Discord links) are gated by pascCanSee below.
import { STATUS, type StatusFlag } from '../types/constants';

export type PascAccessLevel = '0' | 'A1' | 'A2' | 'M1' | 'M2';

export const PASC_ACCESS_RANK: Record<PascAccessLevel, number> = {
	'0': 0,
	A1: 1,
	A2: 2,
	M1: 3,
	M2: 4
};

// Gate for case details only. The PASC flag itself is visible to every
// clearance (0+) and overrides the other providers — never gate the flag on this.
export function pascCanSee(viewerLevel: PascAccessLevel, recordLevel: PascAccessLevel): boolean {
	return PASC_ACCESS_RANK[viewerLevel] >= PASC_ACCESS_RANK[recordLevel];
}

export type PascFlag =
	| 'safe'
	| 'provisional'
	| 'past_offender'
	| 'mixed'
	| 'unsafe'
	| 'flagged'
	| 'queued'
	| 'redacted'
	// A flag value this build does not know yet. It must never be treated as
	// SAFE: an unknown verdict is surfaced as unknown so it cannot silently
	// clear another provider's detection.
	| 'unknown';

export const PASC_FLAG_TO_NUMERIC: Record<PascFlag, StatusFlag> = {
	unsafe: STATUS.FLAGS.UNSAFE,
	flagged: STATUS.FLAGS.PENDING,
	queued: STATUS.FLAGS.QUEUED,
	mixed: STATUS.FLAGS.MIXED,
	past_offender: STATUS.FLAGS.PAST_OFFENDER,
	provisional: STATUS.FLAGS.PROVISIONAL,
	safe: STATUS.FLAGS.SAFE,
	redacted: STATUS.FLAGS.REDACTED,
	unknown: STATUS.FLAGS.UNKNOWN
};

export const NUMERIC_TO_PASC_FLAG: Record<number, PascFlag> = {
	[STATUS.FLAGS.UNSAFE]: 'unsafe',
	[STATUS.FLAGS.PENDING]: 'flagged',
	[STATUS.FLAGS.QUEUED]: 'queued',
	[STATUS.FLAGS.MIXED]: 'mixed',
	[STATUS.FLAGS.PAST_OFFENDER]: 'past_offender',
	[STATUS.FLAGS.PROVISIONAL]: 'provisional',
	[STATUS.FLAGS.SAFE]: 'safe',
	[STATUS.FLAGS.REDACTED]: 'redacted',
	[STATUS.FLAGS.UNKNOWN]: 'unknown'
};

export const PASC_FLAG_COLORS: Record<PascFlag, string> = {
	unsafe: 'var(--color-status-unsafe)',
	flagged: 'var(--color-status-pending)',
	queued: 'var(--color-status-queued)',
	mixed: 'var(--color-status-mixed)',
	past_offender: 'var(--color-status-past-offender)',
	provisional: 'var(--color-status-safe)',
	safe: 'var(--color-success)',
	redacted: 'var(--color-status-error)',
	unknown: 'var(--color-status-pending)'
};

// Translation keys, not display strings: components render these through $_().
export const PASC_FLAG_LABELS: Record<PascFlag, string> = {
	unsafe: 'pasc_flag_unsafe',
	flagged: 'pasc_flag_flagged',
	queued: 'pasc_flag_queued',
	mixed: 'pasc_flag_mixed',
	past_offender: 'pasc_flag_past_offender',
	provisional: 'pasc_flag_provisional',
	safe: 'pasc_flag_safe',
	redacted: 'pasc_flag_redacted',
	unknown: 'pasc_flag_unknown'
};

// Fallback when the user has no PASC record: the verdict is referred to the
// highest relied-upon provider verdict (most severe first). The real referral
// is computed extension-side from the live CombinedStatus.
export interface PascReferral {
	provider: string;
	flag: PascFlag;
}

export interface PascProviderVerdict {
	provider: 'SIGMANET' | 'RAB' | 'TASE';
	flag: PascFlag;
	// Translation key for the verdict label.
	detail: string;
}

export interface PascCaseFile {
	id: string;
	name: string;
	kind: 'markdown' | 'image' | 'other';
	accessLevel: PascAccessLevel;
	sizeLabel: string;
	// Upstream PASC file id, forwarded by the proxy lookup adapter. Null for
	// pre-file-id lookups: no download or delete without it.
	fileId: string | null;
}

export interface PascRecord {
	userId: string;
	displayName: string;
	username: string;
	flag: PascFlag;
	// Null for flag-only (gated) records: the verdict row renders, details do
	// not, and no level is named.
	accessLevel: PascAccessLevel | null;
	reviewer: string;
	updatedAt: string;
	publicNote: string;
	internalReview: string;
	internalReviewMinLevel: PascAccessLevel;
	files: PascCaseFile[];
	providerVerdicts: PascProviderVerdict[];
}

export interface PascDiscordAccount {
	id: string;
	username: string;
	globalName: string;
	avatarDataUrl: string | null;
	serverCount: number;
	// Every detected server, any severity — the PASC tab is the complete
	// overview for human moderators, so past-offender sightings stay visible.
	servers: Array<{ id: string; name: string; flagType: 'unsafe' | 'past_offender' }>;
}
