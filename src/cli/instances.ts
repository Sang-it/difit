import { execFileSync, spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { Command } from 'commander';
import open from 'open';

import {
  findByName,
  loadLiveRegistry,
  logPathFor,
  readRegistry,
  writeRegistry,
  type InstanceEntry,
} from './registry.js';
import { getGitRoot } from './utils.js';

const BACKGROUND_CHILD_ENV = 'DIFIT_BACKGROUND_CHILD';

interface BackgroundInfo {
  port: number;
  url: string;
  pid: number;
}

interface StartOptions {
  port?: number;
  host?: string;
  context?: number;
}

/**
 * An instance name must not be path-like. We reserve "." and "/" (and "\\")
 * so `difit open <name/path>` can tell a registry name apart from a filesystem
 * path without ambiguity.
 */
function isPathLike(value: string): boolean {
  return value.includes('.') || value.includes('/') || value.includes('\\');
}

// ANSI helpers
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  underline: '\x1b[4m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
};

function findJsonLine(content: string): string | undefined {
  return content
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .find((value) => value.startsWith('{'));
}

/**
 * Spawn difit in detached background mode and resolve with the JSON info it
 * prints ({ port, url, pid }).
 *
 * The child's stdout/stderr are redirected to a real log file (not a pipe).
 * A pipe's read end would close when this parent exits, so the long-lived
 * keep-alive server would get EPIPE on its next write and die. A file fd
 * survives parent exit, keeping the detached server truly daemonized — and
 * leaves a per-instance log for debugging.
 */
function spawnBackground(
  childArgs: string[],
  cwd: string,
  logPath: string,
): Promise<BackgroundInfo> {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return Promise.reject(new Error('Unable to determine difit entrypoint for background process'));
  }

  // Truncate so we don't read a stale JSON line from a previous run.
  const fd = openSync(logPath, 'w');

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [scriptPath, ...childArgs], {
      cwd,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        [BACKGROUND_CHILD_ENV]: '1',
      },
    });
  } finally {
    // The child inherits the fd; the parent no longer needs it.
    closeSync(fd);
  }

  child.unref();

  return new Promise<BackgroundInfo>((resolve, reject) => {
    const start = Date.now();
    let exited = false;

    child.once('error', reject);
    child.once('exit', (code) => {
      // Early exit means startup failed; surface the log content.
      exited = code !== 0 && code !== null;
    });

    const poll = (): void => {
      let content = '';
      try {
        content = readFileSync(logPath, 'utf8');
      } catch {
        content = '';
      }

      const jsonLine = findJsonLine(content);
      if (jsonLine) {
        try {
          resolve(JSON.parse(jsonLine) as BackgroundInfo);
        } catch {
          reject(new Error(`Unexpected output from background difit server: ${jsonLine}`));
        }
        return;
      }

      if (exited) {
        reject(
          new Error(`Background difit server exited early.\n${content.trim() || '(no output)'}`),
        );
        return;
      }

      if (Date.now() - start > 10_000) {
        reject(
          new Error(
            `Timed out while starting background difit server.\n${content.trim() || '(no output)'}`,
          ),
        );
        return;
      }

      setTimeout(poll, 100);
    };

    poll();
  });
}

function formatUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) {
    return '?';
  }
  let secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const days = Math.floor(secs / 86400);
  secs %= 86400;
  const hours = Math.floor(secs / 3600);
  secs %= 3600;
  const mins = Math.floor(secs / 60);
  secs %= 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function visibleLength(str: string): number {
  // strip ANSI escapes for width calculation
  return str.replace(/\x1b\[[0-9;]*m/gu, '').length;
}

function pad(str: string, width: number): string {
  const len = visibleLength(str);
  return str + ' '.repeat(Math.max(0, width - len));
}

function printList(entries: InstanceEntry[]): void {
  if (entries.length === 0) {
    console.log(`${c.dim}No difit instances running.${c.reset}`);
    return;
  }

  const rows = entries.map((e) => ({
    name: `${c.green}${e.name}${c.reset}`,
    url: `${c.blue}${c.underline}${e.url}${c.reset}`,
    pid: String(e.pid),
    uptime: formatUptime(e.startedAt),
    repo: `${c.dim}${e.repoPath}${c.reset}`,
  }));

  const headers = { name: 'NAME', url: 'URL', pid: 'PID', uptime: 'UPTIME', repo: 'REPO' };
  const cols = ['name', 'url', 'pid', 'uptime', 'repo'] as const;
  const widths = Object.fromEntries(
    cols.map((col) => [
      col,
      Math.max(headers[col].length, ...rows.map((r) => visibleLength(r[col]))),
    ]),
  ) as Record<(typeof cols)[number], number>;

  const headerLine = cols
    .map((col) => `${c.bold}${c.cyan}${pad(headers[col], widths[col])}${c.reset}`)
    .join('  ');
  console.log(headerLine);

  for (const row of rows) {
    console.log(cols.map((col) => pad(row[col], widths[col])).join('  '));
  }
}

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start a difit server in the background for the current repo')
    .argument('[name]', 'instance name (defaults to the repo directory name)')
    .argument('[commit-ish]', 'commit/branch/ref to review (defaults to working changes)')
    .argument('[compare-with]', 'optional: compare with this commit/branch')
    .option('--port <port>', 'preferred port (auto-assigned if occupied)', parseInt)
    .option('--host <host>', 'host address to bind')
    .option('--context <lines>', 'number of context lines shown around each change', parseInt)
    .action(
      async (
        name: string | undefined,
        commitish: string | undefined,
        compareWith: string | undefined,
        options: StartOptions,
      ) => {
        try {
          let repoPath: string;
          try {
            repoPath = getGitRoot();
          } catch {
            console.error('Error: Not a git repository (or any of the parent directories)');
            process.exit(1);
          }

          if (name !== undefined && isPathLike(name)) {
            console.error(
              `Error: Instance name "${name}" cannot contain "." or "/". Pick a path-free name.`,
            );
            process.exit(1);
          }

          // Default name is the repo dir; strip any reserved chars so it stays
          // a valid (non-path-like) registry name.
          const instanceName = name ?? basename(repoPath).replace(/[./\\]/gu, '_');

          const live = loadLiveRegistry();
          const byName = findByName(live, instanceName);
          if (byName) {
            console.error(
              `Error: Instance "${instanceName}" already running at ${byName.url}. ` +
                `Run \`difit stop ${instanceName}\` first.`,
            );
            process.exit(1);
          }

          const byPath = live.find((e) => e.repoPath === repoPath);
          if (byPath) {
            console.error(
              `Error: Repo already has a running instance "${byPath.name}" at ${byPath.url}. ` +
                `Run \`difit stop ${byPath.name}\` first.`,
            );
            process.exit(1);
          }

          const childArgs = [commitish ?? 'working'];
          if (compareWith) {
            childArgs.push(compareWith);
          }
          childArgs.push('--keep-alive', '--no-open', '--background');
          if (options.port !== undefined) {
            childArgs.push('--port', String(options.port));
          }
          if (options.host) {
            childArgs.push('--host', options.host);
          }
          if (options.context !== undefined) {
            childArgs.push('--context', String(options.context));
          }

          const info = await spawnBackground(childArgs, repoPath, logPathFor(instanceName));

          const entry: InstanceEntry = {
            name: instanceName,
            repoPath,
            url: info.url,
            port: info.port,
            pid: info.pid,
            startedAt: new Date().toISOString(),
          };
          // Re-read to avoid clobbering instances started concurrently.
          const current = loadLiveRegistry();
          writeRegistry([...current.filter((e) => e.name !== instanceName), entry]);

          console.log(
            `${c.green}✅ Started "${instanceName}"${c.reset} → ${c.blue}${c.underline}${info.url}${c.reset}`,
          );
        } catch (error) {
          console.error('Error:', error instanceof Error ? error.message : 'Unknown error');
          process.exit(1);
        }
      },
    );
}

