import { derived } from 'svelte/store';
import { settings, updateSetting } from './settings';
import { SETTINGS_KEYS } from '../types/settings';

export const shouldShowRaywardNotice = derived(
	settings,
	($settings) =>
		$settings[SETTINGS_KEYS.ONBOARDING_COMPLETED] && !$settings[SETTINGS_KEYS.RAYWARD_NOTICE_SEEN]
);

export async function markRaywardNoticeSeen(): Promise<void> {
	await updateSetting(SETTINGS_KEYS.RAYWARD_NOTICE_SEEN, true);
}
