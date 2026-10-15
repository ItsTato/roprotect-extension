<script lang="ts">
	import { Pencil } from '@lucide/svelte';
	import { getAssetUrl } from '@/lib/utils/assets';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import type { StatusIconName } from '@/lib/utils/icon-mapping';
	import TaseV2Display from './TaseV2Display.svelte';
	import type { DiscordAvatar, TaseUserRecord } from '@/lib/schemas/custom-api';
	import { renderMarkdown } from '@/lib/utils/markdown';
	import {
		PASC_FLAG_COLORS,
		PASC_FLAG_LABELS,
		PASC_FLAG_TO_NUMERIC,
		pascCanSee,
		type PascAccessLevel,
		type PascDiscordAccount,
		type PascFlag,
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
	}

	let {
		record,
		discordAccounts,
		viewerLevel,
		canEdit,
		referral = null,
		draftRecord = null,
		onEdit
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

	$effect(() => {
		if (!record) return;
		void renderMarkdown(record.internalReview).then((html) => {
			internalReviewHtml = html;
		});
		const preview = selectedFile?.mockPreview;
		if (preview) {
			void renderMarkdown(preview).then((html) => {
				filePreviewHtml = html;
			});
		} else {
			filePreviewHtml = '';
		}
	});

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
</script>

<div class="pasc-container">
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
		</div>

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
								<button
									class="pasc-file-row"
									aria-pressed={selectedFileId === file.id}
									onclick={() => (selectedFileId = selectedFileId === file.id ? null : file.id)}
									type="button"
								>
									<span class="pasc-file-name">{file.name}</span>
									<span class="pasc-file-meta"
										>{file.accessLevel}{file.sizeLabel ? ` · ${file.sizeLabel}` : ''}</span
									>
								</button>
							{/each}
							{#if selectedFile}
								<div class="pasc-file-viewer">
									<span class="pasc-note-label">{selectedFile.name}</span>
									{#if selectedFile.mockPreview}
										<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
										<div class="pasc-markdown">{@html filePreviewHtml}</div>
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
		</div>
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
		</div>
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
