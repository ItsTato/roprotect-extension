<script lang="ts">
	import { Copy, Calendar, Clock, Eye, ChevronRight, Check, X, Server } from '@lucide/svelte';
	import { _ } from 'svelte-i18n';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import CanvasText from '@/components/ui/CanvasText.svelte';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import type {
		TaseUserRecord,
		TaseDiscordAccount,
		TaseDetectionType,
		DiscordAvatar
	} from '@/lib/schemas/custom-api';
	import { formatTimestamp, formatShortDate } from '@/lib/utils/time';

	interface Props {
		taseRecord: TaseUserRecord;
		avatars: Record<string, DiscordAvatar>;
	}

	let { taseRecord, avatars }: Props = $props();

	let expandedAccounts = new SvelteSet<string>();
	let copyStates = new SvelteMap<string, 'idle' | 'success' | 'error'>();

	const categoryLabels: Record<number, string> = {
		1: 'CSAM',
		2: 'Sexual',
		3: 'Kink',
		4: 'Raceplay',
		5: 'Condo',
		6: 'Other'
	};

	const flagTypeIconNames: Record<string, 'unsafe' | 'past-offender'> = {
		unsafe: 'unsafe',
		past_offender: 'past-offender'
	};

	const flagTypeColors: Record<string, string> = {
		unsafe: 'var(--color-status-unsafe)',
		past_offender: 'var(--color-status-past-offender)'
	};

	// The background inlines the bytes as a data URL because roblox.com's page CSP
	// blocks cdn.discordapp.com in `img-src`.
	function getAvatarUrl(discordId: string): string | null {
		return avatars[discordId]?.avatarDataUrl ?? null;
	}

	function getDisplayName(discordId: string): string | null {
		const avatar = avatars[discordId];
		if (!avatar) return null;
		return avatar.displayName || avatar.globalName || avatar.username || null;
	}

	function getUsername(discordId: string): string | null {
		return avatars[discordId]?.username ?? null;
	}

	function getFlagTypeForAccount(account: TaseDiscordAccount): 'unsafe' | 'past_offender' | null {
		if (account.detectedGuilds.length === 0) return null;
		const hasUnsafe = account.detectedGuilds.some((g) => g.flag_type === 'unsafe');
		return hasUnsafe ? 'unsafe' : 'past_offender';
	}

	// The per-server scores are independent scales, so this is a plain sum shown
	// as an account-level rollup rather than a mean. Null when no server scored.
	function getTotalScore(account: TaseDiscordAccount): number | null {
		let total = 0;
		let scored = false;
		for (const guild of account.detectedGuilds) {
			if (guild.score == null) continue;
			total += guild.score;
			scored = true;
		}
		return scored ? total : null;
	}

	function formatDate(timestamp: number | null | undefined): string | null {
		if (!timestamp) return null;
		return formatShortDate(timestamp) ?? formatTimestamp(timestamp);
	}

	async function copyToClipboard(text: string, key: string): Promise<void> {
		copyStates.set(key, 'idle');
		try {
			await navigator.clipboard.writeText(text);
			copyStates.set(key, 'success');
		} catch {
			copyStates.set(key, 'error');
		}
		setTimeout(() => copyStates.delete(key), 2000);
	}

	function copyDiscordId(discordId: string): void {
		void copyToClipboard(discordId, `id-${discordId}`);
	}

	function copyUsername(username: string): void {
		void copyToClipboard(username, `username-${username}`);
	}

	function copyServerId(guildId: string): void {
		void copyToClipboard(guildId, `guild-${guildId}`);
	}

	function toggleAccount(discordId: string): void {
		if (expandedAccounts.has(discordId)) {
			expandedAccounts.delete(discordId);
		} else {
			expandedAccounts.add(discordId);
		}
	}

	function getDetectionTypeNames(types: TaseDetectionType[] | null | undefined): string[] {
		if (!types) return [];
		return types.map((t) => t.name).filter((n): n is string => !!n);
	}

	function getCategoryName(category: string | number | null | undefined): string | undefined {
		if (!category) return undefined;
		const num = typeof category === 'string' ? Number.parseInt(category, 10) : category;
		if (Number.isNaN(num)) return undefined;
		return categoryLabels[num] ?? String(category);
	}
</script>

