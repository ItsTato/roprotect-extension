#!/usr/bin/env node

/**
 * Sign the Firefox build with Mozilla's web-ext.
 *
 * Produces an "unlisted" AMO submission, so the signed .xpi is installable on
 * release Firefox without being published on the Add-ons Marketplace.
 *
 * Credentials come from AMO_JWT_ISSUER / AMO_JWT_SECRET (or WEB_EXT_API_KEY /
 * WEB_EXT_API_SECRET, which web-ext also reads). They are never read from or
 * written to the repo; .env is gitignored. To create them, see the AMO API
 * credentials page linked in the README.
 *
 * Usage: bun run sign:firefox
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnvFile } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// Load .env explicitly rather than relying on `bun run` to inject it, so the
// script behaves the same when invoked directly as `node scripts/sign-firefox.js`.
// Real environment variables win, so an exported credential is never overridden.
loadEnvFile({ path: path.join(ROOT, '.env'), override: false, quiet: true });

// The Firefox target builds manifest v2 (package.json passes --mv2), so this
// must be firefox-mv2, not firefox-mv3.
const SOURCE_DIR = path.join(ROOT, '.output', 'firefox-mv2');
const ARTIFACTS_DIR = path.join(ROOT, 'web-ext-artifacts');

// Prefer the explicit AMO_* names so the two credential pairs web-ext accepts
// don't have to be documented twice.
// An AMO API key is two halves: the JWT issuer and the JWT secret. The two are
// independent values, so one env var is never enough on its own.
const apiKey = process.env.AMO_JWT_ISSUER ?? process.env.WEB_EXT_API_KEY;
const apiSecret =
	process.env.AMO_JWT_SECRET ?? process.env.JWT_SECRET ?? process.env.WEB_EXT_API_SECRET;

if (!apiKey || !apiSecret) {
	console.error(
		[
			'',
			'Missing AMO API credentials.',
			'',
			'Set both of these before signing:',
			'  AMO_JWT_ISSUER    the JWT issuer from your AMO API credentials',
			'  AMO_JWT_SECRET    the JWT secret from your AMO API credentials',
			'',
			'For a local shell, put them in a .env file at the repo root (gitignored):',
			'  AMO_JWT_ISSUER=...',
			'  AMO_JWT_SECRET=...',
			'',
			'web-ext also accepts these under its own names, WEB_EXT_API_KEY and',
			'WEB_EXT_API_SECRET. See README > Signing the Firefox build.',
			''
		].join('\n')
	);
	process.exit(1);
}

// Check for a build *before* touching anything, so a missing build doesn't get
// reported after side effects. Note the artifacts dir is deliberately not wiped:
// web-ext names each artifact <uuid>-<version>.xpi, so a re-run never collides
// with an existing file, and clearing it would throw away signed builds.
if (!fs.existsSync(path.join(SOURCE_DIR, 'manifest.json'))) {
	console.error(
		[
			'',
			`No Firefox build found at ${SOURCE_DIR}`,
			'',
			'Build it first:',
			'  bun run build:firefox',
			''
		].join('\n')
	);
	process.exit(1);
}

// web-ext is a Node CLI, so it is run under Node rather than Bun. Running it
// via `bun x` works, but Bun aborts with a libuv assertion
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)") while tearing the
// process down, which replaces a real exit code with 9 and would report a
// successful sign as a failure in CI.
//
// npx is invoked through npx-cli.js under the same Node binary rather than as an
// `npx`/`npx.cmd` shim, so no shell is needed. That matters because the JWT
// secret is passed as argv: a secret containing a shell metacharacter would
// otherwise be re-parsed before web-ext ever saw it.
const NODE = process.execPath;
const NPX_CLI = path.join(path.dirname(NODE), 'node_modules', 'npm', 'bin', 'npx-cli.js');

// Pin the major so a future web-ext release can't change signing behaviour
// under us. 8.x is the line that validates data_collection_permissions.
const WEB_EXT_VERSION = 'web-ext@8';

const args = [
	...(fs.existsSync(NPX_CLI) ? [NPX_CLI, '--yes'] : ['--yes']),
	WEB_EXT_VERSION,
	'sign',
	'--source-dir',
	SOURCE_DIR,
	'--artifacts-dir',
	ARTIFACTS_DIR,
	'--api-key',
	apiKey,
	'--api-secret',
	apiSecret,
	// Keeps the add-on private: installable on release Firefox, but not listed
	// on addons.mozilla.org and not eligible for automatic updates.
	'--channel',
	'unlisted'
];

console.log(`Signing ${SOURCE_DIR} as an unlisted add-on...`);
console.log('Artifacts will be written to web-ext-artifacts/\n');

const child = spawn(NODE, args, { stdio: 'inherit', cwd: ROOT });

child.on('error', (error) => {
	console.error(`\nFailed to run web-ext: ${error.message}`);
	process.exit(1);
});

child.on('close', (code) => {
	if (code === 0) {
		const signed = fs.existsSync(ARTIFACTS_DIR)
			? fs.readdirSync(ARTIFACTS_DIR).filter((name) => name.endsWith('.xpi'))
			: [];
		if (signed.length > 0) {
			console.log(`\nSigned: ${path.join(ARTIFACTS_DIR, signed[signed.length - 1])}`);
		}
	} else {
		console.error(
			[
				'',
				`web-ext exited with code ${code}.`,
				'',
				'A "Submission failed: Conflict" or "already been submitted" error means',
				'AMO has already received this version number. AMO accepts one upload per',
				'version, so bump the version before signing again:',
				'  package.json              -> version',
				'  wxt.config.ts             -> manifest().version',
				'  src/lib/types/constants.ts -> REQUIRED_LEGAL_VERSION (only for legal changes)',
				''
			].join('\n')
		);
	}
	process.exit(code ?? 1);
});
