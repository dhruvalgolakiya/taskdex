#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline/promises';

const DEFAULT_REPO_URL = process.env.TASKDEX_REPO_URL || 'https://github.com/DhruvalGolakiya/pylon.git';
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function printHelp() {
  console.log(`
Taskdex CLI

Usage:
  taskdex init [directory] [--repo <url>] [--no-start]
  taskdex setup [directory]
  taskdex --help

Examples:
  taskdex init
  taskdex init my-taskdex
  taskdex init my-taskdex --repo https://github.com/your-org/your-repo.git
  taskdex setup
`);
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

function isTaskdexRepo(dir) {
  return (
    existsSync(path.join(dir, 'bridge-server')) &&
    existsSync(path.join(dir, 'mobile'))
  );
}

function findTaskdexRoot(baseDir) {
  const resolved = path.resolve(baseDir);
  if (isTaskdexRepo(resolved)) return resolved;

  let children = [];
  try {
    children = readdirSync(resolved, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const child of children) {
    if (!child.isDirectory()) continue;
    const candidate = path.join(resolved, child.name);
    if (isTaskdexRepo(candidate)) return candidate;
  }

  return null;
}

function parseInitArgs(argv) {
  let directory = 'codex-mobile';
  let repo = DEFAULT_REPO_URL;
  let noStart = false;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') {
      const next = argv[i + 1];
      if (!next) throw new Error('--repo requires a value');
      repo = next;
      i += 1;
      continue;
    }
    if (arg === '--no-start') {
      noStart = true;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional[0]) directory = positional[0];
  return { directory, repo, noStart };
}

function resolveTaskdexRoot(baseDir) {
  const rootDir = findTaskdexRoot(baseDir);
  if (!rootDir) {
    const attempted = path.resolve(baseDir);
    throw new Error(`Could not find Taskdex repo at ${attempted}. Expected bridge-server and mobile at root or one level below.`);
  }
  return rootDir;
}

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

function parseRuntime(input) {
  const normalized = input.trim().toLowerCase() || 'dev-client';
  if (['dev-client', 'dev', 'devbuild', 'dev-build'].includes(normalized)) return 'dev-client';
  if (['expo-go', 'go', 'expo'].includes(normalized)) return 'expo-go';
  throw new Error('Runtime must be "dev-client" or "expo-go".');
}

function parseBuildPlatform(input) {
  const fallback = process.platform === 'darwin' ? 'ios' : 'android';
  const normalized = input.trim().toLowerCase() || fallback;
  if (!['ios', 'android'].includes(normalized)) {
    throw new Error('Build platform must be "ios" or "android".');
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

async function readSetupConfig() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('\nTaskdex terminal setup\n');
    const portInput = await rl.question('Bridge port [3001]: ');
    const apiKeyInput = await rl.question('Bridge API key [auto-generate]: ');
    const expoModeInput = await rl.question('Expo mode (lan/tunnel) [lan]: ');
    const runtimeInput = await rl.question('App runtime (dev-client/expo-go) [dev-client]: ');
    const installInput = await rl.question('Install npm dependencies first? [Y/n]: ');
    const runtime = parseRuntime(runtimeInput);
    let buildDevClient = false;
    let buildPlatform = process.platform === 'darwin' ? 'ios' : 'android';
    if (runtime === 'dev-client') {
      const buildInput = await rl.question('Build native development client now? [Y/n]: ');
      buildDevClient = parseInstallChoice(buildInput);
      if (buildDevClient) {
        const platformInput = await rl.question(`Build platform (ios/android) [${buildPlatform}]: `);
        buildPlatform = parseBuildPlatform(platformInput);
      }
    }

    return {
      port: parsePort((portInput || '3001').trim()),
      apiKey: apiKeyInput.trim() || crypto.randomBytes(24).toString('hex'),
      expoMode: parseExpoMode(expoModeInput),
      runtime,
      buildDevClient,
      buildPlatform,
      installDeps: parseInstallChoice(installInput),
    };
  } finally {
    rl.close();
  }
}

async function runInteractiveSetup(rootDir) {
  const bridgeDir = path.join(rootDir, 'bridge-server');
  const mobileDir = path.join(rootDir, 'mobile');
  if (!existsSync(bridgeDir) || !existsSync(mobileDir)) {
    throw new Error(`Invalid Taskdex repository at ${rootDir}`);
  }

  const { port, apiKey, expoMode, runtime, buildDevClient, buildPlatform, installDeps } = await readSetupConfig();
  const bridgeUrl = `ws://${getLocalIPv4()}:${port}`;

  console.log(`\nBridge URL: ${bridgeUrl}`);
  console.log(`Bridge API key: ${apiKey}`);
  console.log(`Expo mode: ${expoMode}\n`);

  if (installDeps) {
    console.log('Installing bridge dependencies...\n');
    await runCommand(npmCmd, ['install'], { cwd: bridgeDir });
    // Keep older clones working where this dependency might be missing.
    await runCommand(npmCmd, ['install', 'qrcode-terminal@^0.12.0'], { cwd: bridgeDir });
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

  const expoEnv = {
    ...process.env,
    EXPO_PUBLIC_BRIDGE_URL: bridgeUrl,
    EXPO_PUBLIC_BRIDGE_API_KEY: apiKey,
  };

  if (runtime === 'dev-client' && buildDevClient) {
    console.log(`\nBuilding native dev client (${buildPlatform})...\n`);
    await runCommand(npxCmd, ['expo', `run:${buildPlatform}`, '--no-bundler'], {
      cwd: mobileDir,
      env: expoEnv,
    });
  }

  console.log('\nStarting Expo. Scan the QR code to open the app.');
  console.log('Bridge URL and API key are prefilled from this terminal setup.\n');
  if (runtime === 'dev-client' && !buildDevClient) {
    console.log('If dev client is not installed yet, rerun setup and enable native build.\n');
  }

  const expoArgs = runtime === 'dev-client'
    ? ['expo', 'start', '--dev-client', `--${expoMode}`]
    : ['expo', 'start', `--${expoMode}`];

  try {
    await runCommand(npxCmd, expoArgs, { cwd: mobileDir, env: expoEnv });
  } finally {
    if (!bridgeProcess.killed) {
      bridgeProcess.kill('SIGTERM');
    }
  }
}

async function handleInit(argv) {
  const { directory, repo, noStart } = parseInitArgs(argv);
  const targetDir = path.resolve(process.cwd(), directory);

  if (existsSync(targetDir)) {
    throw new Error(`Target directory already exists: ${targetDir}`);
  }

  console.log(`\nCloning Taskdex into ${targetDir}`);
  await runCommand('git', ['clone', repo, targetDir]);

  if (noStart) {
    console.log('\nRepository installed.');
    console.log(`Next: taskdex setup ${directory}`);
    return;
  }

  const rootDir = resolveTaskdexRoot(targetDir);
  console.log('\nStarting interactive setup...\n');
  await runInteractiveSetup(rootDir);
}

async function handleSetup(argv) {
  const baseDir = argv[0] ? path.resolve(process.cwd(), argv[0]) : process.cwd();
  const rootDir = resolveTaskdexRoot(baseDir);
  await runInteractiveSetup(rootDir);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'init') {
    await handleInit(command === 'init' ? argv.slice(1) : argv);
    return;
  }

  if (command === 'setup') {
    await handleSetup(argv.slice(1));
    return;
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`\nTaskdex CLI error: ${error.message}`);
  process.exit(1);
});
