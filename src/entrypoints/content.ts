import '../styles/index.css';
import { mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { logger } from '@/lib/utils/logging/logger';
import { PageControllerManager } from '@/lib/controllers/PageControllerManager';
import { themeManager } from '@/lib/utils/theme';
import { initializeSettings } from '@/lib/stores/settings';
import { extensionFeaturesEnabled } from '@/lib/stores/legal';
import { loadStoredLanguagePreference } from '@/lib/stores/i18n';
import { loadCustomApis } from '@/lib/stores/custom-apis';
import {
	initializeRestrictedAccess,
	setupRestrictedAccessListener
} from '@/lib/stores/restricted-access';
import { subscribeStorageKey } from '@/lib/utils/storage';
import {
	injectBlurStyles,
	injectDefaultBlurStyles,
	removeBlurStyles
} from '@/lib/services/blur/service';
import { detectPageType } from '@/lib/utils/dom/page-detection';
import { computeAndCacheDeviceFingerprint } from '@/lib/utils/device-fingerprint';
import { metricsCollector } from '@/lib/utils/logging/metrics-collector';
import { registerOverlayContainer } from '@/lib/utils/overlay-portal-registry';
import OverlayRoot from '@/components/overlay/OverlayRoot.svelte';

async function registerBuilderSans(): Promise<void> {
	try {
		const url = browser.runtime.getURL(
			'/fonts/builder-sans/BuilderSans.woff2' as Parameters<typeof browser.runtime.getURL>[0]
		);
		const face = new FontFace('Builder Sans', `url("${url}")`, { weight: '400' });
		await face.load();
		document.fonts.add(face);
	} catch (error) {
		logger.warn('Builder Sans font registration failed; falling back to system font', error);
	}
}

async function waitForBody(): Promise<HTMLElement> {
	return new Promise((resolve) => {
		// document.body is typed as non-null but can be null before DOM loads
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- document.body is typed non-null but is null at document_start before DOM parse
		if (document.body) {
			resolve(document.body);
			return;
		}
		const observer = new MutationObserver(() => {
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- document.body is typed non-null but is null at document_start before DOM parse
			if (document.body) {
				observer.disconnect();
				resolve(document.body);
			}
		});
		observer.observe(document.documentElement, { childList: true });
	});
}

export default defineContentScript({
	matches: [
		// All Roblox pages
		'https://*.roblox.com/*',
		// Internationalized URLs
		'https://*.roblox.com/*/*'
	],
	runAt: 'document_start',

	async main(ctx: ContentScriptContext) {
		try {
			logger.info('Rotector content script initializing...');

			// Privacy first: blur supported pages before any async storage/API
			// work. The per-setting pass below replaces this default stylesheet
			// once settings are loaded.
			if (detectPageType(globalThis.location.href) !== null) {
				injectDefaultBlurStyles();
			}

			logger.debug('Loading stored language preference...');
			await loadStoredLanguagePreference();
			logger.debug('Language preference loaded successfully');

			logger.debug('Initializing settings...');
			await initializeSettings();
			logger.debug('Settings loaded successfully');

			if (detectPageType(globalThis.location.href) !== null) {
				injectBlurStyles();
			}

			logger.debug('Loading custom APIs configuration...');
			await loadCustomApis();
			logger.debug('Custom APIs loaded successfully');

			// Reload custom APIs when API key changes (so new system APIs from whoami are loaded)
			subscribeStorageKey<string>('sync', 'apiKey', async (newKey) => {
				if (newKey?.trim()) {
					logger.debug('API key changed, reloading custom APIs...');
					await loadCustomApis();
					logger.debug('Custom APIs reloaded successfully');
				}
			});

			logger.debug('Initializing access state...');
			await initializeRestrictedAccess();
			setupRestrictedAccessListener();
			logger.debug('Access state initialized');

			await waitForBody();

			// Register Builder Sans against document.fonts. WXT moves @font-face rules
			// into document.head where relative URLs resolve against the page origin
			// and 404; the FontFace API takes the explicit extension URL.
			void registerBuilderSans();

			themeManager.initializeRobloxTheme();

			// Pages without extension features (settings, game details, ...) get a
			// zero visual footprint: no overlay, no injected styles, no controllers.
			// The manager is created lazily only once the feature gate opens.
			let pageManager: PageControllerManager | null = null;
			const ensurePageManager = (): PageControllerManager => {
				pageManager ??= new PageControllerManager();
				return pageManager;
			};

			type Overlay = Awaited<ReturnType<typeof createShadowRootUi>>;
			let overlay: Overlay | null = null;
			let overlayApp: ReturnType<typeof mount> | null = null;
			let visualsActive = false;
			let activation: Promise<void> | null = null;
			let activationEpoch = 0;
			let telemetryStarted = false;
			let currentUrl = globalThis.location.href;
			let navigationToken = 0;
			let listenersInstalled = false;

			// Activation is async (CSS fetch + shadow mount). Each call captures an
			// epoch; deactivateVisuals bumps it so an in-flight mount cannot finish
			// after teardown and leave `visualsActive` true with no overlay attached.
			function visualsAreActive(): boolean {
				return visualsActive;
			}

			async function activateVisuals(): Promise<void> {
				if (visualsAreActive()) return;
				if (activation) {
					await activation;
					if (visualsAreActive()) return;
					// Previous activation was superseded (or failed); retry below.
				}

				const epoch = ++activationEpoch;
				activation = (async () => {
					injectDefaultBlurStyles();
					injectBlurStyles();
					logger.debug('Blur styles injected');

					if (!overlay) {
						const cssUrl = browser.runtime.getURL(
							'/content-scripts/content.css' as Parameters<typeof browser.runtime.getURL>[0]
						);
						const cssResponse = await fetch(cssUrl);
						const shadowCssRaw = await cssResponse.text();
						const cssText = shadowCssRaw.replaceAll(':root', ':host');

						overlay = await createShadowRootUi(ctx, {
							name: 'rotector-overlay',
							position: 'overlay',
							zIndex: 10_000,
							css: cssText,
							onMount(uiContainer, _shadow, shadowHost) {
								registerOverlayContainer(uiContainer);
								themeManager.registerPortalContainer(shadowHost);

								// Register inner html element so [data-theme] CSS selectors
								// match inside the shadow root (bare attribute selectors
								// don't match the shadow host from within shadow CSS)
								const shadowHtml = _shadow.querySelector('html');
								if (shadowHtml) themeManager.registerPortalContainer(shadowHtml);

								overlayApp = mount(OverlayRoot, { target: uiContainer });
								logger.debug('Shadow root overlay mounted');
							},
							onRemove() {
								// Safety net for removals not initiated by deactivateVisuals.
								const app = overlayApp;
								overlayApp = null;
								if (app) void unmount(app);
								logger.debug('Shadow root overlay removed');
							}
						});
					}
					// Teardown (gate close / unsupported navigation) may have won
					// while the stylesheet or shadow root was loading: never mount
					// an overlay the current navigation already discarded.
					if (epoch !== activationEpoch) {
						const staleOverlay = overlay;
						overlay = null;
						staleOverlay.remove();
						return;
					}

					overlay.mount();

					// Safety net for a teardown that raced the mount itself.
					if (epoch !== activationEpoch) {
						const staleOverlay = overlay;
						overlay = null;
						staleOverlay.remove();
						return;
					}

					// Only mark active once the stylesheet fetch and mount succeeded, so a
					// failed activation can be retried on the next navigation.
					visualsActive = true;

					if (!telemetryStarted) {
						telemetryStarted = true;
						void computeAndCacheDeviceFingerprint();
						metricsCollector.start();
					}
				})()
					.catch((error: unknown) => {
						removeBlurStyles();
						throw error;
					})
					.finally(() => {
						activation = null;
					});
				await activation;
			}

			function deactivateVisuals(): void {
				activationEpoch++;
				visualsActive = false;
				removeBlurStyles();

				const app = overlayApp;
				overlayApp = null;
				if (app) void unmount(app);

				const currentOverlay = overlay;
				overlay = null;
				currentOverlay?.remove();
				logger.debug('Visuals deactivated for unsupported page');
			}

			async function handleUrl(url: string): Promise<void> {
				const token = ++navigationToken;

				// The gate is part of the URL contract: SPA navigation must not
				// bypass onboarding/API-key state.
				if (!get(extensionFeaturesEnabled)) {
					deactivateVisuals();
					return;
				}

				if (detectPageType(url) === null) {
					deactivateVisuals();
					await pageManager?.deactivate();
					return;
				}

				await activateVisuals();

				// Gate closed while activation was pending: no visuals may survive.
				if (!get(extensionFeaturesEnabled)) {
					deactivateVisuals();
					return;
				}
				// A newer navigation owns the overlay/controller now.
				if (token !== navigationToken) return;

				await ensurePageManager().handleNavigation(url);
			}

			const navigate = (url: string): void => {
				void handleUrl(url).catch((error: unknown) => {
					logger.error('Failed to handle navigation:', error, { url });
				});
			};

			const checkForNavigation = () => {
				if (globalThis.location.href !== currentUrl) {
					currentUrl = globalThis.location.href;
					logger.debug('Navigation detected', {
						newUrl: currentUrl,
						pathname: globalThis.location.pathname,
						hash: globalThis.location.hash
					});
					navigate(currentUrl);
				}
			};

			const handlePopstate = () => {
				logger.debug('Popstate event detected');
				checkForNavigation();
			};

			const handleHashchange = () => {
				logger.debug('Hash change detected', { hash: globalThis.location.hash });
				checkForNavigation();
			};

			const installNavigationListeners = (): void => {
				if (listenersInstalled) return;
				listenersInstalled = true;
				globalThis.addEventListener('popstate', handlePopstate);
				globalThis.addEventListener('hashchange', handleHashchange);
			};

			const removeNavigationListeners = (): void => {
				if (!listenersInstalled) return;
				listenersInstalled = false;
				globalThis.removeEventListener('popstate', handlePopstate);
				globalThis.removeEventListener('hashchange', handleHashchange);
			};

			// The gate can open (API key accepted) and close (key removed or legal
			// paused) during a session. Navigation listeners exist only while open.
			const unsubscribeGate = extensionFeaturesEnabled.subscribe((enabled) => {
				if (enabled) {
					installNavigationListeners();
					currentUrl = globalThis.location.href;
					navigate(currentUrl);
					return;
				}

				removeNavigationListeners();
				navigationToken++;
				deactivateVisuals();
				void pageManager?.deactivate();
				logger.debug('Waiting for onboarding + legal acceptance to initialize page controllers');
			});

			window.addEventListener('beforeunload', () => {
				logger.debug('Content script cleanup on page unload');
				removeNavigationListeners();
				unsubscribeGate();
				deactivateVisuals();
				metricsCollector.stop();
				themeManager.cleanup();
			});

			logger.info('Rotector content script successfully initialized');
		} catch (error) {
			logger.error('Failed to initialize content script:', error);
			themeManager.cleanup();
		}
	}
});
