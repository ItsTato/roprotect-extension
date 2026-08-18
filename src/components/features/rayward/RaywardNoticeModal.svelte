<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { ExternalLink } from '@lucide/svelte';
	import AppLogo from '@/components/ui/AppLogo.svelte';
	import ExtLink from '@/components/ui/ExtLink.svelte';
	import Modal from '@/components/ui/Modal.svelte';
	import SourceLogo from '@/components/ui/SourceLogo.svelte';
	import { markRaywardNoticeSeen, shouldShowRaywardNotice } from '@/lib/stores/rayward-notice';
	import { RAYWARD_ANNOUNCEMENT_URL, RAYWARD_URL } from '@/lib/types/constants';
	import { logger } from '@/lib/utils/logging/logger';

	const DETECTION_PROJECTS = ['rotector', 'rab', 'tase', 'okappiki'] as const;

	const accessRows = [
		{
			labelKey: 'rayward_notice_access_public_label',
			textKey: 'rayward_notice_access_public_text'
		},
		{
			labelKey: 'rayward_notice_access_approved_label',
			textKey: 'rayward_notice_access_approved_text'
		}
	] as const;

	let isOpen = $state(true);

	const applicationsParts = $derived($_('rayward_notice_date_applications_text').split('{0}'));

	$effect(() => {
		if (!$shouldShowRaywardNotice && isOpen) {
			isOpen = false;
		}
	});

	async function handleClose() {
		try {
			await markRaywardNoticeSeen();
		} catch (error) {
			logger.error('Failed to persist Rayward notice seen flag:', error);
		}
	}

	async function handleDismiss() {
		await handleClose();
		isOpen = false;
	}

	async function handleReadPost() {
		window.open(RAYWARD_ANNOUNCEMENT_URL, '_blank', 'noopener,noreferrer');
		await handleDismiss();
	}
</script>

<Modal
	closeOnOverlayClick={false}
	onClose={handleClose}
	showCancel={false}
	showConfirm={false}
	status="warning"
	title={$_('rayward_notice_title')}
	bind:isOpen
>
	<div class="onboarding-hero-logo">
		<AppLogo app="rayward" />
	</div>

	<p class="modal-paragraph">{$_('rayward_notice_lead')}</p>

	<div class="modal-section">
		<ul class="rayward-notice-dates">
			<li class="rayward-notice-date-row">
				<strong class="rayward-notice-date-label">{$_('rayward_notice_date_shutdown')}</strong>
				<span class="rayward-notice-date-text">{$_('rayward_notice_date_shutdown_text')}</span>
			</li>
			<li class="rayward-notice-date-row">
				<strong class="rayward-notice-date-label">{$_('rayward_notice_date_applications')}</strong>
				<span class="rayward-notice-date-text"
					>{applicationsParts[0]}<ExtLink class="rayward-notice-link" href={RAYWARD_URL}
						>rayward.app</ExtLink
					>{applicationsParts[1]}</span
				>
			</li>
		</ul>
	</div>

	<div class="modal-section">
		<header class="modal-section-head">
			<h3 class="modal-section-title">{$_('rayward_notice_access_title')}</h3>
		</header>
		<ul class="modal-list">
			{#each accessRows as row (row.labelKey)}
				<li class="modal-list-item">
					<span class="modal-list-bullet-warning" aria-hidden="true"></span>
					<span>
						<strong class="rayward-notice-fact">{$_(row.labelKey)}</strong>
						{$_(row.textKey)}
					</span>
				</li>
			{/each}
		</ul>
		<p class="modal-paragraph">{$_('rayward_notice_access_teams')}</p>
		<p class="modal-paragraph">{$_('rayward_notice_access_personal')}</p>
	</div>

	<div class="modal-section">
		<header class="modal-section-head">
			<h3 class="modal-section-title">{$_('rayward_notice_projects_title')}</h3>
		</header>
		<p class="modal-paragraph">{$_('rayward_notice_projects_body')}</p>
		<ul class="rayward-notice-projects">
			{#each DETECTION_PROJECTS as project (project)}
				<li class="rayward-notice-project">
					<SourceLogo class="rayward-notice-project-logo" source={project} />
				</li>
			{/each}
		</ul>
		<p class="modal-paragraph">{$_('rayward_notice_projects_note')}</p>
	</div>

	<p class="modal-paragraph mt-3">{$_('rayward_notice_closing')}</p>

	{#snippet actions()}
		<button class="modal-button-cancel" onclick={handleDismiss} type="button">
			{$_('rayward_notice_close')}
		</button>
		<button class="modal-button-primary gap-1.5" onclick={handleReadPost} type="button">
			{$_('rayward_notice_read_post')}
			<ExternalLink aria-hidden="true" size={14} />
		</button>
	{/snippet}
</Modal>
