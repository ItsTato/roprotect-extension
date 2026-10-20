<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { get } from 'svelte/store';
	import { _ } from 'svelte-i18n';
	import { EditorView } from '@codemirror/view';
	import { markdown } from '@codemirror/lang-markdown';
	import { oneDark } from '@codemirror/theme-one-dark';
	import { renderMarkdown } from '@/lib/utils/markdown';
	import { themeManager } from '@/lib/utils/theme';
	import { logger } from '@/lib/utils/logging/logger';

	// CodeMirror markdown editor with live preview for the PASC internal review
	// field. Synchronous init, no workers, no lazy module loading: everything
	// CodeMirror needs is in the bundle, which is what Monaco could not survive
	// here. Preview HTML is DOMPurify-sanitized because reviewer-authored
	// markdown renders for lower-clearance viewers.

	interface Props {
		value?: string;
	}

	let { value = $bindable('') }: Props = $props();

	const theme = themeManager.effectiveTheme;

	let editorHost = $state<HTMLElement | null>(null);
	let view = $state<EditorView | null>(null);
	let previewHtml = $state('');
	let loadError = $state(false);

	// Guards the async markdown render so a slower earlier value cannot
	// overwrite the preview for the latest keystroke.
	let renderToken = 0;

	function updatePreview(next: string): void {
		const token = ++renderToken;
		void renderMarkdown(next).then((html) => {
			if (token === renderToken) previewHtml = html;
		});
	}

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
							updatePreview(value);
						}
					})
				],
				parent: editorHost
			});
			updatePreview(initial);
		} catch (error) {
			loadError = true;
			logger.error('[PASC] CodeMirror failed to initialize:', error);
		}

		return () => {
			renderToken++;
			view?.destroy();
			view = null;
		};
	});
</script>

<div class="pasc-editor-layout">
	<div bind:this={editorHost} class="pasc-editor-pane">
		{#if loadError}
			<p class="pasc-meta">{$_('pasc_editor_load_failed')}</p>
			<textarea
				class="pasc-textarea"
				oninput={(event) => updatePreview(event.currentTarget.value)}
				placeholder={$_('pasc_editor_placeholder')}
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
