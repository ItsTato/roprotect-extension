<script lang="ts">
	import { scanFriendsForUser } from '@/lib/services/rotector/scan-jobs';
	import type { ScanProgressCallback } from '@/lib/services/rotector/scan-jobs';
	import ScanBar from '../scan/ScanBar.svelte';

	interface Props {
		userId: string;
		isOwnFriends?: boolean;
	}

	let { userId, isOwnFriends = true }: Props = $props();

	function scan(onProgress: ScanProgressCallback, signal: AbortSignal) {
		return scanFriendsForUser(userId, isOwnFriends, onProgress, signal);
	}
</script>

<ScanBar label="friends" {scan} />
