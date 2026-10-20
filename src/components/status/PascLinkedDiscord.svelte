<script lang="ts">
	import SiDiscord from '@icons-pack/svelte-simple-icons/icons/SiDiscord';
	import { ChevronDown, Flag, Server, Users } from '@lucide/svelte';
	import { _ } from 'svelte-i18n';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import {
		PASC_FLAG_COLORS,
		PASC_FLAG_LABELS,
		type PascAccessLevel,
		type PascDiscordAccount
	} from '@/lib/data/pasc';

	// Compact RoWifi account block for the PASC tab. The full TASE display
	// carries score/date metadata that PASC does not receive; this keeps the
	// moderator-facing essentials — identity, severity, servers — in one
	// scannable card and states the clearance the block was released under.

	interface Props {
		accounts: PascDiscordAccount[];
		viewerLevel: PascAccessLevel;
		accessLevel?: PascAccessLevel | null;
	}

	let { accounts, viewerLevel, accessLevel = null }: Props = $props();

	let expandedId = $state<string | null>(null);

	const totalServers = $derived(accounts.reduce((sum, account) => sum + account.servers.length, 0));
	const flaggedServers = $derived(
		accounts.reduce(
			(sum, account) =>
				sum + account.servers.filter((server) => server.flagType === 'unsafe').length,
			0
		)
	);

	function getAccountFlag(account: PascDiscordAccount): 'unsafe' | 'past_offender' | null {
		if (account.servers.some((server) => server.flagType === 'unsafe')) return 'unsafe';
		return account.servers.length > 0 ? 'past_offender' : null;
	}

	function toggleAccount(id: string): void {
		expandedId = expandedId === id ? null : id;
	}
</script>

{#snippet accountBody(
	account: PascDiscordAccount,
	flag: 'unsafe' | 'past_offender' | null,
	displayName: string
)}
	<span class="pasc-discord-avatar">
		{#if account.avatarDataUrl}
			<img class="pasc-discord-avatar-img" alt="" loading="lazy" src={account.avatarDataUrl} />
		{:else}
			<Server class="pasc-discord-avatar-fallback" size={13} />
		{/if}
		{#if flag}
			<span style:--pasc-discord-flag={PASC_FLAG_COLORS[flag]} class="pasc-discord-avatar-flag">
				<StatusIcon
					name={flag === 'unsafe' ? 'unsafe' : 'past-offender'}
					color="white"
					size={9}
					strokeWidth={2.5}
				/>
			</span>
		{/if}
	</span>

	<span class="pasc-discord-identity">
		<span class="pasc-discord-name">{displayName}</span>
		{#if account.username !== displayName}
			<span class="pasc-discord-handle">@{account.username}</span>
		{/if}
		<span class="pasc-discord-id">{account.id}</span>
	</span>

	<span class="pasc-discord-side">
		<span class="pasc-discord-server-count">
			{$_('pasc_discord_server_count', { values: { 0: String(account.serverCount) } })}
		</span>
		{#if account.servers.length > 0}
			<ChevronDown class="pasc-discord-chevron" size={13} />
		{/if}
	</span>
{/snippet}

<section class="pasc-discord">
	<div class="pasc-discord-header">
		{#if accessLevel}
			<span
				class="pasc-access-chip"
				title={$_('pasc_discord_access_title', {
					values: { 0: accessLevel, 1: viewerLevel }
				})}
			>
				{accessLevel}
			</span>
		{/if}
		<h4 class="pasc-discord-title">
			<SiDiscord size={13} />
			{$_('pasc_discord_linked')}
		</h4>
		<div
			class="pasc-discord-summary"
			aria-label={flaggedServers > 0
				? $_('pasc_discord_summary_aria_flagged', {
						values: {
							0: String(accounts.length),
							1: String(totalServers),
							2: String(flaggedServers)
						}
					})
				: $_('pasc_discord_summary_aria', {
						values: {
							0: String(accounts.length),
							1: String(totalServers)
						}
					})}
		>
			<span
				class="pasc-discord-summary-item"
				title={$_('pasc_discord_accounts_title', {
					values: { 0: String(accounts.length) }
				})}
			>
				<Users size={11} />
				{accounts.length}
			</span>
			<span
				class="pasc-discord-summary-item"
				title={$_('pasc_discord_servers_title', {
					values: { 0: String(totalServers) }
				})}
			>
				<Server size={11} />
				{totalServers}
			</span>
			{#if flaggedServers > 0}
				<span
					class="pasc-discord-summary-item pasc-discord-flagged"
					title={$_('pasc_discord_flagged_servers_title', {
						values: { 0: String(flaggedServers) }
					})}
				>
					<Flag size={11} />
					{flaggedServers}
				</span>
			{/if}
		</div>
	</div>

	<ul class="pasc-discord-list">
		{#each accounts as account (account.id)}
			{@const flag = getAccountFlag(account)}
			{@const expanded = expandedId === account.id}
			{@const displayName = account.globalName || account.username}
			{@const expandable = account.servers.length > 0}
			<li class="pasc-discord-account" class:is-expanded={expanded}>
				{#if expandable}
					<button
						class="pasc-discord-account-button"
						aria-expanded={expanded}
						onclick={() => toggleAccount(account.id)}
						type="button"
					>
						{@render accountBody(account, flag, displayName)}
					</button>
				{:else}
					<div class="pasc-discord-account-button is-static">
						{@render accountBody(account, flag, displayName)}
					</div>
				{/if}

				{#if expanded && expandable}
					<ul class="pasc-discord-servers">
						{#each account.servers as server (server.id)}
							<li class="pasc-discord-server">
								<StatusIcon
									name={server.flagType === 'unsafe' ? 'unsafe' : 'past-offender'}
									color={PASC_FLAG_COLORS[server.flagType]}
									size={11}
								/>
								<span class="pasc-discord-server-name">{server.name}</span>
								<span
									style:color={PASC_FLAG_COLORS[server.flagType]}
									class="pasc-discord-server-flag"
								>
									{$_(PASC_FLAG_LABELS[server.flagType])}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</li>
		{/each}
	</ul>
</section>
