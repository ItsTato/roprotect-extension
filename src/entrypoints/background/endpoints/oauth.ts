import { API_CONFIG } from '@/lib/types/constants';
import type { DiscordSignInPoll, DiscordSignInStart } from '@/lib/types/api';
import { parseDiscordSignInPoll, parseDiscordSignInStart } from '@/lib/schemas/oauth';
import { buildHttpError } from '@/lib/utils/api/api-error';

// The portal routes are deliberately unauthenticated and CORS-open, so they are
// fetched here rather than through makeHttpRequest: that helper would attach
// X-Auth-Token / Authorization / installation headers, which this handshake must
// not carry. `credentials: 'omit'` also guarantees no cookies are sent.
async function fetchOAuth<T>(path: string, parse: (payload: unknown) => T): Promise<T> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

	try {
		const response = await fetch(`${API_CONFIG.BASE_URL}${path}`, {
			method: 'GET',
			cache: 'no-store',
			credentials: 'omit',
			signal: controller.signal
		});

		if (!response.ok) {
			throw await buildHttpError(response);
		}

		const body: unknown = await response.json();
		if (typeof body !== 'object' || body === null || !('data' in body)) {
			throw new Error('Invalid response from RoProtect.');
		}

		return parse(body.data);
	} catch (error) {
		// Normalize the two raw fetch failures so callers can show the timeout and
		// offline states instead of a generic server error.
		if (error instanceof Error && error.name === 'AbortError') {
			throw Object.assign(new Error('Request timeout'), { status: 408 });
		}
		if (error instanceof TypeError) {
			throw Object.assign(new Error('Unable to connect.'), { status: 0 });
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

// Starts the handshake and opens Discord. The authorize URL is used exactly as
// issued: adding or normalizing parameters would invalidate the Discord state.
export async function startDiscordSignIn(): Promise<DiscordSignInStart> {
	const data = await fetchOAuth(API_CONFIG.ENDPOINTS.OAUTH_PAIR, parseDiscordSignInStart);
	await browser.tabs.create({ url: data.authorizeUrl });
	return data;
}

// Polling is the only transport: the extension never sees the Discord redirect.
export async function pollDiscordSignIn(pair: string): Promise<DiscordSignInPoll> {
	const query = new URLSearchParams({ pair });
	return fetchOAuth(
		`${API_CONFIG.ENDPOINTS.OAUTH_POLL}?${query.toString()}`,
		parseDiscordSignInPoll
	);
}
