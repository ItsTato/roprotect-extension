<script lang="ts">
	import { X } from '@lucide/svelte';
	import { apiClient } from '@/lib/services/rotector/api-client';

	// PASC report / recheck window. Renders inside the shared modal shell like
	// the record editor. Sends through the RoProtect proxy, which posts to
	// Discord server-side; the webhook URL never reaches the extension.

	interface Props {
		kind: 'report' | 'recheck';
		userId: string;
		targetLabel: string;
		context: {
			displayName?: string;
			username?: string;
			flag?: string;
			referralProvider?: string;
			referralFlag?: string;
			verdicts?: { provider: string; flag: string; detail: string }[];
		};
		onClose: () => void;
		onSent?: ((kind: 'report' | 'recheck') => void) | undefined;
	}

	let { kind, userId, targetLabel, context, onClose, onSent }: Props = $props();

	let comment = $state('');
	let sending = $state(false);
	let sendError = $state<string | null>(null);

	async function send() {
		if (sending) return;
		sending = true;
		sendError = null;
		try {
			await apiClient.requestPascReview(userId, kind, {
				...context,
				comment: comment.trim()
			});
			onSent?.(kind);
		} catch (error) {
			sendError = error instanceof Error ? error.message : String(error);
		} finally {
			sending = false;
		}
	}
</script>

<div
	class="modal-popup"
	onkeydown={(event) => {
		// Keep host-page and tooltip shortcuts from swallowing keystrokes
		// typed into the note field.
		event.stopPropagation();
	}}
	role="presentation"
>
	<div class="modal-header">
		<h3 class="modal-title">
			{kind === 'report' ? 'Report user' : 'Ask for Recheck'} · {userId}
		</h3>
		<button class="modal-close" aria-label="Close" onclick={onClose} type="button">
			<X size={16} />
		</button>
	</div>
	<div style:padding="0 1.125rem" class="pasc-container pasc-modal-body">
		<p class="pasc-meta">{targetLabel}</p>
		<div class="pasc-field">
			<span class="pasc-field-label">Note for moderators (optional)</span>
			<textarea
				class="pasc-textarea"
				aria-label="Note for moderators"
				maxlength={280}
				placeholder={kind === 'report'
					? 'Why are you reporting this user?'
					: 'What should moderators re-examine?'}
				rows="3"
				bind:value={comment}
			></textarea>
			<span class="pasc-meta">{comment.length}/280</span>
		</div>
		{#if sendError}
			<p class="pasc-meta">{sendError}</p>
		{/if}
		<div class="pasc-modal-actions">
			<button class="pasc-edit-button" onclick={onClose} type="button">Cancel</button>
			<button class="pasc-edit-button" disabled={sending} onclick={send} type="button">
				{sending ? 'Sending…' : kind === 'report' ? 'Send report' : 'Send request'}
			</button>
		</div>
	</div>
</div>
