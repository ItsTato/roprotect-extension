<script lang="ts">
	import { untrack } from 'svelte';
	import { Trash2, Upload, X } from '@lucide/svelte';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import type { StatusIconName } from '@/lib/utils/icon-mapping';
	import PascMarkdownEditor from './PascMarkdownEditor.svelte';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import type { UserStatus } from '@/lib/types/api';
	import { pascFileKind } from '@/lib/utils/status/pasc-record';
	import {
		PASC_ACCESS_RANK,
		PASC_FLAG_LABELS,
		PASC_FLAG_TO_NUMERIC,
		type PascAccessLevel,
		type PascCaseFile,
		type PascFlag,
		type PascRecord
	} from '@/lib/data/pasc-mock';

	// PASC record editing window. Renders inside the shared modal shell. Save
	// upserts through the RoProtect proxy; file attach uploads through it too.
	// The mock harness feeds it mock records with stub callbacks.

	interface Props {
		record: PascRecord;
		mode?: 'edit' | 'create';
		onClose: () => void;
		onSaved?: ((status: UserStatus) => void) | undefined;
		onRefresh?: (() => void) | undefined;
	}

	let { record, mode = 'edit', onClose, onSaved, onRefresh }: Props = $props();

	const FLAGS: PascFlag[] = [
		'safe',
		'provisional',
		'past_offender',
		'mixed',
		'unsafe',
		'flagged',
		'queued',
		'redacted'
	];
	const FLAG_ICONS: Record<PascFlag, StatusIconName> = {
		safe: 'safe',
		provisional: 'provisional',
		past_offender: 'past-offender',
		mixed: 'mixed',
		unsafe: 'unsafe',
		flagged: 'pending',
		queued: 'queued',
		redacted: 'redacted'
	};
	const FLAG_COLORS: Record<PascFlag, string> = {
		safe: 'var(--color-success)',
		provisional: 'var(--color-status-safe)',
		past_offender: 'var(--color-status-past-offender)',
		mixed: 'var(--color-status-mixed)',
		unsafe: 'var(--color-status-unsafe)',
		flagged: 'var(--color-status-pending)',
		queued: 'var(--color-status-queued)',
		redacted: 'var(--color-status-error)'
	};
	const LEVELS = Object.keys(PASC_ACCESS_RANK) as PascAccessLevel[];

	let flag = $state<PascFlag>(untrack(() => record.flag));
	let publicNote = $state(untrack(() => record.publicNote));
	let publicNoteLevel = $state<PascAccessLevel>(untrack(() => record.accessLevel ?? 'A2'));
	let internalReview = $state(untrack(() => record.internalReview));
	let internalMinLevel = $state<PascAccessLevel>(untrack(() => record.internalReviewMinLevel));

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let confirmingDeleteId = $state<string | null>(null);
	let deletingFile = $state(false);
	let deleteError = $state<string | null>(null);
	let newFileLevel = $state<PascAccessLevel>(
		untrack(() => record.accessLevel ?? record.internalReviewMinLevel)
	);
	let extraFiles = $state<PascCaseFile[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);

	function formatSize(bytes: number | null): string {
		if (bytes === null) return '';
		if (bytes < 1024) return `${String(bytes)} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function save() {
		if (saving) return;
		saving = true;
		saveError = null;
		try {
			// Only flag is validated proxy-side; the rest passes through to the
			// PASC record schema verbatim. internalReviewMinLevel has no server
			// field (the floor is always M1), so it is not sent.
			const status = await apiClient.upsertPascRecord(record.userId, {
				flag: PASC_FLAG_TO_NUMERIC[flag],
				accessLevel: publicNoteLevel,
				publicNote,
				publicNoteLevel,
				internalReview
			});
			onSaved?.(status);
		} catch (error) {
			saveError = error instanceof Error ? error.message : String(error);
		} finally {
			saving = false;
		}
	}

	async function handleFilesSelected(event: Event) {
		const input = event.currentTarget;
		if (!(input instanceof HTMLInputElement) || !input.files) return;
		const file = input.files[0];
		input.value = '';
		if (!file || uploading) return;
		uploading = true;
		uploadError = null;
		try {
			const bytes = await file.arrayBuffer();
			const descriptor = await apiClient.uploadPascFile(
				record.userId,
				file.name,
				bytes,
				file.type || undefined,
				newFileLevel
			);
			extraFiles = [
				...extraFiles,
				{
					id: `upload:${descriptor.fileId}`,
					name: descriptor.name ?? file.name,
					kind: pascFileKind(descriptor.name ?? file.name),
					accessLevel: newFileLevel,
					sizeLabel: formatSize(descriptor.size),
					fileId: descriptor.fileId,
					mockPreview: undefined
				}
			];
			onRefresh?.();
		} catch (error) {
			uploadError = error instanceof Error ? error.message : String(error);
		} finally {
			uploading = false;
		}
	}

	// The modal only opens for M1+ viewers, so every delete button here is
	// inherently clearance-gated. Stored files refresh from the lookup;
	// just-uploaded extras splice out locally.
	async function deleteModalFile(file: PascCaseFile, isExtra: boolean) {
		if (!file.fileId || deletingFile) return;
		if (confirmingDeleteId !== file.id) {
			confirmingDeleteId = file.id;
			return;
		}
		confirmingDeleteId = null;
		deletingFile = true;
		deleteError = null;
		try {
			await apiClient.deletePascFile(record.userId, file.fileId);
			if (isExtra) extraFiles = extraFiles.filter((entry) => entry.id !== file.id);
			onRefresh?.();
		} catch (error) {
			deleteError = error instanceof Error ? error.message : String(error);
		} finally {
			deletingFile = false;
		}
	}
</script>

<div
	class="modal-popup modal-popup-wide"
	onkeydown={(event) => {
		// Keep host-page and tooltip shortcuts (Space/Enter activation, dismiss
		// keys) from swallowing keystrokes typed into the modal's editors.
		event.stopPropagation();
	}}
	role="presentation"
>
	<div class="modal-header">
		<h3 class="modal-title">
			{mode === 'create' ? 'Create' : 'Edit'} PASC record · {record.userId}
		</h3>
		<button class="modal-close" aria-label="Close" onclick={onClose} type="button">
			<X size={16} />
		</button>
	</div>
	<div style:padding="0 1.125rem" class="pasc-container pasc-modal-body">
		<div class="pasc-field">
			<span class="pasc-field-label">Flag</span>
			<div class="pasc-flag-options" aria-label="Flag" role="radiogroup">
				{#each FLAGS as option (option)}
					<button
						class="pasc-flag-option"
						class:selected={flag === option}
						aria-pressed={flag === option}
						onclick={() => (flag = option)}
						type="button"
					>
						<StatusIcon name={FLAG_ICONS[option]} color={FLAG_COLORS[option]} size={13} />
						{PASC_FLAG_LABELS[option]}
					</button>
				{/each}
			</div>
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">Public note</span>
				<span class="pasc-meta">visible to</span>
				<select
					class="pasc-select"
					aria-label="Public note visibility"
					bind:value={publicNoteLevel}
				>
					{#each LEVELS as level (level)}
						<option value={level}>{level}+</option>
					{/each}
				</select>
			</div>
			<textarea class="pasc-textarea" rows="3" bind:value={publicNote}></textarea>
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">Internal review</span>
				<span class="pasc-meta">minimum M1+, visible to</span>
				<select
					class="pasc-select"
					aria-label="Internal review visibility"
					bind:value={internalMinLevel}
				>
					{#each LEVELS.filter((l) => PASC_ACCESS_RANK[l] >= PASC_ACCESS_RANK.M1) as level (level)}
						<option value={level}>{level}+</option>
					{/each}
				</select>
			</div>
			<PascMarkdownEditor bind:value={internalReview} />
		</div>
		<div class="pasc-field">
			<span class="pasc-field-label">Case files ({record.files.length + extraFiles.length})</span>
			{#each record.files as file (file.id)}
				<div class="pasc-file-row">
					<span class="pasc-file-name">{file.name}</span>
					<span class="pasc-file-meta"
						>{file.kind}{file.sizeLabel ? ` · ${file.sizeLabel}` : ''}</span
					>
					<!-- Read-only until the proxy forwards file IDs: per-file levels
					     cannot be changed without them. -->
					<select
						class="pasc-select"
						aria-label="{file.name} visibility"
						disabled
						title="Per-file levels change with the file-ID update"
						value={file.accessLevel}
					>
						{#each LEVELS as level (level)}
							<option value={level}>{level}</option>
						{/each}
					</select>
					{#if file.fileId}
						<button
							class="pasc-file-delete"
							aria-label={confirmingDeleteId === file.id
								? `Confirm delete ${file.name}`
								: `Delete ${file.name}`}
							disabled={deletingFile}
							onclick={() => void deleteModalFile(file, false)}
							title={confirmingDeleteId === file.id ? 'Click again to confirm' : 'Delete file'}
							type="button"
						>
							<Trash2 size={12} />
							{confirmingDeleteId === file.id ? 'Sure?' : 'Delete'}
						</button>
					{/if}
				</div>
			{/each}
			{#each extraFiles as file (file.id)}
				<div class="pasc-file-row">
					<span class="pasc-file-name">{file.name}</span>
					<span class="pasc-file-meta"
						>{file.accessLevel}{file.sizeLabel ? ` · ${file.sizeLabel}` : ''}</span
					>
					{#if file.fileId}
						<button
							class="pasc-file-delete"
							aria-label={confirmingDeleteId === file.id
								? `Confirm delete ${file.name}`
								: `Delete ${file.name}`}
							disabled={deletingFile}
							onclick={() => void deleteModalFile(file, true)}
							title={confirmingDeleteId === file.id ? 'Click again to confirm' : 'Delete file'}
							type="button"
						>
							<Trash2 size={12} />
							{confirmingDeleteId === file.id ? 'Sure?' : 'Delete'}
						</button>
					{/if}
				</div>
			{/each}
			<div class="pasc-field-row">
				<select class="pasc-select" aria-label="New file visibility" bind:value={newFileLevel}>
					{#each LEVELS as level (level)}
						<option value={level}>{level}</option>
					{/each}
				</select>
				<button
					class="pasc-edit-button"
					disabled={uploading}
					onclick={() => fileInput?.click()}
					type="button"
				>
					<Upload size={12} />
					{uploading ? 'Uploading…' : 'Attach file (markdown, images)'}
				</button>
			</div>
			<input
				bind:this={fileInput}
				class="hidden"
				accept=".md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp"
				onchange={handleFilesSelected}
				type="file"
			/>
			{#if uploadError}
				<p class="pasc-meta">{uploadError}</p>
			{/if}
			{#if deleteError}
				<p class="pasc-meta">{deleteError}</p>
			{/if}
		</div>
		{#if saveError}
			<p class="pasc-meta">{saveError}</p>
		{/if}
		<div class="pasc-modal-actions">
			<button class="pasc-edit-button" onclick={onClose} type="button">Cancel</button>
			<button class="pasc-edit-button" disabled={saving} onclick={save} type="button">
				{saving ? 'Saving…' : 'Save record'}
			</button>
		</div>
	</div>
</div>
