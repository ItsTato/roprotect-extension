<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { ExternalLink, FileText } from '@lucide/svelte';
	import SiDiscord from '@icons-pack/svelte-simple-icons/icons/SiDiscord';
	import SiGithub from '@icons-pack/svelte-simple-icons/icons/SiGithub';
	import ExtLink from '@/components/ui/ExtLink.svelte';
</script>

<div class="footer-container">
	<div class="footer-link-row">
		<ExtLink class="footer-link" href="https://discord.gg/ZwJbrWHPVz">
			<SiDiscord class="footer-link-icon" size={14} />
			{$_('footer_discord')}
		</ExtLink>
		<span class="footer-link-dot">&middot;</span>
		<ExtLink class="footer-link" href="https://github.com/ItsTato">
			<SiGithub class="footer-link-icon" size={14} />
			{$_('footer_github')}
		</ExtLink>
		<span class="footer-link-dot">&middot;</span>
		<ExtLink class="footer-link" href="https://github.com/ItsTato/roprotect-extension">
			<ExternalLink class="footer-link-icon" />
			{$_('footer_source_code')}
		</ExtLink>
		<span class="footer-link-dot">&middot;</span>
		<ExtLink class="footer-link" href="https://roprotect.tlet.xyz/docs">
			<FileText class="footer-link-icon" />
			{$_('footer_docs')}
		</ExtLink>
	</div>

	<p class="footer-credit">{$_('footer_maintained_by')}</p>
</div>
