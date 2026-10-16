<script lang="ts">
	import { Download, Pencil, Trash2 } from '@lucide/svelte';
	import { getAssetUrl } from '@/lib/utils/assets';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import type { StatusIconName } from '@/lib/utils/icon-mapping';
	import TaseV2Display from './TaseV2Display.svelte';
	import type { DiscordAvatar, TaseUserRecord } from '@/lib/schemas/custom-api';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import { renderMarkdown } from '@/lib/utils/markdown';
	import {
		PASC_FLAG_COLORS,
		PASC_FLAG_LABELS,
		PASC_FLAG_TO_NUMERIC,
		pascCanSee,
		type PascAccessLevel,
		type PascCaseFile,
		type PascDiscordAccount,
		type PascFlag,
		type PascProviderVerdict,
		type PascRecord,
		type PascReferral
	} from '@/lib/data/pasc-mock';

	// PASC provider tab. Renders real lookup data via mapPascUserStatus, and the
	// mock harness feeds it mock records — same component, both worlds. A null record
	// means the user has no PASC case file: the verdict is referred to the
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
		// the user id and the live-only gate: mock previews never send.
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
		redacted: 'redacted'
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
	// TASE renders in the right column as the full account display, not with the
	// other providers. Falls back to the creation draft so the full layout
	// renders for M1+ viewers even before a record exists.
	const providerRows = $derived(
		(record ?? draftRecord)?.providerVerdicts.filter((v) => v.provider !== 'TASE') ?? []
	);

	let selectedFileId = $state<string | null>(null);
	const selectedFile = $derived(visibleFiles.find((f) => f.id === selectedFileId) ?? null);

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
	// (record exists, A1+) are mutually exclusive by branch. The proxy posts
	// to Discord server-side and enforces the clearance gates again.
	let requestingReview = $state(false);
	let reviewDone = $state<'report' | 'recheck' | null>(null);
	let reviewError = $state<string | null>(null);
	let reviewForm = $state<'report' | 'recheck' | null>(null);
	let reviewComment = $state('');

	const canRecheck = $derived(pascCanSee(viewerLevel, 'A1'));

	// Non-reactive: object URLs are revoked on selection/record change without
	// subscribing the download effect (reading the state copy there would loop).
	let lastObjectUrl: string | null = null;

	const selectedIsImage = $derived(
		fileContentType.startsWith('image/') ||
			(selectedFile?.kind === 'image' && fileObjectUrl !== null)
	);

	$effect(() => {
		// Reset per-user so a sent state never carries to the next tooltip.
		void userId;
		requestingReview = false;
		reviewDone = null;
		reviewError = null;
		reviewForm = null;
		reviewComment = '';
		if (!record) return;
		confirmingDeleteId = null;
		void renderMarkdown(record.internalReview).then((html) => {
			internalReviewHtml = html;
		});
	});

	// Downloads the selected file through the background (auth headers stay
	// out of content scripts). Images render inline, markdown/text renders
	// sanitized, anything else becomes a download link. Mock previews render
	// without any fetch; files without an upstream id cannot be fetched.
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
		const preview = file?.mockPreview;
		if (preview) {
			void renderMarkdown(preview).then((html) => {
				filePreviewHtml = html;
			});
			return;
		}
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

	// RoWifi accounts shaped as a TASE record so the right column renders
	// exactly like the base TASE tab. Every detected server rides along at
	// its own severity — past-offender sightings included. Falls back to a
	// safe empty shape when there is no record (never rendered then, but the
	// derived runs regardless).
	const taseRecord = $derived.by(
		(): TaseUserRecord => ({
			id: record ? Number.parseInt(record.userId, 10) || 0 : 0,
			flagType: PASC_FLAG_TO_NUMERIC[record?.flag ?? referral?.flag ?? 'safe'],
			detections: Object.fromEntries(
				discordAccounts.map((account) => [
					account.id,
					{
						detectedGuilds: account.servers.map((server) => ({
							guildId: server.id,
							guildName: server.name,
							flag_type: server.flagType
						}))
					}
				])
			)
		})
	);

	const taseAvatars = $derived.by(
		(): Record<string, DiscordAvatar> =>
			Object.fromEntries(
				discordAccounts.map((account) => [
					account.id,
					{
						username: account.username,
						globalName: account.globalName,
						displayName: account.globalName,
						avatarDataUrl: account.avatarDataUrl
					}
				])
			)
	);

	function reviewVerdicts(
		verdicts: PascProviderVerdict[]
	): { provider: string; flag: string; detail: string }[] {
		return verdicts.map((verdict) => ({
			provider: verdict.provider,
			flag: PASC_FLAG_LABELS[verdict.flag],
			detail: verdict.detail
		}));
	}

	async function sendReviewRequest(kind: 'report' | 'recheck') {
		if (requestingReview || reviewDone) return;
		requestingReview = true;
		reviewError = null;
		try {
			const comment = reviewComment.trim();
			if (kind === 'recheck' && record) {
				await apiClient.requestPascReview(userId, kind, {
					displayName: record.displayName,
					username: record.username,
					flag: PASC_FLAG_LABELS[record.flag],
					verdicts: reviewVerdicts(record.providerVerdicts),
					comment
				});
			} else {
				const source = draftRecord;
				await apiClient.requestPascReview(userId, kind, {
					displayName: source?.displayName ?? displayName ?? '',
					username: source?.username ?? username ?? '',
					referralProvider: referral?.provider ?? '',
					referralFlag: referral ? PASC_FLAG_LABELS[referral.flag] : '',
					verdicts: reviewVerdicts(source?.providerVerdicts ?? providerVerdicts ?? []),
					comment
				});
			}
			reviewDone = kind;
			reviewForm = null;
			reviewComment = '';
		} catch (error) {
			reviewError = error instanceof Error ? error.message : String(error);
		} finally {
			requestingReview = false;
		}
	}

	function toggleReviewForm(kind: 'report' | 'recheck') {
		if (reviewDone) return;
		reviewError = null;
		if (reviewForm === kind) {
			reviewForm = null;
			return;
		}
		reviewForm = kind;
		reviewComment = '';
	}
