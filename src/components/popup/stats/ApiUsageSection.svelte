<script lang="ts">
	import { onMount } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import { logger } from '@/lib/utils/logging/logger';
	import { formatCompact, formatNumber } from '@/lib/utils/format';
	import { formatDurationMs, formatShortDate } from '@/lib/utils/time';
	import type { ApiUsage, UsageServiceTotals } from '@/lib/types/usage';

	const SERVICE_FALLBACK_LABELS: Record<string, string> = {
		scsn: 'SIGMANET',
		rab: 'RAB',
		tase: 'TASE'
	};

	let usage = $state<ApiUsage | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const maxOutcome = $derived(
		usage ? Math.max(1, ...usage.outcomes.map((entry) => entry.count)) : 1
	);

	function outcomeLabel(outcome: string): string {
		if (outcome === 'ok') return $_('usage_outcome_ok');
		if (outcome === 'invalid') return $_('usage_outcome_invalid');
		return outcome;
	}

	function serviceLabel(service: string): string {
		if (service === 'scsn') return $_('usage_service_scsn');
		if (service === 'rab') return $_('usage_service_rab');
		if (service === 'tase') return $_('usage_service_tase');
		return SERVICE_FALLBACK_LABELS[service] ?? service.toUpperCase();
	}

	function serviceTotal(service: UsageServiceTotals): string {
		return formatNumber(service.total);
	}

	const successRateText = $derived(
		usage && usage.totalRequests > 0 ? `${usage.successRate.toFixed(1)}%` : '—'
	);

	const firstSeenText = $derived(
		usage?.firstSeen ? (formatShortDate(usage.firstSeen) ?? '—') : '—'
	);
	const lastSeenText = $derived(usage?.lastSeen ? (formatShortDate(usage.lastSeen) ?? '—') : '—');

	async function load() {
		isLoading = true;
		error = null;
		try {
			usage = await apiClient.getUsage();
		} catch (loadError) {
			error = $_('usage_error');
			logger.error('Failed to load API usage:', loadError);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		void load();
	});
</script>

<section class="usage-section">
	<header class="usage-head">
		<h2 class="popup-section-title">{$_('usage_title')}</h2>
		{#if usage?.label}
			<span class="usage-key-label">{usage.label}</span>
		{/if}
	</header>

	{#if isLoading}
		<div class="usage-placeholder">{$_('usage_loading')}</div>
	{:else if error}
		<div class="usage-placeholder" role="alert">
			{error}
			<button class="usage-retry" onclick={() => load()} type="button">
				{$_('usage_retry')}
			</button>
		</div>
	{:else if usage && !usage.hasApiKey}
		<div class="usage-placeholder">
			<p class="usage-placeholder-title">{$_('usage_no_key_title')}</p>
			<p class="usage-placeholder-body">{$_('usage_no_key_body')}</p>
		</div>
	{:else if usage?.totalRequests === 0}
		<div class="usage-placeholder">{$_('usage_no_usage')}</div>
	{:else if usage}
		<div class="usage-metrics">
			<div class="usage-metric">
				<span class="usage-metric-value" title={formatNumber(usage.totalRequests)}>
					{formatCompact(usage.totalRequests)}
				</span>
				<span class="usage-metric-label">{$_('usage_requests')}</span>
			</div>
			<div class="usage-metric">
				<span
					class="usage-metric-value"
					title={$_('usage_success_aria', { values: { 0: formatNumber(usage.successCount) } })}
				>
					{successRateText}
				</span>
				<span class="usage-metric-label">{$_('usage_success_rate')}</span>
			</div>
			<div class="usage-metric">
				<span class="usage-metric-value">{formatDurationMs(usage.avgLatencyMs)}</span>
				<span class="usage-metric-label">{$_('usage_avg_latency')}</span>
			</div>
			<div class="usage-metric">
				<span class="usage-metric-value" title={formatNumber(usage.recentUserCount)}>
					{formatCompact(usage.recentUserCount)}
				</span>
				<span class="usage-metric-label">{$_('usage_users_scanned')}</span>
			</div>
		</div>

		{#if usage.trackedKeyCount > 1}
			<p class="usage-tracked-keys">
				{$_('usage_tracked_keys', { values: { 0: String(usage.trackedKeyCount) } })}
			</p>
		{/if}

		{#if usage.outcomes.length > 0}
			<div class="usage-group">
				<h3 class="usage-group-title">{$_('usage_outcomes_title')}</h3>
				{#each usage.outcomes as outcome (outcome.outcome)}
					<div class="usage-outcome">
						<span class="usage-outcome-label">{outcomeLabel(outcome.outcome)}</span>
						<span class="usage-outcome-count">{formatNumber(outcome.count)}</span>
						<div
							class="usage-outcome-bar"
							aria-label={$_('usage_outcome_aria', {
								values: {
									0: outcomeLabel(outcome.outcome),
									1: formatNumber(outcome.count)
								}
							})}
							role="img"
						>
							<div
								style:width="{String((outcome.count / maxOutcome) * 100)}%"
								class="usage-outcome-bar-fill"
							></div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if usage.services.length > 0}
			<div class="usage-group">
				<h3 class="usage-group-title">{$_('usage_services_title')}</h3>
				{#each usage.services as service (service.service)}
					<div class="usage-service">
						<span class="usage-service-name">{serviceLabel(service.service)}</span>
						<span class="usage-service-counts">
							{formatNumber(service.single)}&nbsp;{$_('usage_service_single')}
							·&nbsp;{formatNumber(service.batch)}&nbsp;{$_('usage_service_batch')}
						</span>
						<span class="usage-service-total">{serviceTotal(service)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="usage-group">
			<div class="usage-daterow">
				<span class="usage-daterow-label">{$_('usage_first_request')}</span>
				<span class="usage-daterow-value">{firstSeenText}</span>
			</div>
			<div class="usage-daterow">
				<span class="usage-daterow-label">{$_('usage_last_request')}</span>
				<span class="usage-daterow-value">{lastSeenText}</span>
			</div>
		</div>
	{/if}
</section>
