import { derived, get, writable } from 'svelte/store';
import { apiClient } from '../services/rotector/api-client';
// Shared PASC access-level type (relocated from the mock module at cutover).
import { PASC_ACCESS_RANK, type PascAccessLevel } from '../data/pasc-mock';
import { logger } from '../utils/logging/logger';

interface PascClearanceState {
	level: PascAccessLevel | null;
	loading: boolean;
}

// Viewer's PASC clearance, fetched once per session through the RoProtect
// proxy (`GET /v1/pasc/v1/clearance`). Null until loaded; a failed fetch leaves
// it null (edit stays hidden, details render from server-filtered data).
const clearanceState = writable<PascClearanceState>({ level: null, loading: false });

let inflight: Promise<PascAccessLevel | null> | null = null;

export function ensurePascClearance(): Promise<PascAccessLevel | null> {
	const current = get(clearanceState);
	if (current.level !== null || current.loading) {
		if (current.loading && inflight) return inflight;
		return Promise.resolve(current.level);
	}
	clearanceState.set({ level: null, loading: true });
	inflight = apiClient
		.getPascClearance()
		.then((level) => {
			clearanceState.set({ level, loading: false });
			return level;
		})
		.catch((error: unknown) => {
			logger.warn('[PASC] Clearance lookup failed; edit stays hidden:', error);
			clearanceState.set({ level: null, loading: false });
			return null;
		})
		.finally(() => {
			inflight = null;
		});
	return inflight;
}

export const pascClearance = derived(clearanceState, ($state) => $state.level);

// Assume full visibility until clearance is known: lookup details are already
// filtered server-side, so the client filter can only under-show while loading.
export const pascViewerLevel = derived(
	clearanceState,
	($state): PascAccessLevel => $state.level ?? 'M2'
);

export const pascCanEdit = derived(
	clearanceState,
	($state) => $state.level !== null && PASC_ACCESS_RANK[$state.level] >= PASC_ACCESS_RANK.M1
);
