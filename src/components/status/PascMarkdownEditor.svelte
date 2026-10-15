<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { EditorView } from '@codemirror/view';
	import { markdown } from '@codemirror/lang-markdown';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { renderMarkdown } from '@/lib/utils/markdown';
	import { themeManager } from '@/lib/utils/theme';
	import { logger } from '@/lib/utils/logging/logger';

	// MOCK ONLY — CodeMirror markdown editor with live preview for the PASC
	// internal review field (see T:\Python Projects\TLET\PASC\PASC.md). Synchronous init, no workers, no
	// lazy module loading: everything CodeMirror needs is in the bundle, which
	// is what Monaco could not survive here. Preview HTML is DOMPurify-sanitized
	// because reviewer-authored markdown renders for lower-clearance viewers.

	interface Props {
		value?: string;
	}

	let { value = $bindable('') }: Props = $props();

	const theme = themeManager.effectiveTheme;

	let editorHost = $state<HTMLElement | null>(null);
	let view = $state<EditorView | null>(null);
	let previewHtml = $state('');
	let loadError = $state(false);
	let loadErrorText = $state('');

	onMount(() => {
		if (!editorHost) return;
		const initial = untrack(() => value);
		try {
			view = new EditorView({
				doc: initial,
				extensions: [
					markdown(),
					EditorView.lineWrapping,
					...(get(theme) === 'dark' ? [oneDark] : []),
					EditorView.theme({
						'&': {
							backgroundColor: 'var(--color-bg)',
							color: 'var(--color-text)',
							fontSize: '12px',
							borderRadius: '6px',
							border: '1px solid var(--color-border)'
						},
						'.cm-content': { padding: '8px', minHeight: '180px' },
						'.cm-focused': { outline: 'none' },
						'&.cm-focused': { outline: 'none' }
					}),
					EditorView.updateListener.of((update) => {
						if (update.docChanged) {
							value = update.state.doc.toString();
							void renderMarkdown(value).then((html) => {
								previewHtml = html;
							});
						}
					})
				],
				parent: editorHost
			});
			void renderMarkdown(initial).then((html) => {
				previewHtml = html;
			});
		} catch (error) {
			loadError = true;
			loadErrorText = error instanceof Error ? error.message : String(error);
			logger.error('[PASC mock] CodeMirror failed to initialize:', error);
		}

		return () => {
			view?.destroy();
			view = null;
		};
	});
</script>

<div class="pasc-editor-layout">
	<div bind:this={editorHost} class="pasc-editor-pane">
		{#if loadError}
			<p class="pasc-meta">
				Editor failed to load{loadErrorText ? `: ${loadErrorText}` : ''} — type below, preview still updates.
			</p>
			<textarea
				class="pasc-textarea"
				placeholder="Markdown — preview updates live"
				rows="8"
				bind:value
			></textarea>
		{/if}
	</div>
	<div class="pasc-preview-pane">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via renderMarkdown -->
		{@html previewHtml}
	</div>
</div>
