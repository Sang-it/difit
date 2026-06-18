import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface InstanceEntry {
  name: string;
  repoPath: string;
  url: string;
  port: number;
  pid: number;
  startedAt: string; // ISO timestamp
}

const REGISTRY_DIR = join(homedir(), '.difit');
const REGISTRY_FILE = join(REGISTRY_DIR, 'instances.json');
const LOG_DIR = join(REGISTRY_DIR, 'logs');

function ensureDir(): void {
  mkdirSync(REGISTRY_DIR, { recursive: true });
}

/** Per-instance log file path (also ensures the logs dir exists). */
export function logPathFor(name: string): string {
  mkdirSync(LOG_DIR, { recursive: true });
  const safe = name.replace(/[^a-zA-Z0-9_.-]/gu, '_');
  return join(LOG_DIR, `${safe}.log`);
}

export function readRegistry(): InstanceEntry[] {
  try {
    const raw = readFileSync(REGISTRY_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is InstanceEntry => {
      if (typeof entry !== 'object' || entry === null) {
        return false;
      }
      const e = entry as Record<string, unknown>;
      return typeof e.name === 'string' && typeof e.pid === 'number' && typeof e.url === 'string';
    });
  } catch {
    // Missing or corrupt file -> empty registry
    return [];
  }
}

export function writeRegistry(entries: InstanceEntry[]): void {
  ensureDir();
  const tmp = `${REGISTRY_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2));
  renameSync(tmp, REGISTRY_FILE);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but we can't signal it -> still alive
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function pruneDead(entries: InstanceEntry[]): InstanceEntry[] {
  return entries.filter((entry) => isAlive(entry.pid));
}

/**
 * Read the registry, drop entries whose process is dead, persist the pruned
 * set, and return it. Call at the start of every subcommand.
 */
export function loadLiveRegistry(): InstanceEntry[] {
  const entries = readRegistry();
  const live = pruneDead(entries);
  if (live.length !== entries.length) {
    writeRegistry(live);
  }
  return live;
}

export function findByName(entries: InstanceEntry[], name: string): InstanceEntry | undefined {
  return entries.find((entry) => entry.name === name);
}
