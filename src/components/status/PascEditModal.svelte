<script lang="ts">
	import { untrack } from 'svelte';
	import {
		File as FileIcon,
		FileText,
		Image as ImageIcon,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import StatusIcon from '@/components/icons/StatusIcon.svelte';
	import Select from '@/components/ui/Select.svelte';
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
	const LEVEL_OPTIONS = LEVELS.map((level) => ({ value: level, label: `${level}+` }));
	const FILE_LEVEL_OPTIONS = LEVELS.map((level) => ({ value: level, label: level }));
	const REVIEWER_LEVEL_OPTIONS = LEVELS.filter(
		(level) => PASC_ACCESS_RANK[level] >= PASC_ACCESS_RANK.M1
	).map((level) => ({ value: level, label: `${level}+` }));

	let flag = $state<PascFlag>(untrack(() => record.flag));
	let publicNote = $state(untrack(() => record.publicNote));
	let publicNoteLevel = $state<PascAccessLevel>(untrack(() => record.accessLevel ?? 'A2'));
	let internalReview = $state(untrack(() => record.internalReview));
	let internalMinLevel = $state<PascAccessLevel>(untrack(() => record.internalReviewMinLevel));

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let uploading = $state(false);
	let uploadProgress = $state<{ current: number; total: number } | null>(null);
	let uploadError = $state<string | null>(null);
	let confirmingDeleteId = $state<string | null>(null);
	let deletingFile = $state(false);
	let deleteError = $state<string | null>(null);
	let newFileLevel = $state<PascAccessLevel>(
		untrack(() => record.accessLevel ?? record.internalReviewMinLevel)
	);
	let extraFiles = $state<PascCaseFile[]>([]);
	let fileInput = $state<HTMLInputElement | null>(null);

	const FILE_KIND_LABELS: Record<PascCaseFile['kind'], string> = {
		markdown: 'Markdown',
		image: 'Image',
		other: 'File'
	};

	// The lookup refresh after an upload returns the new file too. Merge both
	// sources and keep the first copy per upstream id (or name for legacy
	// entries without one) so a refresh can never duplicate a row.
	const allFiles = $derived.by(() => {
		const seen: string[] = [];
		const merged: PascCaseFile[] = [];
		for (const file of [...record.files, ...extraFiles]) {
			const key = file.fileId ? `id:${file.fileId}` : `name:${file.name.toLowerCase()}`;
			if (seen.includes(key)) continue;
			seen.push(key);
			merged.push(file);
		}
		return merged;
	});

	const uploadLabel = $derived(
		uploadProgress
			? `Uploading ${String(uploadProgress.current)}/${String(uploadProgress.total)}…`
			: 'Attach files'
	);

	// Once the refreshed record owns an upload, drop the local pending copy.
	// Otherwise deleting the stored file would make the pending row reappear.
	$effect(() => {
		const storedIds = new Set(
			record.files.map((file) => file.fileId).filter((fileId): fileId is string => fileId !== null)
		);
		if (storedIds.size === 0 || extraFiles.length === 0) return;
		const remaining = extraFiles.filter(
			(file) => file.fileId === null || !storedIds.has(file.fileId)
		);
		if (remaining.length !== extraFiles.length) extraFiles = remaining;
	});

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
		const selected = [...input.files];
		input.value = '';
		if (selected.length === 0 || uploading) return;
		uploading = true;
		uploadError = null;
		const uploaded: PascCaseFile[] = [];
		const errors: string[] = [];
		try {
			for (const [index, file] of selected.entries()) {
				uploadProgress = { current: index + 1, total: selected.length };
				try {
					const bytes = await file.arrayBuffer();
					const descriptor = await apiClient.uploadPascFile(
						record.userId,
						file.name,
						bytes,
						file.type || undefined,
						newFileLevel
					);
					const name = descriptor.name ?? file.name;
					if (
						descriptor.fileId &&
						(record.files.some((entry) => entry.fileId === descriptor.fileId) ||
							extraFiles.some((entry) => entry.fileId === descriptor.fileId) ||
							uploaded.some((entry) => entry.fileId === descriptor.fileId))
					) {
						continue;
					}
					uploaded.push({
						id: `upload:${descriptor.fileId}`,
						name,
						kind: pascFileKind(name),
						accessLevel: newFileLevel,
						sizeLabel: formatSize(descriptor.size),
						fileId: descriptor.fileId,
						mockPreview: undefined
					});
				} catch (error) {
					errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
			if (uploaded.length > 0) {
				extraFiles = [...extraFiles, ...uploaded];
				onRefresh?.();
			}
			if (errors.length > 0) {
				const firstError = errors[0] ?? 'File upload failed';
				uploadError =
					errors.length === 1 ? firstError : `${firstError} (+${String(errors.length - 1)} more)`;
			}
		} finally {
			uploading = false;
			uploadProgress = null;
		}
	}

	// The modal only opens for M1+ viewers, so every delete button here is
	// inherently clearance-gated. Stored files refresh from the lookup;
	// just-uploaded extras splice out locally.
	async function deleteModalFile(file: PascCaseFile) {
		if (!file.fileId || deletingFile) return;
		if (confirmingDeleteId !== file.id) {
			confirmingDeleteId = file.id;
			return;
		}
		const fileId = file.fileId;
		confirmingDeleteId = null;
		deletingFile = true;
		deleteError = null;
		try {
			await apiClient.deletePascFile(record.userId, fileId);
			extraFiles = extraFiles.filter((entry) => entry.id !== file.id && entry.fileId !== fileId);
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
				<Select
					ariaLabel="Public note visibility"
					options={LEVEL_OPTIONS}
					bind:value={publicNoteLevel}
				/>
			</div>
			<textarea class="pasc-textarea" rows="3" bind:value={publicNote}></textarea>
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">Internal review</span>
				<span class="pasc-meta">minimum M1+, visible to</span>
				<Select
					ariaLabel="Internal review visibility"
					options={REVIEWER_LEVEL_OPTIONS}
					bind:value={internalMinLevel}
				/>
			</div>
			<PascMarkdownEditor bind:value={internalReview} />
		</div>
		<div class="pasc-field">
			<div class="pasc-field-row">
				<span class="pasc-field-label">Case files</span>
				<span class="pasc-file-count">{allFiles.length}</span>
			</div>

			<div class="pasc-upload">
				<div class="pasc-upload-row">
					<span class="pasc-file-level-label">New files visible to</span>
					<Select
						ariaLabel="New file visibility"
						disabled={uploading}
						options={FILE_LEVEL_OPTIONS}
						bind:value={newFileLevel}
					/>
					<button
						class="pasc-edit-button ms-auto"
						disabled={uploading}
						onclick={() => fileInput?.click()}
						type="button"
					>
						<Upload size={13} />
						{uploadLabel}
					</button>
				</div>
				<span class="pasc-upload-hint">
					Markdown, text, or images · select more than one file at a time
				</span>
			</div>

			{#if allFiles.length > 0}
				<div class="pasc-file-list">
					{#each allFiles as file (file.id)}
						<div class="pasc-file-manage-row">
							<span class="pasc-file-kind" aria-hidden="true">
								{#if file.kind === 'image'}
									<ImageIcon size={13} />
								{:else if file.kind === 'markdown'}
									<FileText size={13} />
								{:else}
									<FileIcon size={13} />
								{/if}
							</span>
							<span class="pasc-file-name" title={file.name}>{file.name}</span>
							<span class="pasc-file-meta">
								{FILE_KIND_LABELS[file.kind]}{file.sizeLabel ? ` · ${file.sizeLabel}` : ''}
							</span>
							<span class="pasc-file-level" title="Visibility was set when this file was uploaded">
								{file.accessLevel}
							</span>
							{#if file.fileId}
								<button
									class="pasc-file-delete"
									aria-label={confirmingDeleteId === file.id
										? `Confirm delete ${file.name}`
										: `Delete ${file.name}`}
									disabled={deletingFile}
									onclick={() => void deleteModalFile(file)}
									title={confirmingDeleteId === file.id ? 'Click again to confirm' : 'Delete file'}
									type="button"
								>
									<Trash2 size={12} />
									{confirmingDeleteId === file.id ? 'Sure?' : 'Delete'}
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="pasc-file-empty">No case files attached yet.</p>
			{/if}

			<input
				bind:this={fileInput}
				class="hidden"
				accept=".md,.markdown,.txt,.png,.jpg,.jpeg,.gif,.webp,.bmp,.avif,.svg"
				multiple
				onchange={handleFilesSelected}
				type="file"
			/>
			{#if uploadError}
				<p class="pasc-file-error">{uploadError}</p>
			{/if}
			{#if deleteError}
				<p class="pasc-file-error">{deleteError}</p>
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
