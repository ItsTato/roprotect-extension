import type { CombinedStatus } from '../../types/custom-api';
import type { UserStatus } from '../../types/api';
import {
	NUMERIC_TO_PASC_FLAG,
	PASC_FLAG_LABELS,
	type PascAccessLevel,
	type PascCaseFile,
	type PascFlag,
	type PascProviderVerdict,
	type PascRecord,
	type PascReferral
} from '../../data/pasc-mock';
import { PASC_MISSING_BADGE, pickHighestSeveritySystemResult } from './status-utils';

// Maps a real system-pasc lookup result onto the PASC tab view model.
// Three outcomes (mirroring the proxy contract):
// - full record → PascRecord with accessLevel set;
// - flag-only (gated) record → PascRecord with accessLevel null (verdict row
//   renders, details do not, no level is named);
// - miss ("PASC - Not in database") → null (the tab renders the referral).

const ACCESS_BADGE = /^Access (0|A1|A2|M1|M2)$/;
const FILE_LEVEL_SUFFIX = /^(.*)\s+\[(0|A1|A2|M1|M2)\]$/;
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg']);

export function pascFileKind(name: string): PascCaseFile['kind'] {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	if (ext === 'md' || ext === 'markdown') return 'markdown';
	if (IMAGE_EXTENSIONS.has(ext)) return 'image';
	return 'other';
}

function mapFile(entry: string, fallbackLevel: PascAccessLevel, index: number): PascCaseFile {
	const match = FILE_LEVEL_SUFFIX.exec(entry);
	const name = (match?.[1] ?? entry).trim() || `file-${String(index + 1)}`;
	return {
		id: `file:${String(index)}:${name}`,
		name,
		kind: pascFileKind(name),
		accessLevel: (match?.[2] as PascAccessLevel | undefined) ?? fallbackLevel,
		sizeLabel: ''
	};
}

export function mapPascUserStatus(
	data: UserStatus,
	identity: { userId: string; displayName: string | undefined; username: string | undefined }
): PascRecord | null {
	const badges = data.badges ?? [];
	if (badges.some((badge) => badge.text === PASC_MISSING_BADGE)) return null;

	const flag = NUMERIC_TO_PASC_FLAG[data.flagType] ?? 'safe';
	const base = {
		userId: identity.userId,
		displayName: identity.displayName || identity.username || identity.userId,
		username: identity.username || identity.displayName || identity.userId,
		flag
	};

	const access =
		badges
			.map((badge) => ACCESS_BADGE.exec(badge.text)?.[1])
			.find((level): level is PascAccessLevel => level !== undefined) ?? null;
	if (access === null) {
		return {
			...base,
			accessLevel: null,
			reviewer: '',
			updatedAt: '',
			publicNote: '',
			internalReview: '',
			internalReviewMinLevel: 'M1',
			files: [],
			providerVerdicts: []
		};
	}

	const reasons = data.reasons;
	const filesEvidence = reasons['Case Files']?.evidence ?? [];
	return {
		...base,
		accessLevel: access,
		reviewer: data.reviewer?.displayName || data.reviewer?.username || '',
		updatedAt: data.lastUpdated ? new Date(data.lastUpdated * 1000).toISOString().slice(0, 10) : '',
		publicNote: reasons['PASC Finding']?.message ?? '',
		internalReview: reasons['Internal Review']?.message ?? '',
		// Server floor: internal review is M1+ minimum to read or write.
		internalReviewMinLevel: 'M1',
		files: filesEvidence
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry, index) => mapFile(entry, access, index)),
		providerVerdicts: []
	};
}

const RELIED_UPON_ORDER = ['system-scsn', 'system-rab', 'system-tase'] as const;

const RELIED_UPON_LABELS: Record<
	(typeof RELIED_UPON_ORDER)[number],
	PascProviderVerdict['provider']
> = {
	'system-scsn': 'SIGMANET',
	'system-rab': 'RAB',
	'system-tase': 'TASE'
};

// Live provider-verdict rows for the PASC tab, from the providers PASC relies
// on. Unknown (-1) verdicts are skipped: nothing settled to show yet.
export function liveProviderVerdicts(
	combined: CombinedStatus<UserStatus> | null | undefined
): PascProviderVerdict[] {
	if (!combined) return [];
	const rows: PascProviderVerdict[] = [];
	for (const apiId of RELIED_UPON_ORDER) {
		const data = combined.get(apiId)?.data;
		if (!data) continue;
		const flag = NUMERIC_TO_PASC_FLAG[data.flagType];
		if (!flag) continue;
		rows.push({
			provider: RELIED_UPON_LABELS[apiId],
			flag,
			detail: PASC_FLAG_LABELS[flag]
		});
	}
	return rows;
}

// Referral for users with no PASC record: the highest relied-upon provider
// verdict (most severe wins, same order the override projection uses).
export function pickLivePascReferral(
	combined: CombinedStatus<UserStatus> | null | undefined
): PascReferral | null {
	if (!combined) return null;
	const automatic = new Map(
		[...combined.entries()].filter(([id]) => (RELIED_UPON_ORDER as readonly string[]).includes(id))
	);
	const worst = pickHighestSeveritySystemResult(automatic);
	const flagType = worst?.[1].data?.flagType;
	if (worst === undefined || flagType === undefined) return null;
	const flag: PascFlag | undefined = NUMERIC_TO_PASC_FLAG[flagType];
	if (!flag) return null;
	return { provider: worst[1].apiName, flag };
}
