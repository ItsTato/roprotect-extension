import * as v from 'valibot';

const UsageServiceTotalsSchema = v.object({
	single: v.number(),
	batch: v.number()
});

// `keys` is keyed by the raw API key id and can hold one entry per key on the
// account. Outcomes and services stay open-ended records so a new backend
// outcome or service never fails validation.
const UsageKeyEntrySchema = v.object({
	label: v.nullable(v.string()),
	totalRequests: v.number(),
	avgLatencyMs: v.number(),
	byOutcome: v.record(v.string(), v.number()),
	byService: v.record(v.string(), UsageServiceTotalsSchema),
	firstSeen: v.nullable(v.number()),
	lastSeen: v.nullable(v.number()),
	recentUserIds: v.array(v.union([v.string(), v.number()]))
});

export const UsageResponseSchema = v.object({
	keys: v.record(v.string(), UsageKeyEntrySchema),
	rejected: v.record(v.string(), v.string()),
	updatedAt: v.number()
});

export const parseUsageResponse = v.parser(UsageResponseSchema);