export function createListCommand(): Command {
  return new Command('list')
    .alias('ls')
    .description('List running difit background instances')
    .action(() => {
      const live = loadLiveRegistry();
      printList(live);
    });
}

export function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop a running difit background instance by name or pid')
    .argument('<name-or-pid>', 'instance name or pid to stop')
    .action((target: string) => {
      const live = loadLiveRegistry();
      // Match by name first; fall back to pid (numeric target).
      const entry =
        findByName(live, target) ??
        (/^\d+$/u.test(target) ? live.find((e) => e.pid === Number(target)) : undefined);
      if (!entry) {
        console.error(`Error: No running instance with name or pid "${target}".`);
        process.exit(1);
      }
      try {
        process.kill(entry.pid, 'SIGTERM');
      } catch (error) {
        // ESRCH = already dead; anything else we surface but still de-register.
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          console.error(
            `Warning: failed to signal pid ${entry.pid}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }
      writeRegistry(live.filter((e) => e.name !== entry.name));
      console.log(`${c.yellow}🛑 Stopped "${entry.name}".${c.reset}`);
    });
}

export function createOpenCommand(): Command {
  return new Command('open')
    .description('Open the webpage of a running difit instance by name or repo path')
    .argument('<name-or-path>', 'instance name, or a path inside the repo to open')
    .action(async (target: string) => {
      const live = loadLiveRegistry();

      // A name is never path-like; a path always is. Resolve accordingly,
      // but fall back to the other lookup so either form still works.
      let entry = isPathLike(target) ? undefined : findByName(live, target);
      if (!entry) {
        const absPath = resolve(target);
        entry = live.find((e) => e.repoPath === absPath);
      }

      if (!entry) {
        console.error(
          `Error: No running instance with name or path "${target}". ` +
            'Run `difit list` to see running instances.',
        );
        process.exit(1);
      }

      await open(entry.url);
      console.log(
        `${c.green}🌐 Opening "${entry.name}"${c.reset} → ${c.blue}${c.underline}${entry.url}${c.reset}`,
      );
    });
}

/**
 * Scan the process table for difit server processes (the CLI entry running as a
 * keep-alive/background server). Catches daemons that escaped the registry —
 * e.g. started before a crash, or left over from an interrupted run — so
 * `kill-server` can do a proper sweep instead of trusting the registry alone.
 */
function findDifitServerPids(excludePid: number): number[] {
  let out = '';
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const line of out.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const cmd = match[2];
    if (pid === excludePid) {
      continue;
    }
    // A difit server: runs the CLI entry as a keep-alive/background server.
    const isDifitEntry = cmd.includes('dist/cli/index.js') && cmd.includes('difit');
    const isServer = cmd.includes('--keep-alive') || cmd.includes('--background');
    if (isDifitEntry && isServer) {
      pids.push(pid);
    }
  }
  return pids;
}

export function createKillServerCommand(): Command {
  return new Command('kill-server')
    .description('Stop ALL difit servers (registry + untracked) and clear the registry')
    .action(() => {
      const pids = new Set<number>();
      for (const entry of readRegistry()) {
        pids.add(entry.pid);
      }
      for (const pid of findDifitServerPids(process.pid)) {
        pids.add(pid);
      }

      if (pids.size === 0) {
        writeRegistry([]);
        console.log(`${c.dim}No difit instances running.${c.reset}`);
        return;
      }

      let killed = 0;
      for (const pid of pids) {
        try {
          process.kill(pid, 'SIGTERM');
          killed += 1;
        } catch {
          // already dead; ignore
        }
      }
      writeRegistry([]);
      console.log(`${c.yellow}🛑 Stopped ${killed} difit instance(s).${c.reset}`);
    });
}
