#!/usr/bin/env node

/**
 * i18n Sync Script
 *
 * Syncs all locale files with the base English file:
 * - Adds missing keys from en to other locales (with empty string as placeholder)
 * - Removes keys that don't exist in en
 * - Sorts keys alphabetically
 *
 * Usage: bun run sync:i18n
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const LOCALE_DIR = path.join(__dirname, '..', 'public', 'locales');
const EN_FILE = path.join(LOCALE_DIR, 'en', 'messages.json');

// ANSI color codes
const colors = {
	reset: '\x1b[0m',
	green: '\x1b[32m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	cyan: '\x1b[36m',
	bold: '\x1b[1m'
};

function discoverLocales() {
	if (!fs.existsSync(LOCALE_DIR)) {
		console.error(`Error: Locale directory not found: ${LOCALE_DIR}`);
		return [];
	}

	return fs
		.readdirSync(LOCALE_DIR, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name)
		.filter((name) => {
			const messagesPath = path.join(LOCALE_DIR, name, 'messages.json');
			return fs.existsSync(messagesPath) && name !== 'en';
		})
		.sort();
}

function syncLocaleFile(locale) {
	const filePath = path.join(LOCALE_DIR, locale, 'messages.json');

	try {
		// Read en file
		const enContent = fs.readFileSync(EN_FILE, 'utf8');
		const enData = JSON.parse(enContent);

		// Read locale file
		const localeContent = fs.readFileSync(filePath, 'utf8');
		const localeData = JSON.parse(localeContent);

		// Track changes
		let added = 0;
		let removed = 0;

		// Add missing keys from en
		for (const key of Object.keys(enData)) {
			if (!(key in localeData)) {
				localeData[key] = ''; // Empty placeholder
				added++;
			}
		}

		// Remove keys not in en
		for (const key of Object.keys(localeData)) {
			if (!(key in enData)) {
				delete localeData[key];
				removed++;
			}
		}

		// Sort keys alphabetically
		const sortedData = Object.keys(localeData)
			.sort()
			.reduce((acc, key) => {
				acc[key] = localeData[key];
				return acc;
			}, {});

		// Write back with tab indentation
		const formatted = JSON.stringify(sortedData, null, '\t') + '\n';
		fs.writeFileSync(filePath, formatted, 'utf8');

		return { added, removed };
	} catch (error) {
		console.error(`Error syncing ${locale}/messages.json: ${error.message}`);
		return null;
	}
}

function syncI18n() {
	console.log(`\n${colors.bold}${colors.cyan}=== i18n Sync ===${colors.reset}\n`);

	const locales = discoverLocales();

	if (locales.length === 0) {
		console.error('No locale files found to sync.');
		process.exit(1);
	}

	console.log(`Found ${locales.length} locale(s) to sync: ${locales.join(', ')}\n`);

	let successCount = 0;
	let failCount = 0;

	for (const locale of locales) {
		const result = syncLocaleFile(locale);
		if (result) {
			console.log(
				`${colors.green}✓${colors.reset} Synced ${locale}/messages.json (added: ${result.added}, removed: ${result.removed})`
			);
			successCount++;
		} else {
			failCount++;
		}
	}

	console.log(`\n${colors.bold}${colors.cyan}=== Summary ===${colors.reset}`);
	console.log(`Successfully synced: ${successCount} file(s)`);
	if (failCount > 0) {
		console.log(`Failed: ${failCount} file(s)`);
	}
	console.log(`\n${colors.green}${colors.bold}✓ Sync complete${colors.reset}\n`);

	process.exit(failCount > 0 ? 1 : 0);
}

// Run sync
syncI18n();
