// Roblox's 2026 player-search redesign: circular avatar headshots in an
// article-based grid. The old ul.search-result.avatar-cards markup is gone.
export const SEARCH_SELECTORS = {
	CONTAINER: '.player-search-results-grid',
	CARD: {
		CONTAINER: 'article.player-search-card',
		CAPTION: '.player-search-card-caption',
		DISPLAY_NAME: '.player-search-card-name a',
		USERNAME: '.player-search-card-caption > p',
		AVATAR_IMG: '.player-search-avatar-clip img',
		FULLBODY: '.player-search-avatar'
	},
	// New cards render Foundation buttons; keep the legacy classes for the
	// pre-redesign layout during rollout.
	FRIEND_BUTTON: '.player-search-action-parity, .btn-control-md, .mobile-card-btn',
	NO_RESULTS: '.section-content-off.no-results',
	PROFILE_LINK: '.player-search-profile-link'
} as const;
