<script lang="ts">
	import { X } from '@lucide/svelte';
	import { _ } from 'svelte-i18n';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import { trapFocus } from '@/lib/utils/dom/focus-trap';

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

	const title = $derived(
		$_(kind === 'report' ? 'pasc_review_title_report' : 'pasc_review_title_recheck', {
			values: { 0: userId }
		})
	);

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
	aria-label={title}
	aria-modal="true"
	onkeydown={(event) => {
		// Keep host-page and tooltip shortcuts from swallowing keystrokes typed
		// into the note field. Escape closes this dialog before bubbling.
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
		}
		event.stopPropagation();
	}}
	role="dialog"
	tabindex="-1"
	use:trapFocus
>
	<div class="modal-header">
		<h3 class="modal-title">{title}</h3>
		<button class="modal-close" aria-label={$_('pasc_modal_close')} onclick={onClose} type="button">
			<X size={16} />
		</button>
	</div>
	<div style:padding="0 1.125rem" class="pasc-container pasc-modal-body">
		<p class="pasc-meta">{targetLabel}</p>
		<div class="pasc-field">
			<span class="pasc-field-label">{$_('pasc_review_note_label')}</span>
			<textarea
				class="pasc-textarea"
				aria-label={$_('pasc_review_note_label')}
				maxlength={280}
				placeholder={kind === 'report'
					? $_('pasc_review_placeholder_report')
					: $_('pasc_review_placeholder_recheck')}
				rows="3"
				bind:value={comment}
			></textarea>
			<span class="pasc-meta">{comment.length}/280</span>
		</div>
		{#if sendError}
			<p class="pasc-meta">{sendError}</p>
		{/if}
		<div class="pasc-modal-actions">
			<button class="pasc-edit-button" onclick={onClose} type="button">
				{$_('pasc_modal_cancel')}
			</button>
			<button class="pasc-edit-button" disabled={sending} onclick={send} type="button">
				{sending
					? $_('pasc_review_sending')
					: kind === 'report'
						? $_('pasc_review_send_report')
						: $_('pasc_review_send_request')}
			</button>
		</div>
	</div>
</div>
