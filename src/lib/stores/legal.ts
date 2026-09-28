import { derived, writable } from 'svelte/store';
import { settings } from './settings';
import { SETTINGS_KEYS } from '../types/settings';

const forceShowApiKeyModal = writable(false);

export const hasApiKey = derived(settings, ($settings) => {
	// Check if user has entered an API key (stored in settings)
	return !!$settings[SETTINGS_KEYS.API_KEY].trim();
});

export const shouldShowApiKeyModal = derived(
	[hasApiKey, forceShowApiKeyModal],
	([$hasKey, $force]) => {
		if ($force) return !$hasKey;
		// Show API key modal if user hasn't entered a key yet
		return !$hasKey;
	}
);

export const extensionFeaturesEnabled = derived(hasApiKey, ($hasKey) => $hasKey);

export async function acceptApiKey(): Promise<void> {
	forceShowApiKeyModal.set(false);
}

export async function triggerApiKeyEntry(): Promise<void> {
	forceShowApiKeyModal.set(true);
}
