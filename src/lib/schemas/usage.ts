import * as v from 'valibot';

// A service the key has no access to comes back with only the counters the
// backend actually tracked, or with no totals at all. Requiring both would
// reject the whole response over one unavailable service, so both are optional
// here and normalized to 0 by the endpoint.
const UsageServiceTotalsSchema = v.object({
	single: v.optional(v.number()),
	batch: v.optional(v.number())
});

// `keys` is keyed by the raw API key id and can hold one entry per key on the
// account. Outcomes and services stay open-ended records so a new backend
// outcome or service never fails validation.
const UsageKeyEntrySchema = v.object({
	label: v.nullable(v.string()),
	totalRequests: v.number(),
	avgLatencyMs: v.number(),
	byOutcome: v.record(v.string(), v.number()),
	byService: v.record(v.string(), v.nullish(UsageServiceTotalsSchema)),
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