{#snippet copyIcon(key: string)}
	{#if copyStates.get(key) === 'success'}
		<Check size={12} strokeWidth={2.5} />
	{:else if copyStates.get(key) === 'error'}
		<X size={12} strokeWidth={2.5} />
	{:else}
		<Copy size={12} strokeWidth={2.5} />
	{/if}
{/snippet}

{#if Object.keys(taseRecord.detections).length > 0}
	<div class="tase-v2-container">
		<div class="tase-summary">
			<span class="tase-summary-item">
				<CanvasText text={$_('tase_discord_accounts_title')} />
				<span class="tase-summary-count">{Object.keys(taseRecord.detections).length}</span>
			</span>
			{#if taseRecord.firstSeenAt}
				<span class="tase-summary-separator"></span>
				<span
					class="tase-summary-item"
					title={$_('tase_first_seen_tooltip', {
						values: { 0: formatTimestamp(taseRecord.firstSeenAt) }
					})}
				>
					<Calendar size={12} />
					<span class="text-xs-plus">
						<CanvasText
							text={$_('tase_first_seen', {
								values: {
									0: formatShortDate(taseRecord.firstSeenAt) ?? $_('tooltip_discord_unknown')
								}
							})}
						/>
					</span>
				</span>
			{/if}
			{#if taseRecord.lastSeenAt}
				<span class="tase-summary-separator"></span>
				<span
					class="tase-summary-item"
					title={$_('tase_last_seen_tooltip', {
						values: { 0: formatTimestamp(taseRecord.lastSeenAt) }
					})}
				>
					<Clock size={12} />
					<span class="text-xs-plus">
						<CanvasText
							text={$_('tase_last_seen', {
								values: {
									0: formatShortDate(taseRecord.lastSeenAt) ?? $_('tooltip_discord_unknown')
								}
							})}
						/>
					</span>
				</span>
			{/if}
		</div>

		{#each Object.entries(taseRecord.detections) as [discordId, account] (discordId)}
			{@const isExpanded = expandedAccounts.has(discordId)}
			{@const accountFlagType = getFlagTypeForAccount(account)}
			{@const avatarUrl = getAvatarUrl(discordId)}
			{@const displayName = getDisplayName(discordId)}
			{@const username = getUsername(discordId)}
			{@const totalScore = getTotalScore(account)}
			<div class="tase-account-card" class:expanded={isExpanded}>
				<div class="tase-account-header">
					<span class="tase-chevron-cell">
						<button
							class="tase-account-toggle"
							aria-expanded={isExpanded}
							onclick={() => toggleAccount(discordId)}
							type="button"
						>
							<span
								style:transform={isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}
								class="tase-chevron-wrapper"
							>
								<ChevronRight class="tase-chevron" size={14} />
							</span>
						</button>
					</span>

					<span class="tase-avatar-holder">
						<span class="tase-avatar-anchor">
							<span class="tase-avatar-frame">
								{#if avatarUrl}
									<img class="tase-avatar" alt="" loading="lazy" src={avatarUrl} />
								{:else}
									<Server class="tase-avatar-placeholder" size={14} />
								{/if}
							</span>
							{#if accountFlagType}
								{@const flagLabel =
									accountFlagType === 'past_offender'
										? $_('tase_flag_past_offender')
										: $_('tase_flag_unsafe')}
								<span class="tase-flag-anchor">
									<span
										style:--tase-flag-color={flagTypeColors[accountFlagType] ??
											'var(--color-status-unsafe)'}
										class="tase-flag-badge"
									>
										<StatusIcon
											name={flagTypeIconNames[accountFlagType] ?? 'unsafe'}
											color="white"
											size={12}
											strokeWidth={2.5}
										/>
									</span>
									<span class="tase-flag-tooltip" role="tooltip">{flagLabel}</span>
								</span>
							{/if}
						</span>
					</span>

					<span class="tase-account-meta">
						{#if totalScore !== null}
							<span class="tase-total-score">
								<Eye size={10} strokeWidth={2.5} />
								<span class="text-2xs">
									<CanvasText
										text={$_('tase_total_score', { values: { 0: String(totalScore) } })}
									/>
								</span>
							</span>
						{/if}
						<span class="tase-server-count">
							<CanvasText
								text={$_('tase_servers_count', {
									values: { 0: account.detectedGuilds.length }
								})}
							/>
						</span>
					</span>

					<span class="tase-identity-row tase-identity-primary">
						<button
							class="tase-identity-text"
							onclick={() => toggleAccount(discordId)}
							type="button"
						>
							{#if displayName}
								<CanvasText text={displayName} />
								{#if username && username !== displayName}
									<span class="tase-account-handle">@{username}</span>
								{/if}
							{:else}
								<CanvasText text={discordId} />
							{/if}
						</button>
						{#if username}
							<button
								class="tase-copy-btn"
								class:error={copyStates.get(`username-${username}`) === 'error'}
								class:success={copyStates.get(`username-${username}`) === 'success'}
								aria-label={$_('tase_copy_username')}
								onclick={() => copyUsername(username)}
								title={$_(
									copyStates.get(`username-${username}`) === 'success'
										? 'tase_copied'
										: copyStates.get(`username-${username}`) === 'error'
											? 'tase_copy_failed'
											: 'tase_copy_username'
								)}
								type="button"
							>
								{@render copyIcon(`username-${username}`)}
							</button>
						{/if}
					</span>

					<span class="tase-identity-row tase-identity-secondary">
						<button
							class="tase-identity-text tase-account-snowflake"
							onclick={() => toggleAccount(discordId)}
							type="button"
						>
							<CanvasText text={discordId} />
						</button>
						<button
							class="tase-copy-btn"
							class:error={copyStates.get(`id-${discordId}`) === 'error'}
							class:success={copyStates.get(`id-${discordId}`) === 'success'}
							aria-label={$_('tase_copy_discord_id')}
							onclick={() => copyDiscordId(discordId)}
							title={$_(
								copyStates.get(`id-${discordId}`) === 'success'
									? 'tase_copied'
									: copyStates.get(`id-${discordId}`) === 'error'
										? 'tase_copy_failed'
										: 'tase_copy_discord_id'
							)}
							type="button"
						>
							{@render copyIcon(`id-${discordId}`)}
						</button>
					</span>
				</div>

				<div class="tase-account-content" hidden={!isExpanded}>
					{#if account.detectedGuilds.length > 0}
						{#each account.detectedGuilds as guild (guild.guildId)}
							{@const guildFlagColor =
								flagTypeColors[guild.flag_type] ?? 'var(--color-text-tertiary)'}
							{@const categoryName = getCategoryName(guild.category)}
							{@const typeNames = getDetectionTypeNames(guild.types)}
							<div class="tase-server-item">
								<div class="tase-server-row">
									<div class="tase-server-info">
										<span style:color={guildFlagColor} class="tase-server-flag">
											<StatusIcon
												name={flagTypeIconNames[guild.flag_type] ?? 'unsafe'}
												color={guildFlagColor}
												size={12}
											/>
										</span>
										<span class="tase-server-name">
											<CanvasText text={guild.guildName ?? $_('tase_unknown_guild')} />
										</span>
									</div>
									{#if guild.firstSeenAt ?? guild.lastSeenAt}
										<div class="tase-server-date">
											{#if guild.firstSeenAt}
												<span
													title={$_('tase_first_seen_tooltip', {
														values: { 0: formatTimestamp(guild.firstSeenAt) }
													})}
												>
													<CanvasText
														text={$_('tase_detected_label', {
															values: {
																0: formatDate(guild.firstSeenAt) ?? $_('tooltip_discord_unknown')
															}
														})}
													/>
												</span>
											{/if}
											{#if guild.firstSeenAt && guild.lastSeenAt}
												<span class="tase-date-separator">•</span>
											{/if}
											{#if guild.lastSeenAt}
												<span
													title={$_('tase_last_seen_tooltip', {
														values: { 0: formatTimestamp(guild.lastSeenAt) }
													})}
												>
													<CanvasText
														text={$_('tase_updated_label', {
															values: {
																0: formatDate(guild.lastSeenAt) ?? $_('tooltip_discord_unknown')
															}
														})}
													/>
												</span>
											{/if}
										</div>
									{/if}
								</div>
								<div class="tase-server-meta">
									<button
										class="tase-server-tag tase-server-id"
										class:error={copyStates.get(`guild-${guild.guildId}`) === 'error'}
										class:success={copyStates.get(`guild-${guild.guildId}`) === 'success'}
										onclick={() => copyServerId(guild.guildId)}
										title={$_(
											copyStates.get(`guild-${guild.guildId}`) === 'success'
												? 'tase_copied'
												: copyStates.get(`guild-${guild.guildId}`) === 'error'
													? 'tase_copy_failed'
													: 'tase_copy_server_id'
										)}
										type="button"
									>
										<span class="text-2xs"><CanvasText text={guild.guildId} /></span>
										{@render copyIcon(`guild-${guild.guildId}`)}
									</button>
									{#if guild.score != null}
										<span class="tase-server-tag">
											<Eye size={10} strokeWidth={2.5} />
											<span class="text-2xs">
												<CanvasText
													text={$_('tase_activity_score', { values: { 0: String(guild.score) } })}
												/>
											</span>
										</span>
									{/if}
									{#if categoryName}
										<span class="tase-server-tag">
											<span class="text-2xs"><CanvasText text={categoryName} /></span>
										</span>
									{/if}
									{#if typeNames.length > 0}
										<span class="tase-server-tag">
											<span class="text-2xs"><CanvasText text={typeNames.join(', ')} /></span>
										</span>
									{/if}
								</div>
							</div>
						{/each}
					{:else}
						<div class="tase-no-guilds">
							<span class="text-xs-plus"><CanvasText text={$_('tase_no_detections')} /></span>
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="tase-v2-empty">
		<span class="text-xs-plus"><CanvasText text={$_('tase_no_linked_accounts')} /></span>
	</div>
{/if}
