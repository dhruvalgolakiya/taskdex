#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const bridgeDir = path.join(rootDir, 'bridge-server');
const mobileDir = path.join(rootDir, 'mobile');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function parsePort(input) {
  const value = Number(input);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return value;
}

function parseExpoMode(input) {
  const normalized = input.trim().toLowerCase() || 'lan';
  if (!['lan', 'tunnel'].includes(normalized)) {
    throw new Error('Expo mode must be either "lan" or "tunnel".');
  }
  return normalized;
}

function parseInstallChoice(input) {
  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized === 'y' || normalized === 'yes') return true;
  if (normalized === 'n' || normalized === 'no') return false;
  throw new Error('Install choice must be Y or N.');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function readConfig() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nTaskdex terminal setup\n');
    const portInput = await rl.question('Bridge port [3001]: ');
    const apiKeyInput = await rl.question('Bridge API key [auto-generate]: ');
    const expoModeInput = await rl.question('Expo mode (lan/tunnel) [lan]: ');
    const installInput = await rl.question('Install npm dependencies first? [Y/n]: ');

    return {
      port: parsePort((portInput || '3001').trim()),
      apiKey: apiKeyInput.trim() || crypto.randomBytes(24).toString('hex'),
      expoMode: parseExpoMode(expoModeInput),
      installDeps: parseInstallChoice(installInput),
    };
  } finally {
    rl.close();
  }
}

async function main() {
  if (!existsSync(bridgeDir) || !existsSync(mobileDir)) {
    throw new Error(`Expected directories not found. Run this from the codex-mobile repo: ${rootDir}`);
  }

  const { port, apiKey, expoMode, installDeps } = await readConfig();
  const bridgeUrl = `ws://${getLocalIPv4()}:${port}`;

  console.log(`\nBridge URL: ${bridgeUrl}`);
  console.log(`Bridge API key: ${apiKey}`);
  console.log(`Expo mode: ${expoMode}\n`);

  if (installDeps) {
    console.log('Installing bridge dependencies...\n');
    await runCommand(npmCmd, ['install'], { cwd: bridgeDir });
    console.log('\nInstalling mobile dependencies...\n');
    await runCommand(npmCmd, ['install'], { cwd: mobileDir });
  }

  console.log('\nStarting bridge server...\n');
  const bridgeProcess = spawn(npmCmd, ['run', 'dev'], {
    cwd: bridgeDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
      API_KEY: apiKey,
    },
  });

  bridgeProcess.on('error', (error) => {
    console.error(`Bridge failed to start: ${error.message}`);
    process.exit(1);
  });

  await wait(1200);

  console.log('\nStarting Expo. Scan the QR code to open the app.');
  console.log('Bridge URL and API key are prefilled from this terminal setup.\n');

  try {
    await runCommand(npxCmd, ['expo', 'start', `--${expoMode}`], {
      cwd: mobileDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_BRIDGE_URL: bridgeUrl,
        EXPO_PUBLIC_BRIDGE_API_KEY: apiKey,
      },
    });
  } finally {
    if (!bridgeProcess.killed) {
      bridgeProcess.kill('SIGTERM');
    }
  }
}

main().catch((error) => {
  console.error(`\nSetup failed: ${error.message}`);
  process.exit(1);
});
