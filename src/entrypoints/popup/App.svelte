<script lang="ts">
	import Navbar from '@/components/popup/Navbar.svelte';
	import StatsPage from '@/components/popup/stats/StatsPage.svelte';
	import SettingsSection from '@/components/popup/settings/SettingsSection.svelte';
	import CustomApiManagement from '@/components/popup/options/api/CustomApiManagement.svelte';
	import MembershipPage from '@/components/popup/options/membership/MembershipPage.svelte';
	import FooterSection from '@/components/popup/FooterSection.svelte';
	import LegalPausedBanner from '@/components/popup/LegalPausedBanner.svelte';
	import LoadingSpinner from '@/components/ui/LoadingSpinner.svelte';
	import Toast from '@/components/ui/Toast.svelte';
	import { loadStoredLanguagePreference } from '@/lib/stores/i18n';
	import { loadQueueHistory } from '@/lib/stores/queue-history';
	import { loadDeveloperLogs } from '@/lib/stores/developer-logs';
	import { themeManager } from '@/lib/utils/theme';
	import { logger } from '@/lib/utils/logging/logger';
	import { getStorage, removeStorage, setStorage, subscribeStorageKey } from '@/lib/utils/storage';
	import { _ } from 'svelte-i18n';

	const IS_DEV = import.meta.env.USE_DEV_API === 'true';
	type Surface = 'popup' | 'options';

	type Page =
		| 'stats'
		| 'settings'
		| 'custom-apis'
		| 'custom-api-docs'
		| 'membership'
		| 'performance';

	const LAST_PAGE_STORAGE_KEY = 'lastVisitedPage';

	const POPUP_PAGES = new Set<Page>(['stats', 'settings', 'performance']);

	const optionsTabs: { id: Page; labelKey: string }[] = [
		{ id: 'custom-apis', labelKey: 'custom_api_tab_manage' },
		{ id: 'membership', labelKey: 'membership_tab_label' },
		{ id: 'custom-api-docs', labelKey: 'custom_api_tab_docs' }
	];

	interface Props {
		surface?: Surface;
	}

	let { surface = 'popup' }: Props = $props();

	const isPopupSurface = $derived(surface === 'popup');
	const isOptionsSurface = $derived(surface === 'options');
	let currentPage = $state<Page | null>(null);

	const OPTIONS_PAGES = new Set<Page>(optionsTabs.map((tab) => tab.id));

	function resolveOptionsDeepLink(target: unknown): Page {
		if (typeof target === 'string' && OPTIONS_PAGES.has(target as Page)) {
			return target as Page;
		}
		return 'custom-apis';
	}

	// Resolve the initial options page from a pending deep link on cold start
	$effect(() => {
		if (!isOptionsSurface || currentPage !== null) return;
		void (async () => {
			const target = await getStorage<string | undefined>('local', 'optionsDeepLink', undefined);
			await removeStorage('local', 'optionsDeepLink');
			currentPage = resolveOptionsDeepLink(target);
		})();
	});

	// Handle deep link navigation from popup to an already-open options tab
	$effect(() => {
		if (!isOptionsSurface) return;
		return subscribeStorageKey<Page>('local', 'optionsDeepLink', (newValue) => {
			if (typeof newValue === 'string' && OPTIONS_PAGES.has(newValue)) {
				currentPage = newValue;
				void removeStorage('local', 'optionsDeepLink');
			}
		});
	});

	function handlePageChange(page: Page) {
		currentPage = page;
	}

	async function openCustomApisOptionsPage() {
		await setStorage('local', 'optionsDeepLink', 'custom-apis');
		await browser.runtime.openOptionsPage();
	}

	async function openMembershipOptionsPage() {
		await setStorage('local', 'optionsDeepLink', 'membership');
		await browser.runtime.openOptionsPage();
	}

	$effect(() => {
		loadStoredLanguagePreference().catch((error: unknown) => {
			logger.error('Failed to load language preference:', error);
		});
		loadQueueHistory().catch((error: unknown) => {
			logger.error('Failed to load queue history:', error);
		});
		loadDeveloperLogs().catch((error: unknown) => {
			logger.error('Failed to load developer logs:', error);
		});
	});

	// Load last visited page from storage
	$effect(() => {
		if (!isPopupSurface) return;

		getStorage<Page | undefined>('local', LAST_PAGE_STORAGE_KEY, undefined)
			.then((savedPage) => {
				currentPage =
					savedPage && POPUP_PAGES.has(savedPage) && (IS_DEV || savedPage !== 'performance')
						? savedPage
						: 'stats';
			})
			.catch((error: unknown) => {
				logger.error('Failed to load last visited page:', error);
				currentPage = 'stats';
			});
	});

	// Save current page to storage
	$effect(() => {
		if (!isPopupSurface) return;

		if (currentPage) {
			void setStorage('local', LAST_PAGE_STORAGE_KEY, currentPage).catch((error: unknown) => {
				logger.error('Failed to save last visited page:', error);
			});
		}
	});

	const theme = themeManager.effectiveTheme;
	const logoSrc = $derived(
		$theme === 'dark' ? '/assets/roprotect-logo-dark.webp' : '/assets/roprotect-logo-light.webp'
	);
