import type {
	OutfitSnapshotByIdResponse,
	OutfitSnapshotByNameResponse,
	OutfitSnapshotResult
} from '../../types/api';
import { apiClient } from '../rotector/api-client';
import { getCacheTtlMs } from '../../stores/settings';
import { API_CONFIG } from '../../types/constants';
import { logger } from '../../utils/logging/logger';

export type SnapshotKey = { kind: 'id'; id: string } | { kind: 'name'; name: string };

export interface SnapshotMaps {
	byId: Map<string, OutfitSnapshotResult>;
	byName: Map<string, OutfitSnapshotResult>;
}

interface SnapshotCacheEntry {
	maps: SnapshotMaps;
	timestamp: number;
	// Approximate retained size in bytes, dominated by the inlined primary data URLs.
	bytes: number;
}

type SnapshotCache = Map<string, SnapshotCacheEntry>;

// Every cached value carries a base64-encoded screenshot, so an unbounded cache
// grows by megabytes per distinct user visited. Bound both the user count and the
// retained payload size, evicting least-recently-used users first.
const MAX_CACHED_USERS = 128;
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
// A single user's bucket also has to stay bounded: repeated tooltip lookups with
// slightly different outfit sets would otherwise merge forever inside one TTL.
const MAX_KEYS_PER_USER = API_CONFIG.OUTFIT_SNAPSHOT_MAX_ITEMS;

class OutfitSnapshotService {
	private readonly cache: SnapshotCache = new Map();
	private cacheBytes = 0;
	private pendingRequests: Record<string, Promise<SnapshotMaps>> = {};

	// Serves cached subset when complete, otherwise dedupes concurrent fetches by sorted-key signature and merges results
	async getSnapshots(userId: string | number, keys: SnapshotKey[]): Promise<SnapshotMaps> {
		const normalizedUserId = String(userId);

		if (keys.length === 0) {
			return emptyMaps();
		}

		const ids: string[] = [];
		const names: string[] = [];
		for (const key of keys) {
			if (key.kind === 'id') ids.push(key.id);
			else names.push(key.name);
		}

		const cached = this.getLiveEntry(normalizedUserId);
		if (
			cached &&
			ids.every((id) => cached.maps.byId.has(id)) &&
			names.every((name) => cached.maps.byName.has(name))
		) {
			return this.buildSubset(cached.maps, ids, names);
		}

		const sortedIds = ids.toSorted();
		const sortedNames = names.toSorted();
		const pendingKey = `${normalizedUserId}:ids=${sortedIds.join(',')}:names=${sortedNames.join(',')}`;
		const existingPromise = this.pendingRequests[pendingKey];
		if (existingPromise !== undefined) {
			const fullMaps = await existingPromise;
			return this.buildSubset(fullMaps, ids, names);
		}

		const promise = this.fetchAndCache(normalizedUserId, ids, names);
		this.pendingRequests[pendingKey] = promise;

		try {
			const fullMaps = await promise;
			return this.buildSubset(fullMaps, ids, names);
		} finally {
			delete this.pendingRequests[pendingKey];
		}
	}

	private async fetchAndCache(
		userId: string,
		ids: string[],
		names: string[]
	): Promise<SnapshotMaps> {
		type FetchPart =
			| { kind: 'name'; response: OutfitSnapshotByNameResponse }
			| { kind: 'id'; response: OutfitSnapshotByIdResponse };

		const tasks: Array<Promise<FetchPart>> = [];
		if (names.length > 0) {
			tasks.push(
				apiClient
					.lookupOutfitsByName(userId, names)
					.then((response): FetchPart => ({ kind: 'name', response }))
			);
		}
		if (ids.length > 0) {
			tasks.push(
				apiClient
					.lookupOutfitsById(userId, ids)
					.then((response): FetchPart => ({ kind: 'id', response }))
			);
		}

		const parts = await Promise.all(tasks);

		const fetched = emptyMaps();
		for (const part of parts) {
			if (part.kind === 'name') {
				for (const entry of part.response.results) fetched.byName.set(entry.name, entry);
			} else {
				for (const entry of part.response.results) fetched.byId.set(entry.outfitId, entry);
			}
		}

		const now = Date.now();
		const existing = this.getLiveEntry(userId);

		if (existing) {
			mergeSuccess(existing.maps, fetched);
			pruneMaps(existing.maps);
			existing.timestamp = now;
			this.remeasure(userId, existing);
		} else {
			const bucket = emptyMaps();
			mergeSuccess(bucket, fetched);
			pruneMaps(bucket);
			if (bucket.byId.size > 0 || bucket.byName.size > 0) {
				this.storeEntry(userId, { maps: bucket, timestamp: now, bytes: 0 });
			}
		}

		return fetched;
	}