</script>

<div class="pasc-container">
	{#snippet reviewFormSnippet(kind: 'report' | 'recheck')}
		{#if reviewForm === kind && reviewDone === null}
			<div class="pasc-review-form">
				<input
					class="pasc-review-input"
					aria-label={kind === 'report' ? 'Report note' : 'Recheck note'}
					maxlength={280}
					placeholder={kind === 'report'
						? 'Why are you reporting this user? (optional)'
						: 'What should moderators re-examine? (optional)'}
					type="text"
					bind:value={reviewComment}
				/>
				<div class="pasc-field-row">
					<button
						class="pasc-edit-button"
						disabled={requestingReview}
						onclick={() => void sendReviewRequest(kind)}
						type="button"
					>
						{requestingReview ? 'Sending…' : 'Send'}
					</button>
					<button class="pasc-edit-button" onclick={() => (reviewForm = null)} type="button">
						Cancel
					</button>
				</div>
			</div>
		{/if}
	{/snippet}
	{#if record}
		<div class="pasc-header">
			<img class="pasc-header-logo" alt="PASC" src={pascLogo} />
			{#if record.accessLevel}
				<span class="pasc-access-chip">Access {record.accessLevel}</span>
			{:else}
				<span class="pasc-access-chip">Restricted</span>
			{/if}
			{#if canEdit}
				<button
					style:margin-inline-start="auto"
					class="pasc-edit-button"
					onclick={() => onEdit?.()}
					type="button"
				>
					<Pencil size={12} />
					Edit record
				</button>
			{/if}
			{#if requestsEnabled && canRecheck}
				<button
					class="pasc-edit-button"
					disabled={requestingReview}
					onclick={() => toggleReviewForm('recheck')}
					title="Ask a PASC moderator to re-examine this case file"
					type="button"
				>
					{reviewDone === 'recheck' ? 'Recheck requested' : 'Ask for Recheck'}
				</button>
			{/if}
		</div>
		{#if reviewError}
			<p class="pasc-meta">{reviewError}</p>
		{/if}
		{@render reviewFormSnippet('recheck')}

		<!-- The PASC flag is public to every clearance (0+) and overrides the other
		     providers — always rendered, never gated on `visible` (see T:\Python Projects\TLET\PASC\PASC.md). -->
		<div class="pasc-provider-row">
			<StatusIcon name={FLAG_ICONS[record.flag]} color={PASC_FLAG_COLORS[record.flag]} size={14} />
			<span class="pasc-provider-name">PASC verdict</span>
			<span class="pasc-provider-detail">{PASC_FLAG_LABELS[record.flag]}</span>
		</div>

		{#if visible}
			<div class="pasc-columns">
				<div>
					<h4 class="pasc-column-title">Provider verdicts</h4>
					<div class="pasc-container">
						{#each providerRows as verdict (verdict.provider)}
							<div class="pasc-provider-row">
								<StatusIcon
									name={FLAG_ICONS[verdict.flag]}
									color={PASC_FLAG_COLORS[verdict.flag]}
									size={14}
								/>
								<span class="pasc-provider-name">{verdict.provider}</span>
								<span class="pasc-provider-detail">{verdict.detail}</span>
							</div>
						{/each}
					</div>
					<div style:margin-top="1rem" class="pasc-note">
						<span class="pasc-note-label"
							>PASC finding{#if record.accessLevel}
								(public, {record.accessLevel}+){/if}</span
						>
						{record.publicNote}
					</div>
					{#if canSeeInternal}
						<div style:margin-top="0.75rem" class="pasc-note">
							<span class="pasc-note-label">Internal review ({record.internalReviewMinLevel}+)</span
							>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
							<div class="pasc-markdown">{@html internalReviewHtml}</div>
						</div>
					{/if}
					{#if visibleFiles.length > 0}
						<div style:margin-top="0.75rem" class="pasc-note">
							<span class="pasc-note-label">Case files ({visibleFiles.length})</span>
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
												? `Confirm delete ${file.name}`
												: `Delete ${file.name}`}
											disabled={deletingFile}
											onclick={() => void deleteFile(file)}
											title={confirmingDeleteId === file.id
												? 'Click again to confirm'
												: 'Delete file'}
											type="button"
										>
											<Trash2 size={12} />
											{confirmingDeleteId === file.id ? 'Sure?' : 'Delete'}
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
									{#if selectedFile.mockPreview}
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
										<div class="pasc-markdown">{@html filePreviewHtml}</div>
									{:else if fileLoading}
										<p class="pasc-meta">Loading file…</p>
									{:else if fileError}
										<p class="pasc-meta">{fileError}</p>
									{:else if filePreviewHtml}
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
										<div class="pasc-markdown">{@html filePreviewHtml}</div>
									{:else if selectedIsImage && fileObjectUrl}
										<img class="pasc-file-image" alt={selectedFile.name} src={fileObjectUrl} />
										<a class="pasc-file-download" download={selectedFile.name} href={fileObjectUrl}>
											<Download size={12} />
											Download
										</a>
									{:else if fileObjectUrl}
										<a class="pasc-file-download" download={selectedFile.name} href={fileObjectUrl}>
											<Download size={12} />
											Download {selectedFile.name}
										</a>
									{:else}
										<p class="pasc-meta">File download is not available in this build.</p>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
					<p class="pasc-meta">
						Reviewed by {record.reviewer} · {record.updatedAt}
					</p>
				</div>
				{#if discordAccounts.length > 0}
					<div>
						<h4 class="pasc-column-title">Linked Discord (RoWifi)</h4>
						<TaseV2Display avatars={taseAvatars} {taseRecord} />
					</div>
				{/if}
			</div>
		{:else}
			<p class="pasc-meta">
				{#if record.accessLevel}
					Case details require {record.accessLevel} clearance — flag shown for all levels.
				{:else}
					Case details are restricted — flag shown for all levels.
				{/if}
			</p>
		{/if}
	{:else if draftRecord}
		<!-- No record yet, but the viewer may create one: the full layout with
		     live provider context, plus the referral verdict above it. -->
		<div class="pasc-header">
			<img class="pasc-header-logo" alt="PASC" src={pascLogo} />
			<span class="pasc-access-chip">No record</span>
			{#if canEdit}
				<button
					style:margin-inline-start="auto"
					class="pasc-edit-button"
					onclick={() => onEdit?.()}
					type="button"
				>
					<Pencil size={12} />
					Create record
				</button>
			{/if}
			{#if requestsEnabled}
				<button
					class="pasc-edit-button"
					disabled={requestingReview}
					onclick={() => toggleReviewForm('report')}
					title="Report this user to PASC moderators for review"
					type="button"
				>
					{reviewDone === 'report' ? 'Report sent' : 'Report'}
				</button>
			{/if}
		</div>
		{#if reviewError}
			<p class="pasc-meta">{reviewError}</p>
		{/if}
		{@render reviewFormSnippet('report')}
		{#if referral}
			<div class="pasc-provider-row">
				<StatusIcon
					name={FLAG_ICONS[referral.flag]}
					color={PASC_FLAG_COLORS[referral.flag]}
					size={14}
				/>
				<span class="pasc-provider-name">Referred to {referral.provider}</span>
				<span class="pasc-provider-detail">{PASC_FLAG_LABELS[referral.flag]}</span>
			</div>
		{/if}
		<div class="pasc-columns">
			<div>
				<h4 class="pasc-column-title">Provider verdicts</h4>
				<div class="pasc-container">
					{#each providerRows as verdict (verdict.provider)}
						<div class="pasc-provider-row">
							<StatusIcon
								name={FLAG_ICONS[verdict.flag]}
								color={PASC_FLAG_COLORS[verdict.flag]}
								size={14}
							/>
							<span class="pasc-provider-name">{verdict.provider}</span>
							<span class="pasc-provider-detail">{verdict.detail}</span>
						</div>
					{/each}
				</div>
				<p class="pasc-meta">
					No PASC case file for this user — create one to start a human review.
				</p>
			</div>
			{#if discordAccounts.length > 0}
				<div>
					<h4 class="pasc-column-title">Linked Discord (RoWifi)</h4>
					<TaseV2Display avatars={taseAvatars} {taseRecord} />
				</div>
			{/if}
		</div>
	{:else}
		<!-- No PASC case file: the verdict is referred to the highest relied-upon
		     provider verdict. No override, no edit (nothing to edit). -->
		<div class="pasc-header">
			<img class="pasc-header-logo" alt="PASC" src={pascLogo} />
			<span class="pasc-access-chip">No record</span>
			{#if requestsEnabled}
				<button
					style:margin-inline-start="auto"
					class="pasc-edit-button"
					disabled={requestingReview}
					onclick={() => toggleReviewForm('report')}
					title="Report this user to PASC moderators for review"
					type="button"
				>
					{reviewDone === 'report' ? 'Report sent' : 'Report'}
				</button>
			{/if}
		</div>
		{#if reviewError}
			<p class="pasc-meta">{reviewError}</p>
		{/if}
		{@render reviewFormSnippet('report')}
		{#if referral}
			<div class="pasc-provider-row">
				<StatusIcon
					name={FLAG_ICONS[referral.flag]}
					color={PASC_FLAG_COLORS[referral.flag]}
					size={14}
				/>
				<span class="pasc-provider-name">Referred to {referral.provider}</span>
				<span class="pasc-provider-detail">{PASC_FLAG_LABELS[referral.flag]}</span>
			</div>
			<p class="pasc-meta">
				No PASC case file for this user — verdict deferred to the highest relied-upon provider.
			</p>
		{:else}
			<p class="pasc-meta">No PASC case file for this user.</p>
		{/if}
	{/if}
</div>