</script>

<div
	class={isOptionsSurface
		? 'app mx-auto flex max-w-3xl flex-col gap-4 overflow-x-clip px-4 py-6 inline-full min-block-screen'
		: 'app flex flex-col gap-3 p-3 inline-[350px] min-block-[400px]'}
>
	<!-- Toast Notifications -->
	<Toast />

	{#if isPopupSurface}
		<!-- Header Section -->
		<div class="pb-2 text-center">
			<div class="mb-2 flex justify-center">
				<img
					class="object-contin h-20 inline-auto max-inline-[260px]"
					alt="RoProtect"
					src={logoSrc}
				/>
			</div>
			<p
				class="
      text-text-subtle dark:text-text-subtle-dark m-0
      text-xs
    "
			>
				{$_('popup_header_description')}
			</p>
		</div>

		<LegalPausedBanner />

		<!-- Navigation -->
		<Navbar {currentPage} onPageChange={handlePageChange} />
	{/if}

	{#if isOptionsSurface}
		<!-- Options Tab Bar -->
		<nav class="custom-api-tabs" aria-label={$_('custom_api_tab_navigation')}>
			{#each optionsTabs as tab (tab.id)}
				<button
					class="custom-api-tab"
					class:active={currentPage === tab.id}
					aria-pressed={currentPage === tab.id}
					onclick={() => handlePageChange(tab.id)}
					type="button"
				>
					{$_(tab.labelKey)}
				</button>
			{/each}
		</nav>
	{/if}

	<!-- Page Content -->
	<div class="page-content">
		{#if currentPage !== null}
			{#if currentPage === 'stats'}
				<StatsPage />
			{:else if currentPage === 'settings'}
				<div class="settings-page">
					<SettingsSection
						onNavigateToCustomApis={openCustomApisOptionsPage}
						onNavigateToMembership={openMembershipOptionsPage}
						onNavigateToPerformance={IS_DEV ? () => handlePageChange('performance') : undefined}
					/>
				</div>
			{:else if currentPage === 'custom-apis'}
				<CustomApiManagement />
			{:else if currentPage === 'custom-api-docs'}
				{#await import('@/components/popup/options/api/CustomApiDocumentation.svelte')}
					<LoadingSpinner size="medium" />
				{:then mod}
					{@const Component = mod.default}
					<Component />
				{/await}
			{:else if currentPage === 'membership'}
				<MembershipPage />
			{:else if IS_DEV && currentPage === 'performance'}
				{#await import('@/components/popup/developer/PerformanceDashboard.svelte')}
					<LoadingSpinner size="medium" />
				{:then mod}
					{@const Component = mod.default}
					<Component onBack={() => handlePageChange('settings')} />
				{/await}
			{/if}
		{/if}
	</div>

	{#if isPopupSurface}
		<!-- Footer Section -->
		<FooterSection />
	{/if}
</div>
