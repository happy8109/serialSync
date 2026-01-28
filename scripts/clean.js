/**
 * clean.js - Cross-platform cleanup script for node_modules
 * Optimized: Try direct delete first, then surgical kill, then rename.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const isWin = os.platform() === 'win32';
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'src', 'web');

console.log('\x1b[36m%s\x1b[0m', '--- SerialSync Universal Cleanup ---');

function deleteFolder(targetPath) {
    if (!fs.existsSync(targetPath)) {
        console.log(`  [?] Not found: ${targetPath}`);
        return;
    }

    const name = path.basename(targetPath);
    const parent = path.dirname(targetPath);

    console.log(`  [*] Processing: ${targetPath}`);

    try {
        // Step 1: Try direct deletion
        fs.rmSync(targetPath, { recursive: true, force: true });
        console.log(`  \x1b[32m[+] Success: ${name} deleted directly.\x1b[0m`);
    } catch (err) {
        if (isWin && (err.code === 'EBUSY' || err.code === 'EPERM')) {
            console.log(`  \x1b[33m[!] Locked: ${name}. Attempting to resolve...\x1b[0m`);

            // Step 2: Surgical kill other nodes (No /T to avoid killing the shell/npm parent)
            try {
                execSync(`taskkill /F /FI "PID ne ${process.pid}" /IM node.exe`, { stdio: 'ignore' });
                // Short wait for file handles to release
            } catch (e) { }

            try {
                // Retry delete
                fs.rmSync(targetPath, { recursive: true, force: true });
                console.log(`  \x1b[32m[+] Success: ${name} deleted after resolving locks.\x1b[0m`);
            } catch (retryErr) {
                // Step 3: Final fallback - rename
                const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(11, 19);
                const tempName = `${name}_old_${timestamp}`;
                const tempPath = path.join(parent, tempName);

                try {
                    fs.renameSync(targetPath, tempPath);
                    console.log(`  \x1b[32m[+] Moved: ${name} -> ${tempName} (Could not delete).\x1b[0m`);
                } catch (e) {
                    console.error(`  \x1b[31m[!] Failed: ${targetPath} is still heavily locked.\x1b[0m`);
                }
            }
        } else {
            console.error(`  \x1b[31m[!] Error: ${err.message}\x1b[0m`);
        }
    }
}

// Execution
deleteFolder(path.join(rootDir, 'node_modules'));
deleteFolder(path.join(webDir, 'node_modules'));

console.log('\x1b[36m%s\x1b[0m', '--- Cleanup Completed ---');
