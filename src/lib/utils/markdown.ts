import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { logger } from './logging/logger';

// Renders reviewer/authored markdown for display. Output is DOMPurify-sanitized:
// PASC content renders for lower-clearance viewers, so raw HTML must never
// reach the page. Returns an empty string on failure rather than throwing.
export async function renderMarkdown(text: string): Promise<string> {
	try {
		const html = await marked.parse(text);
		return DOMPurify.sanitize(html);
	} catch (error) {
		logger.error('Markdown render failed:', error);
		return '';
	}
}
