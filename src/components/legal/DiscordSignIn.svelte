<script lang="ts">
	import { onDestroy } from 'svelte';
	import { _ } from 'svelte-i18n';
	import SiDiscord from '@icons-pack/svelte-simple-icons/icons/SiDiscord';
	import { CircleAlert, CircleCheckBig, RotateCcw } from '@lucide/svelte';
	import LoadingSpinner from '@/components/ui/LoadingSpinner.svelte';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import { loadCustomApis } from '@/lib/stores/custom-apis';
	import { updateSetting } from '@/lib/stores/settings';
	import { showSuccess } from '@/lib/stores/toast';
	import { SETTINGS_KEYS } from '@/lib/types/settings';
	import type { DiscordSignInPoll, DiscordSignInReady } from '@/lib/types/api';
	import { asApiError } from '@/lib/utils/api/api-error';
	import { logger } from '@/lib/utils/logging/logger';

	interface Props {
		// Fired only when a usable key was stored, so callers can close a gate modal.
		onSuccess?: () => void;
		// cdn.discordapp.com is blocked by roblox.com's img-src CSP, so the content
		// overlay opts out and falls back to the Discord glyph.
		showAvatar?: boolean;
	}

	let { onSuccess, showAvatar = true }: Props = $props();

	type Phase = 'idle' | 'starting' | 'waiting' | 'success' | 'admin-linked' | 'error';
	type ErrorKind = 'not-configured' | 'server' | 'expired' | 'timeout' | 'network';

	const POLL_INTERVAL_MS = 1000;
	const MAX_WAIT_MS = 10 * 60 * 1000;
	const MAX_CONSECUTIVE_POLL_ERRORS = 5;

	let phase = $state<Phase>('idle');
	let profile = $state<DiscordSignInReady | null>(null);
	let errorKind = $state<ErrorKind>('server');
	let avatarFailed = $state(false);

	// Every new attempt bumps the token; stale polls and cancelled waits compare
	// against it and silently bail out.
	let runToken = 0;
	let pollTimer: ReturnType<typeof setTimeout> | null = null;
	let resolveWait: (() => void) | null = null;

	const errorMessage = $derived.by(() => {
		switch (errorKind) {
			case 'not-configured': {
				return $_('discord_signin_error_not_configured');
			}
			case 'expired': {
				return $_('discord_signin_error_expired');
			}
			case 'timeout': {
				return $_('discord_signin_error_timeout');
			}
			case 'network': {
				return $_('discord_signin_error_network');
			}
			default: {
				return $_('discord_signin_error_server');
			}
		}
	});

	function wait(ms: number): Promise<void> {
		return new Promise((resolve) => {
			resolveWait = resolve;
			pollTimer = setTimeout(() => {
				pollTimer = null;
				resolveWait = null;
				resolve();
			}, ms);
		});
	}

	function stopWaiting(): void {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
		const resolve = resolveWait;
		resolveWait = null;
		resolve?.();
	}

	function resetState(): void {
		profile = null;
		avatarFailed = false;
	}

	function applyError(error: unknown): void {
		const apiError = asApiError(error);
		switch (apiError.status) {
			case 503: {
				errorKind = 'not-configured';
				break;
			}
			case 408: {
				errorKind = 'timeout';
				break;
			}
			case 0: {
				errorKind = 'network';
				break;
			}
			default: {
				errorKind = 'server';
			}
		}
		phase = 'error';
		// `error` here is a messaging/HTTP error and never carries the delivered key.
		logger.error('Discord sign-in failed', {
			status: apiError.status,
			code: apiError.code
		});
	}

	async function completeSignIn(data: DiscordSignInReady, token: number): Promise<void> {
		profile = data;
		const key = data.key?.trim() ?? '';

		// Admin-scoped accounts intentionally receive no key through the portal.
		if (!key) {
			phase = 'admin-linked';
			return;
		}

		await updateSetting(SETTINGS_KEYS.API_KEY, key);
		if (token !== runToken) return;

		// Surface success before the gate modal unmounts (saving the key flips
		// `hasApiKey`, which tears the modal down). The custom-API refresh can
		// finish afterwards without losing the toast.
		phase = 'success';
		showSuccess(
			$_('discord_signin_success', {
				values: { 0: data.displayName ?? data.username }
			})
		);
		onSuccess?.();

		// Same refresh path as a hand-pasted key; a failure must not undo the save.
		try {
			await loadCustomApis();
		} catch (error) {
			logger.error('Discord sign-in: failed to refresh custom APIs', error);
		}
	}

	async function pollUntilReady(pair: string, token: number, deadline: number): Promise<void> {
		let consecutiveErrors = 0;

		while (Date.now() < deadline) {
			await wait(POLL_INTERVAL_MS);
			if (token !== runToken) return;

			let poll: DiscordSignInPoll;
			try {
				poll = await apiClient.pollDiscordSignIn(pair);
			} catch (error) {
				if (token !== runToken) return;
				consecutiveErrors++;
				if (consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw error;
				continue;
			}

			consecutiveErrors = 0;
			if (token !== runToken) return;

			if (poll.status === 'pending') continue;

			// The pair is single-use and now expired/consumed. Never re-poll it.
			if (poll.status === 'unknown') {
				errorKind = 'expired';
				phase = 'error';
				return;
			}

			await completeSignIn(poll, token);
			return;
		}

		if (token !== runToken) return;
		errorKind = 'timeout';
		phase = 'error';
	}

	async function start(): Promise<void> {
		if (phase === 'starting' || phase === 'waiting') return;

		const token = ++runToken;
		resetState();
		phase = 'starting';

		try {
			const { pair } = await apiClient.startDiscordSignIn();
			if (token !== runToken) return;

			phase = 'waiting';
			await pollUntilReady(pair, token, Date.now() + MAX_WAIT_MS);
		} catch (error) {
			if (token !== runToken) return;
			applyError(error);
		}
	}

	function cancel(): void {
		runToken++;
		stopWaiting();
		resetState();
		phase = 'idle';
	}

	function retry(): void {
		void start();
	}

	onDestroy(() => {
		runToken++;
		stopWaiting();
	});
</script>

<div class="discord-signin">
	{#if phase === 'idle' || phase === 'starting'}
		<button
			class="discord-signin-button"
			disabled={phase === 'starting'}
			onclick={start}
			type="button"
		>
			{#if phase === 'starting'}
				<LoadingSpinner size="small" />
				<span>{$_('discord_signin_starting')}</span>
			{:else}
				<SiDiscord size={16} />
				<span>{$_('discord_signin_button')}</span>
			{/if}
		</button>
	{:else if phase === 'waiting'}
		<div class="discord-signin-waiting" aria-live="polite" role="status">
			<LoadingSpinner size="small" />
			<p class="discord-signin-waiting-text">{$_('discord_signin_waiting')}</p>
			<button class="discord-signin-cancel" onclick={cancel} type="button">
				{$_('discord_signin_cancel')}
			</button>
		</div>
	{:else if phase === 'error'}
		<div class="discord-signin-error" role="alert">
			<CircleAlert class="discord-signin-error-icon" size={15} />
			<p class="discord-signin-error-text">{errorMessage}</p>
		</div>
		{#if errorKind !== 'not-configured'}
			<button class="discord-signin-retry" onclick={retry} type="button">
				<RotateCcw size={13} />
				<span>{$_('discord_signin_retry')}</span>
			</button>
		{/if}
	{:else if profile}
		<div
			class="discord-signin-result"
			class:discord-signin-result-warning={phase === 'admin-linked'}
		>
			<div class="discord-signin-profile">
				{#if showAvatar && profile.avatarUrl && !avatarFailed}
					<img
						class="discord-signin-avatar"
						alt=""
						onerror={() => (avatarFailed = true)}
						referrerpolicy="no-referrer"
						src={profile.avatarUrl}
					/>
				{:else}
					<span class="discord-signin-avatar discord-signin-avatar-fallback">
						<SiDiscord size={18} />
					</span>
				{/if}
				<div class="discord-signin-identity">
					<span class="discord-signin-name">{profile.displayName ?? profile.username}</span>
					<span class="discord-signin-username">@{profile.username}</span>
				</div>
				{#if phase === 'success'}
					<CircleCheckBig class="discord-signin-status-icon success" size={18} />
				{:else}
					<CircleAlert class="discord-signin-status-icon warning" size={18} />
				{/if}
			</div>

			<p class="discord-signin-message">
				{#if phase === 'success'}
					{$_('discord_signin_success', {
						values: { 0: profile.displayName ?? profile.username }
					})}
				{:else}
					{$_('discord_signin_admin_linked')}
				{/if}
			</p>

			<div class="discord-signin-meta">
				<span class="discord-signin-meta-label">{$_('discord_signin_key_access')}</span>
				{#if profile.services.length > 0}
					<span class="discord-signin-pills">
						{#each profile.services as service (service)}
							<span class="discord-signin-pill">{service}</span>
						{/each}
					</span>
				{:else}
					<span class="discord-signin-meta-value">—</span>
				{/if}
			</div>

			<div class="discord-signin-meta">
				<span class="discord-signin-meta-label">{$_('discord_signin_key_id')}</span>
				<code class="discord-signin-fingerprint">{profile.fingerprint}</code>
			</div>

			{#if phase === 'admin-linked'}
				<button class="discord-signin-retry" onclick={retry} type="button">
					<RotateCcw size={13} />
					<span>{$_('discord_signin_retry')}</span>
				</button>
			{/if}
		</div>
	{/if}
</div>
