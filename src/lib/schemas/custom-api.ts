import * as v from 'valibot';
import { STATUS } from '../types/constants';
import type { CustomApiAuthHeaderType } from '../types/custom-api';

const KNOWN_FLAGS = Object.values(STATUS.FLAGS);

const AUTH_HEADER_TYPES: readonly CustomApiAuthHeaderType[] = [
	'x-auth-token',
	'authorization-bearer',
	'authorization-plain'
];

const REASON_FORMATS = ['numeric', 'string'] as const;

const CustomApiBadgeSchema = v.object({
	text: v.string('Badge: text must be string'),
	// Some providers (RAB, TASE) omit color/textColor on badges. Use nullish
	// to accept missing keys AND explicit null without failing.
	color: v.nullish(v.string('Badge: color must be string')),
	textColor: v.nullish(v.string('Badge: textColor must be string'))
});

const UserStatusResponseSchema = v.object({
	id: v.number('Missing or invalid "id" field (must be number)'),
	flagType: v.fallback(
		v.picklist(
			KNOWN_FLAGS,
			`Missing or invalid "flagType" field (must be one of ${KNOWN_FLAGS.join(', ')})`
		),
		STATUS.FLAGS.UNKNOWN
	),
	// Some providers send category as string; coerce to number. Optional in both schemas.
	category: v.optional(v.pipe(v.union([v.number(), v.string()]), v.transform(Number))),
	confidence: v.optional(v.number('Invalid "confidence" field (must be number if present)')),
	// A record with no reasons omits the key entirely, and the contract also permits an
	// explicit null, so normalise both to an empty object. The `optional` default covers
	// the absent case, the transform covers an explicit null, and doing it at the parse
	// boundary keeps downstream projection free of per-access null checks.
	reasons: v.pipe(
		v.optional(v.nullish(v.record(v.string(), v.unknown(), 'Invalid "reasons" field')), {}),
		v.transform((value) => value ?? {})
	),
	badges: v.optional(
		v.pipe(
			v.array(CustomApiBadgeSchema, 'Invalid "badges" field (must be array)'),
			v.maxLength(3, 'Too many badges (maximum 3 allowed)')
		)
	)
});

export const CustomApiResponseEnvelopeSchema = v.variant('success', [
	v.object({ success: v.literal(true), data: v.unknown() }),
	v.object({ success: v.literal(false), error: v.optional(v.string()) })
]);

const ImportedApiConfigSchema = v.object({
	name: v.pipe(
		v.string('Missing or invalid "name" field'),
		v.minLength(1, 'Name must be between 1 and 12 characters'),
		v.maxLength(12, 'Name must be between 1 and 12 characters')
	),
	singleUrl: v.pipe(
		v.string('Missing or invalid "singleUrl" field'),
		v.startsWith('https://', 'Single URL must use HTTPS protocol'),
		v.includes('{userId}', 'Single URL must contain {userId} placeholder')
	),
	batchUrl: v.pipe(
		v.string('Missing or invalid "batchUrl" field'),
		v.startsWith('https://', 'Batch URL must use HTTPS protocol')
	),
	enabled: v.boolean('Missing or invalid "enabled" field'),
	timeout: v.pipe(
		v.number('Missing or invalid "timeout" field'),
		v.minValue(1000, 'Timeout must be between 1000 and 60000 milliseconds'),
		v.maxValue(60_000, 'Timeout must be between 1000 and 60000 milliseconds')
	),
	reasonFormat: v.optional(
		v.picklist(REASON_FORMATS, 'reasonFormat must be "numeric" or "string"')
	),
	landscapeImageDataUrl: v.optional(
		v.pipe(
			v.string('landscapeImageDataUrl must be a string'),
			v.regex(
				/^(data:image\/|chrome-extension:\/\/|moz-extension:\/\/)/,
				'landscapeImageDataUrl must be a data:image/, chrome-extension://, or moz-extension:// URL'
			)
		)
	),
	authHeaderType: v.optional(
		v.picklist(
			AUTH_HEADER_TYPES,
			'authHeaderType must be one of x-auth-token, authorization-bearer, authorization-plain'
		)
	)
});

export const PersistedCustomApiSchema = v.object({
	id: v.string(),
	name: v.string(),
	singleUrl: v.string(),
	batchUrl: v.string(),
	enabled: v.boolean(),
	timeout: v.number(),
	order: v.number(),
	createdAt: v.number(),
	lastTested: v.optional(v.number()),
	lastTestSuccess: v.optional(v.boolean()),
	isSystem: v.optional(v.boolean()),
	reasonFormat: v.optional(v.picklist(REASON_FORMATS)),
	landscapeImageDataUrl: v.optional(
		v.pipe(
			v.string(),
			v.regex(
				/^(data:image\/|chrome-extension:\/\/|moz-extension:\/\/)/,
				'landscapeImageDataUrl must be a data:image/, chrome-extension://, or moz-extension:// URL'
			)
		)
	),
	apiKey: v.optional(v.string()),
	authHeaderType: v.optional(v.picklist(AUTH_HEADER_TYPES))
});

export type ImportedApiConfig = v.InferOutput<typeof ImportedApiConfigSchema>;

export const parseUserStatusResponse = v.parser(UserStatusResponseSchema);
export const parseImportedApiConfig = v.parser(ImportedApiConfigSchema);
export const parsePersistedCustomApis = v.parser(v.array(PersistedCustomApiSchema));
