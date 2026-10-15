import * as v from 'valibot';
import { API_CONFIG } from '@/lib/types/constants';
// PascAccessLevel lives with the shared PASC flag maps until the mock cutover
// relocates them (see PASC.md §8 step 6).
import type { PascFileDescriptor, PascRecordUpsert, UserStatus } from '@/lib/types/api';
import type { PascAccessLevel } from '@/lib/data/pasc-mock';
import { SETTINGS_KEYS } from '@/lib/types/settings';
import { getStorage } from '@/lib/utils/storage';
import { validateEntityId } from '@/lib/utils/dom/sanitizer';
import { parseUserStatus } from '@/lib/schemas/rotector';
import { makeHttpRequest } from '../http-client';

const PascClearanceLevelSchema = v.picklist(['0', 'A1', 'A2', 'M1', 'M2']);

const PascFileDescriptorSchema = v.object({
	fileId: v.string(),
	name: v.nullish(v.string()),
	size: v.nullish(v.number()),
	access: v.nullish(v.string())
});

// Viewer's PASC access level, resolved server-side from identity. Proxied: the
// extension calls RoProtect only, never the PASC service directly.
export async function getPascClearance(clientId?: string): Promise<PascAccessLevel> {
	return makeHttpRequest(API_CONFIG.ENDPOINTS.PASC_CLEARANCE, {
		method: 'GET',
		clientId,
		// Bare envelope (like apiWhoami): the shared unwrapper would strip the
		// outer object before parse ever sees success/error, so unwrap here.
		rawResponse: true,
		parse: (payload) => {
			const parsed = payload as {
				success?: boolean;
				data?: { level?: unknown };
				error?: unknown;
			};
			if (!parsed.success) {
				throw new Error(
					typeof parsed.error === 'string' && parsed.error
						? parsed.error
						: 'PASC clearance lookup failed'
				);
			}
			return v.parse(PascClearanceLevelSchema, parsed.data?.level);
		}
	});
}

// Record upsert (create or replace), M1+ enforced twice server-side. Returns
// the saved record in lookup shape.
export async function upsertPascRecord(
	userId: string | number,
	record: PascRecordUpsert,
	clientId?: string
): Promise<UserStatus> {
	const sanitizedUserId = validateEntityId(userId);
	return makeHttpRequest(`${API_CONFIG.ENDPOINTS.PASC_RECORD}/${sanitizedUserId}`, {
		method: 'PUT',
		body: JSON.stringify(record),
		clientId,
		// Bare envelope (like apiWhoami): contract failures carry no `data`
		// field, so the shared unwrapper would mask the server's message.
		rawResponse: true,
		parse: (payload) => {
			const parsed = payload as {
				success?: boolean;
				data?: unknown;
				error?: unknown;
			};
			if (!parsed.success) {
				throw new Error(
					typeof parsed.error === 'string' && parsed.error
						? parsed.error
						: 'PASC record update failed'
				);
			}
			return parseUserStatus(parsed.data);
		}
	});
}

// Case-file upload. Multipart through the background (content scripts cannot
// set the auth headers the proxy requires). Returns the stored descriptor.
export async function uploadPascFile(
	userId: string | number,
	filename: string,
	bytes: ArrayBuffer,
	contentType: string | undefined,
	access: string | undefined
): Promise<PascFileDescriptor> {
	const sanitizedUserId = validateEntityId(userId);
	const storedApiKey = await getStorage<string>('sync', SETTINGS_KEYS.API_KEY, '');
	const apiKey = storedApiKey.trim();
	if (!apiKey) throw new Error('No API key configured');

	const form = new FormData();
	form.append(
		'file',
		new Blob([bytes], { type: contentType || 'application/octet-stream' }),
		filename
	);
	if (access) form.append('access', access);

	// Raw fetch (not makeHttpRequest): multipart needs the browser-generated
	// boundary content type, which the JSON-oriented client would overwrite.
	const response = await fetch(
		`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PASC_RECORD}/${sanitizedUserId}/files`,
		{ method: 'POST', headers: { 'X-Auth-Token': apiKey }, body: form }
	);
	const payload = (await response.json()) as {
		success?: boolean;
		data?: unknown;
		error?: unknown;
	};
	if (!response.ok || !payload.success) {
		throw new Error(
			typeof payload.error === 'string' && payload.error
				? payload.error
				: `PASC file upload failed (HTTP ${String(response.status)})`
		);
	}
	const descriptor = v.parse(PascFileDescriptorSchema, payload.data);
	return {
		fileId: descriptor.fileId,
		name: descriptor.name ?? filename,
		size: descriptor.size ?? bytes.byteLength,
		access: descriptor.access ?? access ?? null
	};
}