	// Returns a TTL-valid entry and marks it as most recently used
	private getLiveEntry(userId: string): SnapshotCacheEntry | null {
		const entry = this.cache.get(userId);
		if (!entry) return null;

		if (Date.now() - entry.timestamp > getCacheTtlMs()) {
			this.deleteEntry(userId);
			return null;
		}

		// Refresh insertion order so eviction is least-recently-used
		this.cache.delete(userId);
		this.cache.set(userId, entry);
		return entry;
	}

	private storeEntry(userId: string, entry: SnapshotCacheEntry): void {
		this.deleteEntry(userId);
		entry.bytes = measureMaps(entry.maps);
		this.cache.set(userId, entry);
		this.cacheBytes += entry.bytes;
		this.pruneCache();
	}

	private remeasure(userId: string, entry: SnapshotCacheEntry): void {
		this.cacheBytes -= entry.bytes;
		entry.bytes = measureMaps(entry.maps);
		this.cacheBytes += entry.bytes;
		// Move to the end: a fresh fetch counts as a recent use
		this.cache.delete(userId);
		this.cache.set(userId, entry);
		this.pruneCache();
	}

	private deleteEntry(userId: string): void {
		const entry = this.cache.get(userId);
		if (!entry) return;
		this.cacheBytes -= entry.bytes;
		this.cache.delete(userId);
	}

	private pruneCache(): void {
		while (this.cache.size > MAX_CACHED_USERS || this.cacheBytes > MAX_CACHED_BYTES) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey === undefined) break;
			logger.debug('Evicting outfit snapshot cache entry', { userId: oldestKey });
			this.deleteEntry(oldestKey);
		}
	}

	// Projects cached maps down to the subset of keys the caller requested
	private buildSubset(source: SnapshotMaps, ids: string[], names: string[]): SnapshotMaps {
		const subset = emptyMaps();
		for (const id of ids) {
			const entry = source.byId.get(id);
			if (entry) subset.byId.set(id, entry);
		}
		for (const name of names) {
			const entry = source.byName.get(name);
			if (entry) subset.byName.set(name, entry);
		}
		return subset;
	}
}

function emptyMaps(): SnapshotMaps {
	return { byId: new Map(), byName: new Map() };
}

// Keeps the newest MAX_KEYS_PER_USER keys in each map, dropping the oldest insertions
function pruneMaps(maps: SnapshotMaps): void {
	pruneMap(maps.byId);
	pruneMap(maps.byName);
}

function pruneMap(map: Map<string, OutfitSnapshotResult>): void {
	while (map.size > MAX_KEYS_PER_USER) {
		const oldestKey = map.keys().next().value;
		if (oldestKey === undefined) break;
		map.delete(oldestKey);
	}
}

// Base64 payloads dominate the entry size; the fixed overhead covers Map keys and object headers
function measureMaps(maps: SnapshotMaps): number {
	let bytes = 0;
	for (const [key, result] of maps.byId) bytes += estimateResultBytes(key, result);
	for (const [key, result] of maps.byName) bytes += estimateResultBytes(key, result);
	return bytes;
}

function estimateResultBytes(key: string, result: OutfitSnapshotResult): number {
	let bytes = key.length + 96;
	if (result.primaryDataUrl) bytes += result.primaryDataUrl.length;
	for (const url of result.rawUrls) bytes += url.length + 8;
	return bytes;
}

function mergeSuccess(target: SnapshotMaps, source: SnapshotMaps): void {
	for (const [id, result] of source.byId) {
		if (!result.primaryFailed) target.byId.set(id, result);
	}
	for (const [name, result] of source.byName) {
		if (!result.primaryFailed) target.byName.set(name, result);
	}
}

export const outfitSnapshotService = new OutfitSnapshotService();
