<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { updateSetting } from '@/lib/stores/settings';
	import { SETTINGS_KEYS } from '@/lib/types/settings';
	import { apiClient } from '@/lib/services/rotector/api-client';
	import { asApiError } from '@/lib/utils/api/api-error';
	import { logger } from '@/lib/utils/logging/logger';
	import { loadCustomApis } from '@/lib/stores/custom-apis';
	import { showSuccess } from '@/lib/stores/toast';
	import Modal from '../ui/Modal.svelte';
	import ExtLink from '@/components/ui/ExtLink.svelte';
	import { ExternalLink } from '@lucide/svelte';
	import { getAssetUrl } from '@/lib/utils/assets';

	interface Props {
		onClose: () => void;
		onSuccess: () => void;
	}

	let { onClose, onSuccess }: Props = $props();

	let isOpen = $state(true);
	let apiKey = $state('');
	let isValidating = $state(false);
	let validationError = $state<string | null>(null);

	const sigmanetLogo = getAssetUrl('/assets/sigmanet-dark.png');

	async function handleSubmit() {
		const trimmed = apiKey.trim();
		logger.debug('[ApiKeyModal] handleSubmit called', {
			hasKey: !!trimmed,
			keyLength: trimmed.length
		});
		if (!trimmed) {
			validationError = $_('api_key_modal_error_empty');
			logger.debug('[ApiKeyModal] Empty key, showing error');
			return;
		}

		isValidating = true;
		validationError = null;

		try {
			// Validate the key by calling whoami
			logger.debug('[ApiKeyModal] Calling apiClient.whoami...');
			const response = await apiClient.whoami(trimmed);
			logger.debug('[ApiKeyModal] whoami response received', {
				success: response.success,
				hasError: !!response.error,
				hasData: !!response.data
			});

			if (!response.success) {
				logger.error('[ApiKeyModal] whoami returned success=false', { error: response.error });
				throw new Error(response.error ?? 'Invalid response');
			}

			// Store the API key
			logger.debug('[ApiKeyModal] Storing API key in settings...');
			await updateSetting(SETTINGS_KEYS.API_KEY, trimmed);

			// Load the custom APIs based on whoami response
			logger.debug('[ApiKeyModal] Loading custom APIs...');
			await loadCustomApis();

			logger.debug('[ApiKeyModal] API key validated successfully');
			showSuccess($_('api_key_modal_success'));
			onSuccess();
			isOpen = false;
		} catch (error) {
			const err = asApiError(error);
			logger.error('[ApiKeyModal] API key validation failed:', {
				error,
				message: err.message,
				status: err.status,
				code: err.code,
				details: err.details
			});

			switch (err.status) {
				case 401: {
					validationError = $_('api_key_modal_error_invalid');
					break;
				}
				case 403: {
					validationError = $_('api_key_modal_error_forbidden');
					break;
				}
				case 429: {
					validationError = $_('api_key_modal_error_rate_limited');
					break;
				}
				default: {
					validationError = $_('api_key_modal_error_unknown');
				}
			}
		} finally {
			isValidating = false;
		}
	}

	function toggleVisibility() {
		// The modal is rendered in a shadow root via OverlayPortal, so we need to query within the shadow root
		// Find the modal root element that contains the shadow root
		let input: HTMLInputElement | null = null;

		// First try direct document (for non-shadow DOM contexts)
		const directInput = document.querySelector('#api-key');
		if (directInput instanceof HTMLInputElement) {
			input = directInput;
		}

		// If not found, try to find it in shadow roots
		if (!input) {
			// Check all elements with shadow roots for the input
			const allElements = document.querySelectorAll('*');
			for (const el of allElements) {
				if (el.shadowRoot) {
					const found = el.shadowRoot.querySelector('#api-key');
					if (found instanceof HTMLInputElement) {
						input = found;
						break;
					}
				}
			}
		}

		if (input) {
			input.type = input.type === 'password' ? 'text' : 'password';
			logger.debug('[ApiKeyModal] Toggled visibility', { newType: input.type });
		} else {
			logger.error('[ApiKeyModal] Could not find input element for visibility toggle');
		}
	}
</script>

<Modal {onClose} showStatusChip={false} size="narrow" title={$_('api_key_modal_title')} bind:isOpen>
	<div class="api-key-modal">
		<div class="api-key-modal-header">
			<img class="api-key-logo" alt="SIGMANET" height="160" src={sigmanetLogo} width="160" />
			<h1 class="api-key-title">{$_('api_key_modal_title')}</h1>
			<p class="api-key-subtitle">{$_('api_key_modal_subtitle')}</p>
		</div>

		<div class="api-key-form">
			<div class="form-group">
				<label class="form-label" for="api-key">
					{$_('api_key_modal_label')}
				</label>
				<div class="input-wrapper">
					<input
						id="api-key"
						class="form-input"
						disabled={isValidating}
						onkeydown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								void handleSubmit();
							}
						}}
						placeholder={$_('api_key_modal_placeholder')}
						type="password"
						bind:value={apiKey}
					/>
					<button
						class="toggle-visibility"
						aria-label={$_('api_key_modal_toggle_visibility')}
						onclick={toggleVisibility}
						type="button"
					>
						<svg
							fill="none"
							height="20"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							width="20"
						>
							<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
							<circle cx="12" cy="12" r="3" />
						</svg>
					</button>
				</div>
				{#if validationError}
					<p class="form-error" role="alert">{validationError}</p>
				{/if}
			</div>

			<p class="form-hint">
				{$_('api_key_modal_hint')}
				<ExtLink class="hint-link" href="https://discord.gg/ZwJbrWHPVz">
					{$_('api_key_modal_get_key')}
					<ExternalLink size={12} />
				</ExtLink>
			</p>
		</div>
	</div>

	{#snippet actions()}
		<button class="modal-button-cancel" disabled={isValidating} onclick={onClose} type="button">
			{$_('api_key_modal_cancel')}
		</button>
		<button
			class="modal-button-primary"
			disabled={isValidating || !apiKey.trim()}
			onclick={handleSubmit}
			type="button"
		>
			{#if isValidating}
				{$_('api_key_modal_validating')}
			{:else}
				{$_('api_key_modal_submit')}
			{/if}
		</button>
	{/snippet}
</Modal>
