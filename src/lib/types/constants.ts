export const STATUS = {
	FLAGS: {
		SAFE: 0,
		PENDING: 1,
		UNSAFE: 2,
		QUEUED: 3,
		PROVISIONAL: 4,
		MIXED: 5,
		PAST_OFFENDER: 6,
		REDACTED: 8,
		UNKNOWN: -1
	},
	CATEGORIES: {
		CSAM: 1,
		SEXUAL: 2,
		KINK: 3,
		RACEPLAY: 4,
		CONDO: 5,
		OTHER: 6
	}
} as const;

export type StatusFlag = (typeof STATUS.FLAGS)[keyof typeof STATUS.FLAGS];

export const ENTITY_TYPES = {
	USER: 'user',
	GROUP: 'group'
} as const;

export const RAYWARD_URL = 'https://rayward.app';

// Custom API bundles are exported as `.roprotect-api`. The pre-rebrand
// `.rotector-api` extension is still accepted on import so files shared before
// the rename keep working.
export const CUSTOM_API_FILE_EXTENSION = '.roprotect-api';
export const CUSTOM_API_LEGACY_FILE_EXTENSIONS: readonly string[] = ['.rotector-api'];
export const CUSTOM_API_IMPORT_EXTENSIONS: string = [
	CUSTOM_API_FILE_EXTENSION,
	...CUSTOM_API_LEGACY_FILE_EXTENSIONS
].join(',');

export const RAYWARD_ANNOUNCEMENT_URL =
	'https://roprotect.tlet.xyz/blog/extension-is-becoming-rayward';

export const CHROME_STORE_REVIEW_URL =
	'https://chromewebstore.google.com/detail/roprotect/roprotect/reviews';
export const FIREFOX_STORE_REVIEW_URL =
	'https://addons.mozilla.org/en-US/firefox/addon/roprotect/reviews/';

const API_DOMAIN =
	import.meta.env.USE_DEV_API === 'true' ? 'roprotect-dev.tlet.xyz' : 'roprotect.tlet.xyz';

export const API_CONFIG = {
	BASE_URL: `https://${API_DOMAIN}`,
	ENDPOINTS: {
		USER_CHECK: '/v1/lookup/roblox/user',
		// Group verdicts are served by SCSN rather than the first-party backend.
		// Matches the doubled-version shape of the per-provider user routes
		// (/v1/scsn/v1/lookup/user/{userId}). See SCSN-GROUP-API.md.
		GROUP_CHECK: '/v1/scsn/v1/lookup/roblox/group',
		// Tracked users are a first-party sub-route of the group lookup, kept
		// separate because SCSN does not serve /tracked-users yet. Deriving it
		// from GROUP_CHECK would silently repoint it when the provider changes.
		GROUP_TRACKED_USERS: '/v1/lookup/roblox/group',
		QUEUE_USER: '/v1/queue/roblox/user',
		QUEUE_LIMITS: '/v1/queue/limits',
		QUEUE_STATUS: '/v1/queue/roblox/user/status',
		USAGE: '/v1/usage',
		EXPORT_GROUP_TRACKED_USERS: '/v1/export/roblox/group',
		LOOKUP_OUTFITS_BY_NAME: '/v1/lookup/outfits/by-name',
		LOOKUP_OUTFITS_BY_ID: '/v1/lookup/outfits/by-id',
		EXTENSION_MEMBERSHIP_STATUS: '/v1/extension/membership/status',
		EXTENSION_MEMBERSHIP_BADGE: '/v1/extension/membership/badge',
		EXTENSION_MEMBERSHIP_VERIFICATION: '/v1/extension/membership/verification',
		// TASE V2 endpoints
		TASE_V2_USER_CHECK: '/v1/tase/v2/lookup/user',
		TASE_V2_BATCH_CHECK: '/v1/tase/v2/lookup/users',
		// Discord avatar endpoint
		DISCORD_AVATAR_BATCH: '/v1/discord/v1/get_user_avatar_link'
	},
	BATCH_SIZE: 100,
	BATCH_DELAY: 250,
	MAX_RETRIES: 3,
	RETRY_DELAY: 1000,
	TIMEOUT: 10_000,
	EXPORT_TIMEOUT: 30_000,
	QUEUE_POLL_INTERVAL: 30_000,
	PROGRESSIVE_API_TIMEOUT: 15_000,
	OUTFIT_SNAPSHOT_MAX_ITEMS: 50,
	TRANSLATION_CACHE_MAX: 100,
	TRANSLATION_CACHE_TTL: 60 * 60 * 1000
} as const;

