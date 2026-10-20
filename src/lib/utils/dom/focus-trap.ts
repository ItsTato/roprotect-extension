// Focus management for dialogs. Svelte action: moves focus into the dialog on
// mount, keeps Tab cycling inside it, and restores the previous focus on
// destroy. Escape is handled by the dialog itself so it can run its own
// unsaved-changes logic before closing.

const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function focusableElements(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(element) => element.offsetParent !== null || element === document.activeElement
	);
}

export function trapFocus(node: HTMLElement): { destroy: () => void } {
	const previouslyFocused = document.activeElement;

	const focusFirst = (): void => {
		const first = focusableElements(node)[0];
		if (first) {
			first.focus();
		} else {
			node.focus();
		}
	};

	const handleKeydown = (event: KeyboardEvent): void => {
		if (event.key !== 'Tab') return;

		const focusable = focusableElements(node);
		if (focusable.length === 0) {
			event.preventDefault();
			return;
		}

		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) return;

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	node.addEventListener('keydown', handleKeydown);
	// Defer so an ancestor that also focuses on mount cannot steal it back.
	queueMicrotask(focusFirst);

	return {
		destroy() {
			node.removeEventListener('keydown', handleKeydown);
			if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
				previouslyFocused.focus();
			}
		}
	};
}
