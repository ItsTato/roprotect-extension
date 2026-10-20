<script lang="ts">
	import { scanGroupsForUser } from '@/lib/services/rotector/scan-jobs';
	import type { ScanProgressCallback } from '@/lib/services/rotector/scan-jobs';
	import ScanBar from '../scan/ScanBar.svelte';

	interface Props {
		userId: string;
	}

	let { userId }: Props = $props();

	function scan(onProgress: ScanProgressCallback, signal: AbortSignal) {
		return scanGroupsForUser(userId, onProgress, signal);
	}
</script>

<ScanBar label="groups" {scan} />