// API Actions for message passing
export const API_ACTIONS = {
	CHECK_USER_STATUS: 'checkUserStatus',
	CHECK_MULTIPLE_USERS: 'checkMultipleUsers',
	CHECK_GROUP_STATUS: 'checkGroupStatus',
	CHECK_MULTIPLE_GROUPS: 'checkMultipleGroups',
	QUEUE_USER: 'queueUser',
	GET_QUEUE_LIMITS: 'getQueueLimits',
	GET_USAGE: 'getUsage',
	TRANSLATE_TEXT: 'translateText',
	GET_GROUP_TRACKED_USERS: 'getGroupTrackedUsers',
	LOOKUP_ROBLOX_USER_DISCORD: 'lookupRobloxUserDiscord',
	EXPORT_GROUP_TRACKED_USERS: 'exportGroupTrackedUsers',
	LOOKUP_OUTFITS_BY_NAME: 'lookupOutfitsByName',
	LOOKUP_OUTFITS_BY_ID: 'lookupOutfitsById',
	FETCH_OUTFIT_IMAGES: 'fetchOutfitImages',
	EXTENSION_GET_MEMBERSHIP_STATUS: 'extensionGetMembershipStatus',
	EXTENSION_UPDATE_MEMBERSHIP_BADGE: 'extensionUpdateMembershipBadge',
	EXTENSION_CLEAR_MEMBERSHIP_BADGE: 'extensionClearMembershipBadge',
	EXTENSION_GET_MEMBERSHIP_VERIFICATION: 'extensionGetMembershipVerification',
	EXTENSION_CONFIRM_MEMBERSHIP_VERIFICATION: 'extensionConfirmMembershipVerification',
	HAS_TRANSLATE_PERMISSION: 'hasTranslatePermission',
	REQUEST_TRANSLATE_PERMISSION: 'requestTranslatePermission',
	API_WHOAMI: 'apiWhoami',
	GET_DISCORD_AVATARS: 'getDiscordAvatars'
} as const;

export const CAPTCHA_EXTERNAL_MESSAGES = {
	SUCCESS: 'CAPTCHA_SUCCESS',
	ERROR: 'CAPTCHA_ERROR'
} as const;

export const CAPTCHA_MESSAGES = {
	CAPTCHA_START: 'CAPTCHA_START',
	CAPTCHA_TOKEN_READY: 'CAPTCHA_TOKEN_READY',
	CAPTCHA_CANCELLED: 'CAPTCHA_CANCELLED'
} as const;

// DOM selectors and data attributes for status/processing tracking
export const STATUS_SELECTORS = {
	PROCESSED_CLASS: 'status-processed',
	DATA_USER_ID: 'data-rotector-user-id',
	DATA_PROCESSED: 'data-rotector-processed',
	DATA_FLAGGED: 'data-rotector-flagged'
} as const;

// Rotector backend reason-category keys
export const REASON_KEYS = {
	USER_PROFILE: 'User Profile',
	AVATAR_OUTFIT: 'Avatar Outfit'
} as const;

export const OBSERVER_CONFIG = {
	DEFAULT_HEALTH_CHECK_INTERVAL: 3000,
	DEFAULT_RESTART_DELAY: 1000
} as const;

