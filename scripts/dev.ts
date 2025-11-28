/**
 * @file scripts/dev.ts
 * @description Smart development launcher with detailed validation
 * 
 * Features:
 * - Checks for configuration file
 * - Validates configuration
 * - Launches appropriate app based on validation
 * - Handles errors and provides helpful messages
 * 
 * Usage:
 * - bun dev
 * - bun dev --setup
 * - bun dev --cms
 */

import { validateSetupConfiguration, type SetupValidation } from '../apps/shared-utils/setupValidation.js';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const args = process.argv.slice(2);
const forceSetup = args.includes('--setup');
const forceCms = args.includes('--cms');
const isProduction = args.includes('--prod') || args.includes('--production');

// --- Display Functions ---
function printBanner(text: string, color: 'green' | 'yellow' | 'red' = 'green') {
	const colors = {
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		red: '\x1b[31m',
		reset: '\x1b[0m',
		bold: '\x1b[1m'
	};

	const c = colors[color];
	const width = 65;
	const padding = Math.max(0, Math.floor((width - text.length - 2) / 2));

	console.log(
		`\n${c}╔${'═'.repeat(width)}╗${colors.reset}\n${c}║${' '.repeat(padding)}${colors.bold}${text}${colors.reset}${c}${' '.repeat(width - padding - text.length)}║${colors.reset}\n${c}╚${'═'.repeat(width)}╝${colors.reset}\n`
	);
}

function printValidationError(validation: SetupValidation) {
	console.log(
		`\n╔═══════════════════════════════════════════════════════════════╗\n║                     ⚠️  SETUP REQUIRED  ⚠️                      ║\n╠═══════════════════════════════════════════════════════════════╣\n║                                                               ║\n║  ${(validation.reason || 'Configuration missing').padEnd(61)}║\n${validation.missingFields && validation.missingFields.length > 0 ? `║                                                               ║\n║  Missing/Invalid Fields:                                      ║\n${validation.missingFields.map((f) => `║    ❌ ${f.padEnd(57)}║`).join('\n')}` : ''}\n${validation.warnings && validation.warnings.length > 0 ? `║                                                               ║\n║  Warnings:                                                    ║\n${validation.warnings.map((w) => `║    ⚠️  ${w.padEnd(56)}║`).join('\n')}` : ''}\n║                                                               ║\n║  Starting setup wizard...                                     ║\n║                                                               ║\n╚═══════════════════════════════════════════════════════════════╝\n`
	);
}

function printCmsStarting() {
	console.log(
		`\n╔═══════════════════════════════════════════════════════════════╗\n║                    ✅ CONFIGURATION VALID                      ║\n╠═══════════════════════════════════════════════════════════════╣\n║                                                               ║\n║  Starting SveltyCMS...                                        ║\n║                                                               ║\n║  → http://localhost:5173                                      ║\n║                                                               ║\n╚═══════════════════════════════════════════════════════════════╝\n`
	);
}

// --- Helper: Ensure bunx is available ---
function getEnvWithBunx(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	
	// Suppress deprecation warnings and fix NX terminal panic
	env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --no-deprecation`.trim();
	env.NX_TERMINAL_OUTPUT_FORMAT = 'text';
	env.NX_NATIVE_LOGGING = 'false';

	// Check if bunx is already in PATH
	const pathDirs = (env.PATH || '').split(path.delimiter);
	const bunxExists = pathDirs.some(dir => {
		try {
			return fs.existsSync(path.join(dir, 'bunx'));
		} catch {
			return false;
		}
	});

	if (bunxExists) return env;

	try {
		// Create a temporary directory for the shim
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sveltycms-bunx-'));
		const bunPath = process.execPath; // Current bun executable
		
		// Create symlink: bunx -> bun
		fs.symlinkSync(bunPath, path.join(tmpDir, 'bunx'));
		
		// Prepend to PATH
		env.PATH = `${tmpDir}${path.delimiter}${env.PATH}`;
		
		// Attempt to cleanup on exit (best effort)
		process.on('exit', () => {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			} catch {}
		});
	} catch (err) {
		console.warn('⚠️  Failed to create bunx shim:', err);
	}

	return env;
}

// --- App Launcher ---
function launchApp(app: 'setup-wizard' | 'cms', production = false): Promise<void> {
	return new Promise((resolve, reject) => {
		const command = production ? 'build' : 'dev';
		const args = [command, app];

		console.log(`\n🚀 Launching: ${app}`);
		console.log(`📦 Command: nx ${args.join(' ')}\n`);

		const child = spawn('bun', ['x', 'nx', ...args], {
			stdio: 'inherit',
			shell: false, // Disable shell to prevent TTY issues
			env: getEnvWithBunx()
		});

		child.on('error', (error) => {
			console.error(`❌ Failed to start ${app}:`, error);
			reject(error);
		});

		child.on('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`${app} exited with code ${code}`));
			} else {
				resolve();
			}
		});

		process.on('SIGINT', () => {
			console.log('\n\n👋 Shutting down gracefully...');
			child.kill('SIGINT');
			process.exit(0);
		});
	});
}

// --- Main Logic ---
async function main() {
	try {
		printBanner('🚀 SveltyCMS Development Launcher', 'green');

		// Force flags override auto-detection
		if (forceSetup) {
			console.log('🔧 Force flag detected: --setup');
			console.log('   Skipping validation, launching setup wizard...\n');
			await launchApp('setup-wizard', isProduction);
			return;
		}

		if (forceCms) {
			console.log('🔧 Force flag detected: --cms');
			console.log('   Skipping validation, launching CMS...\n');
			await launchApp('cms', isProduction);
			return;
		}

		// Auto-detect configuration state with detailed validation
		console.log('🔍 Checking configuration...');
		const validation = validateSetupConfiguration();

		if (!validation.complete) {
			// Config missing or invalid → Launch setup wizard
			printValidationError(validation);

			console.log('💡 Tip: After setup completes, run "bun dev" again to start the CMS\n');

			await launchApp('setup-wizard', isProduction);
		} else {
			// Config valid → Launch CMS
			printCmsStarting();

			// Show warnings if any
			if (validation.warnings && validation.warnings.length > 0) {
				console.log('\n⚠️  Configuration Warnings:');
				validation.warnings.forEach((w) => console.log(`   - ${w}`));
				console.log('');
			}

			await launchApp('cms', isProduction);
		}
	} catch (error) {
		console.error('\n❌ Launch failed:', error);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
