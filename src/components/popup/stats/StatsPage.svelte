<script lang="ts">
	import { loadStats, statsRange } from '@/lib/stores/stats';
	import { STATS_POLL_INTERVAL } from '@/lib/types/stats';
	import ActivitySection from './ActivitySection.svelte';
	import QueueLimitsDisplay from '@/components/features/queue/QueueLimitsDisplay.svelte';
	import TotalsBand from './TotalsBand.svelte';

	$effect(() => {
		const hours = $statsRange;
		void loadStats(hours);
		const id = setInterval(() => {
			void loadStats(hours, true);
		}, STATS_POLL_INTERVAL);
		return () => clearInterval(id);
	});
</script>

<div class="stats-page">
	<TotalsBand />

	<div class="popup-divider"></div>

	<ActivitySection />

	<div class="popup-divider"></div>

	<QueueLimitsDisplay />
</div>
