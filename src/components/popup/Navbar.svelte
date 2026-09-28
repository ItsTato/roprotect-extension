<script lang="ts">
	import { _ } from 'svelte-i18n';

	type NavPage = 'stats' | 'settings';

	interface NavbarProps {
		currentPage: string | null;
		onPageChange: (page: NavPage) => void;
	}

	let { currentPage, onPageChange }: NavbarProps = $props();

	const tabs: { id: NavPage; labelKey: string }[] = [
		{ id: 'stats', labelKey: 'navbar_tab_stats' },
		{ id: 'settings', labelKey: 'navbar_tab_settings' }
	];
</script>

<nav class="navbar-text-tabs" aria-label="Primary">
	{#each tabs as { id, labelKey } (id)}
		<button
			class="navbar-tab"
			class:active={currentPage === id}
			aria-current={currentPage === id ? 'page' : undefined}
			onclick={() => onPageChange(id)}
			type="button"
		>
			{$_(labelKey)}
		</button>
	{/each}
</nav>
