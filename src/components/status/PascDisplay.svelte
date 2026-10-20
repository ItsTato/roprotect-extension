<script lang="ts">
	import { Download, Pencil, Trash2 } from '@lucide/svelte';
	import { _ } from 'svelte-i18n';
	import { getAssetUrl } from '@/lib/utils/assets';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import type { StatusIconName } from '@/lib/utils/icon-mapping';
	import PascLinkedDiscord from './PascLinkedDiscord.svelte';
	import PascReviewModal from './PascReviewModal.svelte';
	import OverlayPortal from '@/components/overlay/OverlayPortal.svelte';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import { renderMarkdown } from '@/lib/utils/markdown';
	import {
		PASC_FLAG_COLORS,
		PASC_FLAG_LABELS,
		pascCanSee,
		type PascAccessLevel,
		type PascCaseFile,
		type PascDiscordAccount,
		type PascFlag,
		type PascProviderVerdict,
		type PascRecord,
		type PascReferral
	} from '@/lib/data/pasc';

	// PASC provider tab. Renders real lookup data via mapPascUserStatus. A null
	// record means the user has no PASC case file: the verdict is referred to the
	// highest relied-upon provider verdict instead (no override).

	interface Props {
		record: PascRecord | null;
		discordAccounts: PascDiscordAccount[];
		viewerLevel: PascAccessLevel;
		canEdit: boolean;
		referral?: PascReferral | null;
		// Blank shell for creating a record when none exists (M1+ only, set by
		// the caller). Renders the full layout with live provider context and a
		// Create action instead of the referral-only view.
		draftRecord?: PascRecord | null;
		onEdit?: () => void;
		onRefresh?: (() => void) | undefined;
		// Moderator review requests (Report / Ask for Recheck). The caller owns
		// the user id and the live-only gate.
		userId: string;
		requestsEnabled?: boolean;
		displayName?: string | undefined;
		username?: string | undefined;
		providerVerdicts?: PascProviderVerdict[] | undefined;
	}

	let {
		record,
		discordAccounts,
		viewerLevel,
		canEdit,
		referral = null,
		draftRecord = null,
		onEdit,
		onRefresh,
		userId,
		requestsEnabled = false,
		displayName = undefined,
		username = undefined,
		providerVerdicts = undefined
	}: Props = $props();

	const pascLogo = getAssetUrl('/assets/pasc-scan.png');

	const FLAG_ICONS: Record<PascFlag, StatusIconName> = {
		unsafe: 'unsafe',
		flagged: 'pending',
		queued: 'queued',
		mixed: 'mixed',
		past_offender: 'past-offender',
		provisional: 'provisional',
		safe: 'safe',
		redacted: 'redacted',
		unknown: 'unknown'
	};

	const visible = $derived(
		record?.accessLevel ? pascCanSee(viewerLevel, record.accessLevel) : false
	);
	const canSeeInternal = $derived(
		record ? pascCanSee(viewerLevel, record.internalReviewMinLevel) : false
	);
	const visibleFiles = $derived(
		record?.files.filter((f) => pascCanSee(viewerLevel, f.accessLevel)) ?? []
	);
	// Discord links are the most sensitive part of the case file: require A2+
	// on top of the record's own visibility gate, regardless of how low the
	// record itself is classified.
	const canSeeDiscord = $derived(pascCanSee(viewerLevel, 'A2'));
	// TASE is represented by the linked-Discord block in the right column, so
	// its verdict is not repeated among the provider rows.
	const providerRows = $derived(
		(record ?? draftRecord)?.providerVerdicts.filter((v) => v.provider !== 'TASE') ?? []
	);

	let selectedFileId = $state<string | null>(null);
	const selectedFile = $derived(visibleFiles.find((f) => f.id === selectedFileId) ?? null);

	let publicNoteHtml = $state('');
	let internalReviewHtml = $state('');
	let filePreviewHtml = $state('');
	let fileObjectUrl = $state<string | null>(null);
	let fileContentType = $state('');
	let fileLoading = $state(false);
	let fileError = $state<string | null>(null);

	let confirmingDeleteId = $state<string | null>(null);
	let deletingFile = $state(false);
	let fileActionError = $state<string | null>(null);

	// Moderator review request state. Report (no record, 0+) and recheck
	// (record exists, A1+) are mutually exclusive by branch. The request goes
	// through PascReviewModal; the proxy posts to Discord server-side and
	// enforces the clearance gates again.
	let reviewModal = $state<'report' | 'recheck' | null>(null);
	let reviewDone = $state<'report' | 'recheck' | null>(null);

	const canRecheck = $derived(pascCanSee(viewerLevel, 'A1'));

	// Non-reactive: object URLs are revoked on selection/record change without
	// subscribing the download effect (reading the state copy there would loop).
	let lastObjectUrl: string | null = null;

	// Non-reactive: guards the async note renders so a slow promise for a
	// previous user cannot overwrite the current user's notes.
	let noteRenderToken = 0;

	const selectedIsImage = $derived(
		fileContentType.startsWith('image/') ||
			(selectedFile?.kind === 'image' && fileObjectUrl !== null)
	);

	$effect(() => {
		// Reset every user-scoped field so state never carries between tooltips.
		void userId;
		reviewModal = null;
		reviewDone = null;
		publicNoteHtml = '';
		internalReviewHtml = '';
		selectedFileId = null;
		fileActionError = null;
		deletingFile = false;
		confirmingDeleteId = null;
		fileError = null;
		fileLoading = false;
		filePreviewHtml = '';
		fileObjectUrl = null;
		fileContentType = '';
		if (lastObjectUrl) {
			URL.revokeObjectURL(lastObjectUrl);
			lastObjectUrl = null;
		}
		if (!record) return;

		// Both reviewer fields render as markdown; each resolves independently.
		const token = ++noteRenderToken;
		void renderMarkdown(record.publicNote).then((html) => {
			if (token === noteRenderToken) publicNoteHtml = html;
		});
		void renderMarkdown(record.internalReview).then((html) => {
			if (token === noteRenderToken) internalReviewHtml = html;
		});
	});

	// Downloads the selected file through the background (auth headers stay
	// out of content scripts). Images render inline, markdown/text renders
	// sanitized, anything else becomes a download link.
	$effect(() => {
		const file = selectedFile;
		if (lastObjectUrl) {
			URL.revokeObjectURL(lastObjectUrl);
			lastObjectUrl = null;
		}
		fileObjectUrl = null;
		filePreviewHtml = '';
		fileContentType = '';
		fileError = null;
		fileLoading = false;
		if (!file?.fileId || !record) return;
		const fileId = file.fileId;
		const userId = record.userId;
		const kind = file.kind;
		let cancelled = false;
		fileLoading = true;
		void apiClient
			.downloadPascFile(userId, fileId)
			.then((result) => {
				if (cancelled) return;
				fileLoading = false;
				fileContentType = result.contentType;
				if (result.contentType.startsWith('image/') || kind === 'image') {
					fileObjectUrl = lastObjectUrl = URL.createObjectURL(
						new Blob([result.bytes], { type: result.contentType })
					);
				} else if (
					kind === 'markdown' ||
					result.contentType.startsWith('text/') ||
					result.contentType.includes('markdown')
				) {
					const text = new TextDecoder().decode(result.bytes);
					void renderMarkdown(text).then((html) => {
						if (!cancelled) filePreviewHtml = html;
					});
				} else {
					fileObjectUrl = lastObjectUrl = URL.createObjectURL(
						new Blob([result.bytes], { type: result.contentType })
					);
				}
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				fileLoading = false;
				fileError = error instanceof Error ? error.message : String(error);
			});
		return () => {
			cancelled = true;
		};
	});

	// Revoke the final blob URL when the tooltip unmounts.
	$effect(() => {
		return () => {
			if (lastObjectUrl) {
				URL.revokeObjectURL(lastObjectUrl);
				lastObjectUrl = null;
			}
		};
	});

	// M1+ file delete with two-click confirm. The tab refreshes from the
	// lookup afterwards so the row disappears without a stale re-render.
	async function deleteFile(file: PascCaseFile) {
		if (!record || !file.fileId || deletingFile) return;
		if (confirmingDeleteId !== file.id) {
			confirmingDeleteId = file.id;
			return;
		}
		confirmingDeleteId = null;
		deletingFile = true;
		fileActionError = null;
		try {
			await apiClient.deletePascFile(record.userId, file.fileId);
			if (selectedFileId === file.id) selectedFileId = null;
			onRefresh?.();
		} catch (error) {
			fileActionError = error instanceof Error ? error.message : String(error);
		} finally {
			deletingFile = false;
		}
	}

	// RoWifi accounts already arrive in the shape the linked-Discord block
	// renders; no TASE record reshaping is needed here.

	function reviewVerdicts(
		verdicts: PascProviderVerdict[]
	): { provider: string; flag: string; detail: string }[] {
		return verdicts.map((verdict) => ({
			provider: verdict.provider,
			flag: $_(PASC_FLAG_LABELS[verdict.flag]),
			detail: $_(verdict.detail)
		}));
	}

	// Context for the review modal: everything the tab knows, so the Discord
	// message carries as much information as possible.
	function buildReviewContext(kind: 'report' | 'recheck'): {
		targetLabel: string;
		context: {
			displayName: string;
			username: string;
			flag: string;
			referralProvider: string;
			referralFlag: string;
			verdicts: { provider: string; flag: string; detail: string }[];
		};
	} {
		if (kind === 'recheck' && record) {
			return {
				targetLabel: $_('pasc_review_target_flag', {
					values: {
						0: record.displayName,
						1: $_(PASC_FLAG_LABELS[record.flag])
					}
				}),
				context: {
					displayName: record.displayName,
					username: record.username,
					flag: $_(PASC_FLAG_LABELS[record.flag]),
					referralProvider: '',
					referralFlag: '',
					verdicts: reviewVerdicts(record.providerVerdicts)
				}
			};
		}
		const source = draftRecord;
		const referralText = referral
			? $_('pasc_review_referred', {
					values: { 0: referral.provider, 1: $_(PASC_FLAG_LABELS[referral.flag]) }
				})
			: $_('pasc_review_no_record');
		return {
			targetLabel: $_('pasc_review_target_referral', {
				values: {
					0: source?.displayName ?? displayName ?? userId,
					1: referralText
				}
			}),
			context: {
				displayName: source?.displayName ?? displayName ?? '',
				username: source?.username ?? username ?? '',
				flag: '',
				referralProvider: referral?.provider ?? '',
				referralFlag: referral ? $_(PASC_FLAG_LABELS[referral.flag]) : '',
				verdicts: reviewVerdicts(source?.providerVerdicts ?? providerVerdicts ?? [])
			}
		};
	}

	function handleReviewSent(kind: 'report' | 'recheck') {
		reviewDone = kind;
		reviewModal = null;
	}
