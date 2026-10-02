// Fetch an image URL and encode as a base64 data URL
// Chunks the buffer through String.fromCharCode to dodge stack overflows
// on large images that would otherwise blow `apply()`
export async function fetchImageAsDataUrl(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Image fetch failed with status ${String(response.status)}`);
	}

	const buffer = await response.arrayBuffer();
	const bytes = new Uint8Array(buffer);

	const chunkSize = 0x80_00;
	let binary = '';
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}

	// Trust the response MIME so non-webp sources (Discord serves png/gif) keep
	// their real type. Roblox's page CSP allows `img-src data:` but not
	// cdn.discordapp.com, so images destined for the tooltip have to travel
	// inline as data URLs rather than be fetched by the page.
	const rawMime = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
	const mimeType = rawMime?.startsWith('image/') ? rawMime : 'image/webp';

	return `data:${mimeType};base64,${btoa(binary)}`;
}
