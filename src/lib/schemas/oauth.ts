import * as v from 'valibot';

// /oauth/pair answers { success: true, data: { pair, authorizeUrl } }
export const DiscordSignInStartSchema = v.object({
	pair: v.pipe(v.string(), v.minLength(1), v.maxLength(256)),
	authorizeUrl: v.pipe(v.string(), v.minLength(1))
});

// /oauth/poll always answers HTTP 200 with one of three states. `ready` consumes
// the pair, so every subsequent poll for the same code is `unknown`.
const PendingPollSchema = v.object({
	status: v.literal('pending')
});

const UnknownPollSchema = v.object({
	status: v.literal('unknown')
});

const ReadyPollSchema = v.object({
	status: v.literal('ready'),
	// Null when the account only has an admin-scoped key (raw keys never travel
	// through the portal) or when the account is banned.
	key: v.nullable(v.string()),
	fingerprint: v.string(),
	label: v.optional(v.nullable(v.string()), null),
	services: v.optional(v.array(v.string()), []),
	discordId: v.string(),
	username: v.string(),
	displayName: v.optional(v.nullable(v.string()), null),
	avatarUrl: v.optional(v.nullable(v.string()), null)
});

export const DiscordSignInPollSchema = v.variant('status', [
	PendingPollSchema,
	UnknownPollSchema,
	ReadyPollSchema
]);

export const parseDiscordSignInStart = v.parser(DiscordSignInStartSchema);
export const parseDiscordSignInPoll = v.parser(DiscordSignInPollSchema);

export type DiscordSignInStart = v.InferOutput<typeof DiscordSignInStartSchema>;
export type DiscordSignInPoll = v.InferOutput<typeof DiscordSignInPollSchema>;
export type DiscordSignInReady = v.InferOutput<typeof ReadyPollSchema>;