</script>

<div class="pasc-container">
	{#if record}
		<div class="pasc-header">
			<img class="pasc-header-logo" alt="PASC" src={pascLogo} />
			{#if record.accessLevel}
				<span class="pasc-access-chip">{record.accessLevel}</span>
			{:else}
				<span class="pasc-access-chip">{$_('pasc_restricted')}</span>
			{/if}
			{#if canEdit}
				<button
					style:margin-inline-start="auto"
					class="pasc-edit-button"
					onclick={() => onEdit?.()}
					type="button"
				>
					<Pencil size={12} />
					{$_('pasc_edit_record')}
				</button>
			{/if}
			{#if requestsEnabled && canRecheck}
				<button
					class="pasc-edit-button"
					disabled={reviewDone === 'recheck'}
					onclick={() => (reviewModal = 'recheck')}
					title={$_('pasc_recheck_hint')}
					type="button"
				>
					{reviewDone === 'recheck' ? $_('pasc_recheck_sent') : $_('pasc_recheck_action')}
				</button>
			{/if}
		</div>

		<!-- The PASC flag is public to every clearance (0+) and overrides the other
		     providers — always rendered, never gated on `visible`. -->
		<div class="pasc-provider-row">
			<StatusIcon name={FLAG_ICONS[record.flag]} color={PASC_FLAG_COLORS[record.flag]} size={14} />
			<span class="pasc-provider-name">{$_('pasc_verdict')}</span>
			<span class="pasc-provider-detail">{$_(PASC_FLAG_LABELS[record.flag])}</span>
		</div>

		{#if visible}
			<div
				class="pasc-columns"
				class:pasc-columns-single={discordAccounts.length === 0 || !canSeeDiscord}
			>
				<div>
					<h4 class="pasc-column-title">{$_('pasc_provider_verdicts')}</h4>
					<div class="pasc-container mt-2">
						{#each providerRows as verdict (verdict.provider)}
							<div class="pasc-provider-row">
								<StatusIcon
									name={FLAG_ICONS[verdict.flag]}
									color={PASC_FLAG_COLORS[verdict.flag]}
									size={14}
								/>
								<span class="pasc-provider-name">{verdict.provider}</span>
								<span class="pasc-provider-detail">{$_(verdict.detail)}</span>
							</div>
						{/each}
					</div>
					<div style:margin-top="1rem" class="pasc-note">
						<span class="pasc-note-label"
							>{#if record.accessLevel}
								{$_('pasc_finding_public', { values: { 0: record.accessLevel } })}
							{:else}
								{$_('pasc_finding')}
							{/if}</span
						>
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
						<div class="pasc-markdown">{@html publicNoteHtml}</div>
					</div>
					{#if canSeeInternal}
						<div style:margin-top="0.75rem" class="pasc-note">
							<span class="pasc-note-label"
								>{$_('pasc_internal_review_level', {
									values: { 0: record.internalReviewMinLevel }
								})}</span
							>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
							<div class="pasc-markdown">{@html internalReviewHtml}</div>
						</div>
					{/if}
					{#if visibleFiles.length > 0}
						<div style:margin-top="0.75rem" class="pasc-note">
							<span class="pasc-note-label"
								>{$_('pasc_case_files_count', { values: { 0: visibleFiles.length } })}</span
							>
							{#each visibleFiles as file (file.id)}
								<div class="pasc-file-row-wrap">
									<button
										class="pasc-file-row pasc-file-select"
										aria-pressed={selectedFileId === file.id}
										onclick={() => {
											confirmingDeleteId = null;
											selectedFileId = selectedFileId === file.id ? null : file.id;
										}}
										type="button"
									>
										<span class="pasc-file-name">{file.name}</span>
										<span class="pasc-file-meta"
											>{file.accessLevel}{file.sizeLabel ? ` · ${file.sizeLabel}` : ''}</span
										>
									</button>
									{#if canEdit && file.fileId}
										<button
											class="pasc-file-delete"
											aria-label={confirmingDeleteId === file.id
												? $_('pasc_file_confirm_delete_aria', { values: { 0: file.name } })
												: $_('pasc_file_delete_aria', { values: { 0: file.name } })}
											disabled={deletingFile}
											onclick={() => void deleteFile(file)}
											title={confirmingDeleteId === file.id
												? $_('pasc_file_confirm_delete_title')
												: $_('pasc_file_delete_title')}
											type="button"
										>
											<Trash2 size={12} />
											{confirmingDeleteId === file.id
												? $_('pasc_file_sure')
												: $_('pasc_file_delete')}
										</button>
									{/if}
								</div>
							{/each}
							{#if fileActionError}
								<p class="pasc-meta">{fileActionError}</p>
							{/if}
							{#if selectedFile}
								<div class="pasc-file-viewer">
									<span class="pasc-note-label">{selectedFile.name}</span>
									{#if fileLoading}
										<p class="pasc-meta">{$_('pasc_file_loading')}</p>
									{:else if fileError}
										<p class="pasc-meta">{fileError}</p>
									{:else if filePreviewHtml}
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
										<div class="pasc-markdown">{@html filePreviewHtml}</div>
									{:else if selectedIsImage && fileObjectUrl}
										<img class="pasc-file-image" alt={selectedFile.name} src={fileObjectUrl} />
										<a class="pasc-file-download" download={selectedFile.name} href={fileObjectUrl}>
											<Download size={12} />
											{$_('pasc_file_download')}
										</a>
									{:else if fileObjectUrl}
										<a class="pasc-file-download" download={selectedFile.name} href={fileObjectUrl}>
											<Download size={12} />
											{$_('pasc_file_download_named', { values: { 0: selectedFile.name } })}
										</a>
									{:else}
										<p class="pasc-meta">{$_('pasc_file_unavailable')}</p>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				</div>
				{#if discordAccounts.length > 0 && canSeeDiscord}
					<PascLinkedDiscord
						accessLevel={record.accessLevel}
						accounts={discordAccounts}
						{viewerLevel}
					/>
				{/if}
			</div>
			{#if record.reviewer || record.updatedAt}
				<p class="pasc-footer">
					{#if record.reviewer}
						{$_('pasc_reviewed_by', {
							values: {
								0: record.reviewer,
								1: record.updatedAt
							}
						})}
					{:else}
						{$_('pasc_updated', { values: { 0: record.updatedAt } })}
					{/if}
				</p>
			{/if}
		{:else}
			<p class="pasc-footer">
				{#if record.accessLevel}
					{$_('pasc_details_require', { values: { 0: record.accessLevel } })}
				{:else}
					{$_('pasc_details_restricted')}
				{/if}
			</p>
		{/if}
	{:else if draftRecord}
		<!-- No record yet, but the viewer may create one: the full layout with
		     live provider context, plus the referral verdict above it. -->
		<div class="pasc-header">
			<img class="pasc-header-logo" alt="PASC" src={pascLogo} />
			<span class="pasc-access-chip">{$_('pasc_no_record')}</span>
			{#if canEdit}
				<button
					style:margin-inline-start="auto"
					class="pasc-edit-button"
					onclick={() => onEdit?.()}
					type="button"
				>
					<Pencil size={12} />
					{$_('pasc_create_record')}
				</button>
			{/if}
			{#if requestsEnabled}
				<button
					class="pasc-edit-button"
					disabled={reviewDone === 'report'}
					onclick={() => (reviewModal = 'report')}
					title={$_('pasc_report_hint')}
					type="button"
				>
					{reviewDone === 'report' ? $_('pasc_report_sent') : $_('pasc_report_action')}
				</button>
			{/if}
		</div>
		{#if referral}
			<div class="pasc-provider-row">
				<StatusIcon
					name={FLAG_ICONS[referral.flag]}
					color={PASC_FLAG_COLORS[referral.flag]}
					size={14}
				/>
				<span class="pasc-provider-name"
					>{$_('pasc_referred_to', { values: { 0: referral.provider } })}</span
				>
				<span class="pasc-provider-detail">{$_(PASC_FLAG_LABELS[referral.flag])}</span>
			</div>
		{/if}
		<div
			class="pasc-columns"
			class:pasc-columns-single={discordAccounts.length === 0 || !canSeeDiscord}
		>
			<div>
				<h4 class="pasc-column-title">{$_('pasc_provider_verdicts')}</h4>
				<div class="pasc-container mt-2">
					{#each providerRows as verdict (verdict.provider)}
						<div class="pasc-provider-row">
							<StatusIcon
								name={FLAG_ICONS[verdict.flag]}
								color={PASC_FLAG_COLORS[verdict.flag]}
								size={14}
							/>
							<span class="pasc-provider-name">{verdict.provider}</span>
							<span class="pasc-provider-detail">{$_(verdict.detail)}</span>
						</div>
					{/each}
				</div>
			</div>
			{#if discordAccounts.length > 0 && canSeeDiscord}
				<PascLinkedDiscord accessLevel={null} accounts={discordAccounts} {viewerLevel} />
			{/if}
		</div>
		<p class="pasc-footer">{$_('pasc_no_record_create')}</p>
	{:else}
		<!-- No PASC case file: the verdict is referred to the highest relied-upon
		     provider verdict. No override, no edit (nothing to edit). -->
		<div class="pasc-header">
			<img class="pasc-header-logo" alt="PASC" src={pascLogo} />
			<span class="pasc-access-chip">{$_('pasc_no_record')}</span>
			{#if requestsEnabled}
				<button
					style:margin-inline-start="auto"
					class="pasc-edit-button"
					disabled={reviewDone === 'report'}
					onclick={() => (reviewModal = 'report')}
					title={$_('pasc_report_hint')}
					type="button"
				>
					{reviewDone === 'report' ? $_('pasc_report_sent') : $_('pasc_report_action')}
				</button>
			{/if}
		</div>
		{#if referral}
			<div class="pasc-provider-row">
				<StatusIcon
					name={FLAG_ICONS[referral.flag]}
					color={PASC_FLAG_COLORS[referral.flag]}
					size={14}
				/>
				<span class="pasc-provider-name"
					>{$_('pasc_referred_to', { values: { 0: referral.provider } })}</span
				>
				<span class="pasc-provider-detail">{$_(PASC_FLAG_LABELS[referral.flag])}</span>
			</div>
			<p class="pasc-footer">{$_('pasc_no_record_referral')}</p>
		{:else}
			<p class="pasc-footer">{$_('pasc_no_record_only')}</p>
		{/if}
	{/if}
	{#if reviewModal}
		{@const review = buildReviewContext(reviewModal)}
		<!-- Portal out of .pasc-container: container-type makes it the containing
		     block for fixed descendants, which would trap the overlay in the panel. -->
		<OverlayPortal>
			<div
				class="modal-overlay visible"
				onclick={(event) => event.stopPropagation()}
				role="presentation"
			>
				<PascReviewModal
					context={review.context}
					kind={reviewModal}
					onClose={() => (reviewModal = null)}
					onSent={handleReviewSent}
					targetLabel={review.targetLabel}
					{userId}
				/>
			</div>
		</OverlayPortal>
	{/if}
</div>
