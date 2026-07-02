import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStartCommand } from './instances.js';
import { type InstanceEntry } from './registry.js';

const backgroundInfo = {
  port: 4966,
  url: 'http://localhost:4966',
  pid: 12345,
};

describe('instances commands', () => {
  let originalConsoleLog: typeof console.log;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  let originalProcessExit: typeof process.exit;

  beforeEach(() => {
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalProcessExit = process.exit;

    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();
    process.exit = vi.fn() as unknown as typeof process.exit;
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
  });

  function createStartDeps(liveRegistry: InstanceEntry[] = []) {
    return {
      spawnBackground: vi.fn().mockResolvedValue(backgroundInfo),
      openUrl: vi.fn().mockResolvedValue(undefined),
      getGitRoot: vi.fn(() => '/repos/difit'),
      loadLiveRegistry: vi.fn(() => liveRegistry),
      writeRegistry: vi.fn(),
      logPathFor: vi.fn((name: string) => `/tmp/${name}.log`),
    };
  }

  describe('start', () => {
    it('opens the started background instance URL by default', async () => {
      const deps = createStartDeps();
      const command = createStartCommand(deps);

      await command.parseAsync([], { from: 'user' });

      expect(deps.spawnBackground).toHaveBeenCalledWith(
        ['working', '--keep-alive', '--no-open', '--background'],
        '/repos/difit',
        '/tmp/difit.log',
      );
      expect(deps.writeRegistry).toHaveBeenCalledWith([
        expect.objectContaining({
          name: 'difit',
          repoPath: '/repos/difit',
          url: backgroundInfo.url,
          port: backgroundInfo.port,
          pid: backgroundInfo.pid,
        }),
      ]);
      expect(deps.openUrl).toHaveBeenCalledWith(backgroundInfo.url);
    });

    it('does not open the browser when --no-open is provided', async () => {
      const deps = createStartDeps();
      const command = createStartCommand(deps);

      await command.parseAsync(['--no-open'], { from: 'user' });

      expect(deps.writeRegistry).toHaveBeenCalledOnce();
      expect(deps.openUrl).not.toHaveBeenCalled();
    });

    it('does not open when an instance with the same name is already running', async () => {
      const deps = createStartDeps([
        {
          name: 'difit',
          repoPath: '/other/repo',
          url: 'http://localhost:5000',
          port: 5000,
          pid: 23456,
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]);
      const command = createStartCommand(deps);

      await command.parseAsync([], { from: 'user' });

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(deps.spawnBackground).not.toHaveBeenCalled();
      expect(deps.writeRegistry).not.toHaveBeenCalled();
      expect(deps.openUrl).not.toHaveBeenCalled();
    });

    it('opens the current repo instance when it is already running', async () => {
      const deps = createStartDeps([
        {
          name: 'review',
          repoPath: '/repos/difit',
          url: 'http://localhost:5000',
          port: 5000,
          pid: 23456,
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]);
      const command = createStartCommand(deps);

      await command.parseAsync(['custom'], { from: 'user' });

      expect(process.exit).not.toHaveBeenCalled();
      expect(deps.spawnBackground).not.toHaveBeenCalled();
      expect(deps.writeRegistry).not.toHaveBeenCalled();
      expect(deps.openUrl).toHaveBeenCalledWith('http://localhost:5000');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('http://localhost:5000'));
    });

    it('prints the current repo instance URL without opening when --no-open is provided', async () => {
      const deps = createStartDeps([
        {
          name: 'review',
          repoPath: '/repos/difit',
          url: 'http://localhost:5000',
          port: 5000,
          pid: 23456,
          startedAt: '2026-07-02T00:00:00.000Z',
        },
      ]);
      const command = createStartCommand(deps);

      await command.parseAsync(['custom', '--no-open'], { from: 'user' });

      expect(process.exit).not.toHaveBeenCalled();
      expect(deps.spawnBackground).not.toHaveBeenCalled();
      expect(deps.writeRegistry).not.toHaveBeenCalled();
      expect(deps.openUrl).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('http://localhost:5000'));
    });
  });
});
