<script lang="ts">
	import PascDisplay from '@/components/status/PascDisplay.svelte';
	import PascEditModal from '@/components/status/PascEditModal.svelte';
	import {
		MOCK_PASC_DISCORD_ACCOUNTS,
		MOCK_PASC_RECORD,
		MOCK_PASC_RESTRICTED_RECORD,
		PASC_ACCESS_RANK,
		pickPascReferral,
		type PascAccessLevel
	} from '@/lib/data/pasc-mock';

	// DEV MOCKUP ONLY — renders the PASC visual scaffold with mock data so the
	// look can be iterated before any backend exists (see T:\Python Projects\TLET\PASC\PASC.md). Mounted at
	// the bottom of the popup Stats page so it shows in all builds.
	// Delete this file (and its mount) once the real provider ships.

	const LEVELS = Object.keys(PASC_ACCESS_RANK) as PascAccessLevel[];

	let viewerLevel = $state<PascAccessLevel>('A2');
	let editing = $state(false);

	const canEdit = $derived(PASC_ACCESS_RANK[viewerLevel] >= PASC_ACCESS_RANK.M1);
	const mockReferral = pickPascReferral(MOCK_PASC_RECORD.providerVerdicts);
</script>

<div class="pasc-mock-banner">
	PASC MOCKUP — provider tab &amp; edit window preview (see T:\Python Projects\TLET\PASC\PASC.md).
	Hardcoded English strings; real implementation needs i18n keys. Your clearance:
	<select class="pasc-select" aria-label="Mock viewer access level" bind:value={viewerLevel}>
		{#each LEVELS as level (level)}
			<option value={level}>{level}</option>
		{/each}
	</select>
	{#if canEdit}(edit button visible — M1+){/if}
</div>

<PascDisplay
	{canEdit}
	discordAccounts={MOCK_PASC_DISCORD_ACCOUNTS}
	onEdit={() => (editing = true)}
	record={MOCK_PASC_RECORD}
	{viewerLevel}
/>

<div class="pasc-mock-banner">
	Same user, M2-only record — below M2 clearance the flag still shows, only the case details stay
	gated:
</div>

<PascDisplay
	{canEdit}
	discordAccounts={MOCK_PASC_DISCORD_ACCOUNTS}
	onEdit={() => (editing = true)}
	record={MOCK_PASC_RESTRICTED_RECORD}
	{viewerLevel}
/>

<div class="pasc-mock-banner">
	User with no PASC record — verdict referred to the highest relied-upon provider, no override:
</div>

<PascDisplay
	{canEdit}
	discordAccounts={MOCK_PASC_DISCORD_ACCOUNTS}
	onEdit={() => (editing = true)}
	record={null}
	referral={mockReferral}
	{viewerLevel}
/>

{#if editing}
	<div class="modal-overlay visible">
		<PascEditModal onClose={() => (editing = false)} record={MOCK_PASC_RECORD} />
	</div>
{/if}
