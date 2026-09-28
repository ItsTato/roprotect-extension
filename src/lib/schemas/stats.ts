import * as v from 'valibot';

export const HourlyStatEntrySchema = v.object({
	timestamp: v.string(),
	usersConfirmed: v.number(),
	usersFlagged: v.number(),
	usersBanned: v.number(),
	usersMixed: v.number(),
	groupsConfirmed: v.number(),
	groupsFlagged: v.number(),
	groupsMixed: v.number(),
	groupsLocked: v.number()
});

const StatTotalsSchema = v.object({
	usersConfirmed: v.number(),
	usersFlagged: v.number(),
	usersBanned: v.number(),
	usersMixed: v.number(),
	groupsConfirmed: v.number(),
	groupsFlagged: v.number(),
	groupsMixed: v.number(),
	groupsLocked: v.number()
});

const ActivityDataSchema = v.object({
	hours: v.picklist([24, 168, 720]),
	entries: v.array(HourlyStatEntrySchema)
});

export const StatsResponseSchema = v.object({
	totals: StatTotalsSchema,
	activity: ActivityDataSchema
});

export const parseStatsResponse = v.parser(StatsResponseSchema);
