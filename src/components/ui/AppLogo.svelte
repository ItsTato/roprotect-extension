<script lang="ts">
	import { getAssetUrl } from '@/lib/utils/assets';
	import { themeManager } from '@/lib/utils/theme';

	interface Props {
		app?: 'rotector' | 'rayward';
	}

	let { app = 'rotector' }: Props = $props();

	const LOGOS = {
		rotector: {
			light: getAssetUrl('/assets/rotector-logo-light.webp'),
			dark: getAssetUrl('/assets/rotector-logo-dark.webp')
		},
		rayward: {
			light: getAssetUrl('/assets/rayward-logo-light.webp'),
			dark: getAssetUrl('/assets/rayward-logo-dark.webp')
		}
	} as const;

	const NAMES = { rotector: 'Rotector', rayward: 'Rayward' } as const;

	const effectiveTheme = themeManager.effectiveTheme;
	const logoUrl = $derived($effectiveTheme === 'dark' ? LOGOS[app].dark : LOGOS[app].light);
</script>

<img alt={NAMES[app]} src={logoUrl} />
