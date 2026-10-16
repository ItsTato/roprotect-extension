// MOCK ONLY — PASC provider mockup scaffold (see T:\Python Projects\TLET\PASC\PASC.md).
// Nothing here is wired to a backend. The real PASC provider will arrive via
// whoami as `system-pasc` with its own single/batch endpoints; these types are
// a starting proposal for that record shape, and the MOCK_* exports exist only
// so the dev-only preview (PascMockupSection) has something to render.
//
// Visibility rule (decided): the PASC flag is public to every clearance (0+)
// and overrides the other providers' flags. Only the case details (notes,
// files, provider context, Discord links) are gated by pascCanSee below.
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
	| 'redacted';

export const PASC_FLAG_TO_NUMERIC: Record<PascFlag, StatusFlag> = {
	unsafe: STATUS.FLAGS.UNSAFE,
	flagged: STATUS.FLAGS.PENDING,
	queued: STATUS.FLAGS.QUEUED,
	mixed: STATUS.FLAGS.MIXED,
	past_offender: STATUS.FLAGS.PAST_OFFENDER,
	provisional: STATUS.FLAGS.PROVISIONAL,
	safe: STATUS.FLAGS.SAFE,
	redacted: STATUS.FLAGS.REDACTED
};

export const NUMERIC_TO_PASC_FLAG: Record<number, PascFlag> = {
	[STATUS.FLAGS.UNSAFE]: 'unsafe',
	[STATUS.FLAGS.PENDING]: 'flagged',
	[STATUS.FLAGS.QUEUED]: 'queued',
	[STATUS.FLAGS.MIXED]: 'mixed',
	[STATUS.FLAGS.PAST_OFFENDER]: 'past_offender',
	[STATUS.FLAGS.PROVISIONAL]: 'provisional',
	[STATUS.FLAGS.SAFE]: 'safe',
	[STATUS.FLAGS.REDACTED]: 'redacted'
};

export const PASC_FLAG_COLORS: Record<PascFlag, string> = {
	unsafe: 'var(--color-status-unsafe)',
	flagged: 'var(--color-status-pending)',
	queued: 'var(--color-status-queued)',
	mixed: 'var(--color-status-mixed)',
	past_offender: 'var(--color-status-past-offender)',
	provisional: 'var(--color-status-safe)',
	safe: 'var(--color-success)',
	redacted: 'var(--color-status-error)'
};

export const PASC_FLAG_LABELS: Record<PascFlag, string> = {
	unsafe: 'Unsafe',
	flagged: 'Flagged',
	queued: 'Queued',
	mixed: 'Mixed',
	past_offender: 'Past Offender',
	provisional: 'Provisional',
	safe: 'Safe',
	redacted: 'Redacted'
};

// Fallback when the user has no PASC record: the verdict is referred to the
// highest relied-upon provider verdict (most severe first). The real referral
// is computed extension-side from the live CombinedStatus; this helper covers
// the stored-snapshot shape for the mock harness.
export interface PascReferral {
	provider: string;
	flag: PascFlag;
}

const PASC_FLAG_SEVERITY: readonly PascFlag[] = [
	'unsafe',
	'redacted',
	'flagged',
	'mixed',
	'past_offender',
	'provisional',
	'queued',
	'safe'
];

export function pickPascReferral(verdicts: PascProviderVerdict[]): PascReferral | null {
	let best: PascProviderVerdict | null = null;
	for (const verdict of verdicts) {
		if (!best || PASC_FLAG_SEVERITY.indexOf(verdict.flag) < PASC_FLAG_SEVERITY.indexOf(best.flag)) {
			best = verdict;
		}
	}
	return best ? { provider: best.provider, flag: best.flag } : null;
}

export interface PascProviderVerdict {
	provider: 'SIGMANET' | 'RAB' | 'TASE';
	flag: PascFlag;
	detail: string;
}

export interface PascCaseFile {
	id: string;
	name: string;
	kind: 'markdown' | 'image' | 'other';
	accessLevel: PascAccessLevel;
	sizeLabel: string;
	// Upstream PASC file id, forwarded by the proxy lookup adapter. Null for
	// mock files and pre-file-id lookups: no download or delete without it.
	fileId: string | null;
	// Mock-only preview content until the backend serves file bytes.
	mockPreview?: string | undefined;
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

// 1x1 transparent PNG placeholder so the mockup renders without avatar bytes.
const PLACEHOLDER_AVATAR =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

export const MOCK_PASC_RECORD: PascRecord = {
	userId: '123456789',
	displayName: 'Mock User',
	username: 'mock.user',
	flag: 'unsafe',
	accessLevel: 'A2',
	reviewer: 'Case reviewer M. Vale',
	updatedAt: '2026-10-10',
	publicNote:
		'Multiple corroborated condo-game reports across two alt accounts. Avoid trading or private servers with this user until review closes.',
	internalReview:
		'## Review notes\n\n- Alt linkage confirmed via RoWifi (2 accounts, same guild cluster).\n- TASE guild scores attached below; SIGMANET dissents (clean).\n- Recommend holding UNSAFE pending M2 sign-off.',
	internalReviewMinLevel: 'M1',
	files: [
		{
			id: 'f1',
			name: 'case-notes.md',
			kind: 'markdown',
			accessLevel: 'A2',
			sizeLabel: '4 KB',
			fileId: null,
			mockPreview:
				'## Case notes\n\n- Alt linkage confirmed via RoWifi.\n- Holding **UNSAFE** pending M2 sign-off.'
		},
		{
			id: 'f2',
			name: 'screenshot-1.png',
			kind: 'image',
			accessLevel: 'M1',
			sizeLabel: '812 KB',
			fileId: null
		},
		{
			id: 'f3',
			name: 'chatlog.txt',
			kind: 'other',
			accessLevel: 'A1',
			sizeLabel: '11 KB',
			fileId: null
		}
	],
	providerVerdicts: [
		{ provider: 'SIGMANET', flag: 'safe', detail: 'No record — clean verdict' },
		{ provider: 'RAB', flag: 'unsafe', detail: 'Flagged: condo activity, high confidence' },
		{ provider: 'TASE', flag: 'past_offender', detail: '2 guild detections, score 41' }
	]
};

// A record above most viewers' clearance, to demo the gating behavior.
export const MOCK_PASC_RESTRICTED_RECORD: PascRecord = {
	...MOCK_PASC_RECORD,
	accessLevel: 'M2',
	publicNote: 'You should never see this text below M2 clearance.',
	internalReview: 'Neither should you see this.'
};

export const MOCK_PASC_DISCORD_ACCOUNTS: PascDiscordAccount[] = [
	{
		id: '111222333444555666',
		username: 'condo.host',
		globalName: 'Condo Host',
		avatarDataUrl: PLACEHOLDER_AVATAR,
		serverCount: 2,
		servers: [
			{ id: 'g1', name: 'Midnight Condos', flagType: 'unsafe' },
			{ id: 'g3', name: 'After Hours', flagType: 'past_offender' }
		]
	},
	{
		id: '777888999000111222',
		username: 'alt.account2',
		globalName: 'Alt Account Two',
		avatarDataUrl: null,
		serverCount: 1,
		servers: [{ id: 'g1', name: 'Midnight Condos', flagType: 'unsafe' }]
	}
];
