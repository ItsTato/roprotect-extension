<script generics="T extends string" lang="ts">
	import { tick } from 'svelte';
	import { Check, ChevronDown } from '@lucide/svelte';
	import OverlayPortal from '@/components/overlay/OverlayPortal.svelte';

	// Custom listbox used where a native <select> would render the browser's
	// own chrome (which reads as a foreign element inside the tooltip and
	// popup surfaces). The menu is portaled out of the modal body and pinned to
	// the viewport, so scroll containers can never clip it. Keyboard handling
	// mirrors a native select: arrows move the active option, Enter/Space
	// commits, Escape dismisses.

	interface Props {
		value: T;
		options: readonly { value: T; label: string }[];
		ariaLabel?: string;
		disabled?: boolean;
		placeholder?: string;
		title?: string;
		onchange?: ((value: T) => void) | undefined;
	}

	let {
		value = $bindable(),
		options,
		ariaLabel = 'Select',
		disabled = false,
		placeholder = 'Select…',
		title = undefined,
		onchange
	}: Props = $props();

	const uid = $props.id();
	const listboxId = `${uid}-listbox`;

	function optionId(index: number): string {
		return `${uid}-option-${String(index)}`;
	}

	let root: HTMLDivElement | undefined = $state();
	let trigger: HTMLButtonElement | undefined = $state();
	let menuEl: HTMLDivElement | undefined = $state();
	let open = $state(false);
	let activeIndex = $state(-1);

	// A fixed menu needs viewport coordinates. Only one vertical anchor is set
	// so the menu never stretches between the trigger and the viewport edge.
	let menuTop = $state('auto');
	let menuBottom = $state('auto');
	let menuRight = $state('0px');
	let menuMinWidth = $state('0px');
	let menuMaxHeight = $state('240px');

	const selected = $derived(options.find((option) => option.value === value));
	const selectedLabel = $derived(selected?.label ?? placeholder);

	function close(): void {
		open = false;
		activeIndex = -1;
	}

	function openMenu(): void {
		if (disabled) return;

		const rect = trigger?.getBoundingClientRect();
		if (rect) {
			const margin = 6;
			// clientWidth/clientHeight exclude the classic scrollbar, matching the
			// viewport that fixed positioning is measured against.
			const viewportWidth = document.documentElement.clientWidth;
			const viewportHeight = document.documentElement.clientHeight;
			// Estimate the menu height from the option count so a field near the
			// bottom of the viewport opens upward instead of off-screen.
			const estimated = Math.min(options.length * 30 + 8, 280);
			const spaceBelow = viewportHeight - rect.bottom - margin;
			const spaceAbove = rect.top - margin;
			const up = spaceBelow < estimated && spaceAbove > spaceBelow;
			const maxHeight = Math.max(96, Math.min(280, up ? spaceAbove : spaceBelow));

			// Align the menu's inline-end to the trigger's inline-end: our option
			// labels are short, so growing toward the start is always safe.
			menuTop = up ? 'auto' : `${String(rect.bottom + margin)}px`;
			menuBottom = up ? `${String(viewportHeight - rect.top + margin)}px` : 'auto';
			menuRight = `${String(viewportWidth - rect.right)}px`;
			menuMinWidth = `${String(rect.width)}px`;
			menuMaxHeight = `${String(maxHeight)}px`;
		}

		open = true;
		const current = options.findIndex((option) => option.value === value);
		activeIndex = Math.max(current, 0);
	}

	function toggle(): void {
		if (open) {
			close();
			return;
		}
		openMenu();
	}

	function selectOption(index: number): void {
		const option = options[index];
		if (!option) return;
		value = option.value;
		close();
		onchange?.(option.value);
		void tick().then(() => trigger?.focus());
	}

	function moveActive(delta: number): void {
		if (options.length === 0) return;
		const next = activeIndex < 0 ? 0 : (activeIndex + delta + options.length) % options.length;
		activeIndex = next;
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (disabled) return;

		switch (event.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				event.preventDefault();
				if (!open) {
					openMenu();
					return;
				}
				moveActive(event.key === 'ArrowDown' ? 1 : -1);
				return;
			}
			case 'Home': {
				if (!open) return;
				event.preventDefault();
				activeIndex = 0;
				return;
			}
			case 'End': {
				if (!open) return;
				event.preventDefault();
				activeIndex = options.length - 1;
				return;
			}
			case 'Enter':
			case ' ': {
				event.preventDefault();
				if (open) {
					selectOption(activeIndex);
				} else {
					openMenu();
				}
				return;
			}
			case 'Escape': {
				if (!open) return;
				event.preventDefault();
				// Consume the key: the Select may live inside the tooltip, which
				// also closes on Escape.
				event.stopPropagation();
				close();
				return;
			}
			case 'Tab': {
				close();
				return;
			}
			default: {
				return;
			}
		}
	}

	// Pointer events from the shadow root retarget to the host when observed
	// outside it, so composedPath is the only reliable containment check. The
	// portaled menu is outside `root`, so it needs its own check.
	function isInside(event: Event): boolean {
		const path = event.composedPath();
		return (
			(root !== undefined && path.includes(root)) || (menuEl !== undefined && path.includes(menuEl))
		);
	}

	$effect(() => {
		if (!open) return;

		const handlePointerDown = (event: PointerEvent): void => {
			if (isInside(event)) return;
			close();
		};
		const handleScroll = (event: Event): void => {
			// Scrolling the option list itself is not a dismissal.
			if (isInside(event)) return;
			close();
		};

		globalThis.addEventListener('pointerdown', handlePointerDown, true);
		window.addEventListener('scroll', handleScroll, true);
		window.addEventListener('resize', handleScroll);

		return () => {
			globalThis.removeEventListener('pointerdown', handlePointerDown, true);
			window.removeEventListener('scroll', handleScroll, true);
			window.removeEventListener('resize', handleScroll);
		};
	});
</script>

<div bind:this={root} class="pasc-select">
	<button
		bind:this={trigger}
		class="pasc-select-trigger"
		class:is-open={open}
		aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
		aria-controls={listboxId}
		aria-expanded={open}
		aria-haspopup="listbox"
		aria-label={ariaLabel}
		{disabled}
		onclick={toggle}
		onkeydown={handleKeydown}
		role="combobox"
		{title}
		type="button"
	>
		<span class="pasc-select-value">{selectedLabel}</span>
		<ChevronDown class="pasc-select-chevron" size={12} />
	</button>

	{#if open}
		<OverlayPortal>
			<div
				bind:this={menuEl}
				id={listboxId}
				style:top={menuTop}
				style:bottom={menuBottom}
				style:right={menuRight}
				style:min-width={menuMinWidth}
				style:max-height={menuMaxHeight}
				class="pasc-select-menu"
				aria-label={ariaLabel}
				role="listbox"
				tabindex="-1"
			>
				{#each options as option, index (option.value)}
					<button
						id={optionId(index)}
						class="pasc-select-option"
						class:is-active={index === activeIndex}
						class:is-selected={option.value === value}
						aria-selected={option.value === value}
						onclick={() => selectOption(index)}
						onmouseenter={() => (activeIndex = index)}
						role="option"
						tabindex="-1"
						type="button"
					>
						<span>{option.label}</span>
						{#if option.value === value}
							<Check size={12} />
						{/if}
					</button>
				{/each}
			</div>
		</OverlayPortal>
	{/if}
</div>