export const RETRY_CONFIG = {
	MAX_RETRIES: 30,
	BASE_DELAY: 100, // ms
	BACKOFF_MULTIPLIER: 1.3,
	MAX_DELAY: 3000 // ms
} as const;

export const PAGE_TYPES = {
	HOME: 'home',
	FRIENDS_LIST: 'friends-list',
	FRIENDS_CAROUSEL: 'friends-carousel',
	PROFILE: 'profile',
	MEMBERS: 'members',
	REPORT: 'report',
	SEARCH_USER: 'search-user',
	GROUP_MEMBERS_CAROUSEL: 'group-members-carousel',
	GROUP_CONFIGURE_MEMBERS: 'group-configure-members'
} as const;

export const COMPONENT_CLASSES = {
	STATUS_CONTAINER: 'rtcr-status-container',
	STATUS_POSITIONED_ABSOLUTE: 'status-positioned-absolute',
	FRIENDS_MANAGER: 'rotector-friends-manager',
	GROUPS_MANAGER: 'rotector-groups-manager',
	GROUP_CONFIGURE_MANAGER: 'rotector-group-configure-manager',
	SEARCH_MANAGER: 'rotector-search-manager',
	HOME_CAROUSEL_MANAGER: 'rotector-home-carousel-manager',
	PROFILE_STATUS: 'rotector-profile-status',
	REPORT_HELPER: 'rotector-report-helper',
	GROUP_STATUS_CONTAINER: 'rotector-group-status-container',
	EXPORT_BUTTON: 'rotector-export-button',
	SCAN_HOST: 'rotector-scan-host',
	CIPHER_INDICATOR: 'rotector-cipher-indicator',
	MEMBERSHIP_BADGE_PILL: 'rotector-membership-badge-pill'
} as const;

export type ComponentClassType = (typeof COMPONENT_CLASSES)[keyof typeof COMPONENT_CLASSES];

export const USER_ACTIONS = {
	STATUS_CLICKED: 'status_indicator_clicked',
	QUEUE_REQUESTED: 'queue_requested',
	QUEUE_CONFIRMED: 'queue_confirmed',
	QUEUE_CANCELLED: 'queue_cancelled',
	FRIEND_PROCEED: 'friend_proceed',
	FRIEND_CANCEL: 'friend_cancel',
	FRIEND_BLOCK: 'friend_block',
	FRIEND_WARNING_PROCEED: 'friend_warning_proceed',
	FRIEND_WARNING_CANCEL: 'friend_warning_cancel',
	QUEUE_POPUP_CONFIRM: 'queue_popup_confirm',
	QUEUE_POPUP_CANCEL: 'queue_popup_cancel',
	REPORT_HELPER_AUTOFILL: 'report_helper_autofill',
	REPORT_HELPER_AUTOFILL_FAILED: 'report_helper_autofill_failed',
	REPORT_HELPER_OPEN_PAGE: 'report_helper_open_page',
	REPORT_HELPER_COPY_EVIDENCE: 'report_helper_copy_evidence'
} as const;

// Lookup context for request headers
export const LOOKUP_CONTEXT = {
	FRIENDS: 'friends',
	GROUPS: 'groups',
	PROFILE: 'profile'
} as const;

// Roblox API base URLs
export const ROBLOX_API = {
	THUMBNAILS: 'https://thumbnails.roblox.com',
	AVATAR: 'https://avatar.roblox.com',
	USERS: 'https://users.roblox.com',
	FRIENDS: 'https://friends.roblox.com',
	GROUPS: 'https://groups.roblox.com',
	PRESENCE: 'https://presence.roblox.com',
	APIS: 'https://apis.roblox.com'
} as const;

// browser.storage keys shared across stores and background workers
export const STORAGE_KEYS = {
	DEVELOPER_LOGS: 'developerLogs',
	PERFORMANCE_ENTRIES: 'performanceEntries',
	CONTENT_THEME: 'rotector-content-theme',
	METRICS_SNAPSHOTS: 'metricsSnapshots'
} as const;
