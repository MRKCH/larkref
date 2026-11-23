import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function cacheDirectory() {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'larkref', 'references-v1');
}

export async function writeJson(path, value) {
  const tmp = join(dirname(path), '.larkref-' + randomUUID() + '.tmp');
  try {
    await writeFile(tmp, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

// Each contender has its own directory. A dead process's ticket can be removed
// without ever unlinking a new owner's lock. The ticket number orders contenders
// that arrive while another process is publishing a cache or reconciling files.
async function tickets(dir) {
  const rows = await Promise.all((await readdir(dir)).map(async id => {
    const pid = /^(\d+)-/.exec(id)?.[1];
    if (!pid) return;
    const slot = join(dir, id);
    try {
      process.kill(Number(pid), 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        await rm(slot, { recursive: true, force: true });
        return;
      }
      if (error.code !== 'EPERM') throw error;
    }
    try {
      return { id, number: Number(await readFile(join(slot, 'ticket'), 'utf8')) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { id, number: 0 }; // Choosing a number, or released since readdir.
    }
  }));
  return rows.filter(Boolean);
}

export async function withIndexLock(fn, signal) {
  const base = cacheDirectory();
  const queue = join(base, 'locks');
  await mkdir(queue, { recursive: true, mode: 0o700 });
  const slot = await mkdtemp(join(queue, process.pid + '-'));
  const id = basename(slot);
  try {
    const number = 1 + Math.max(0, ...(await tickets(queue)).map(t => t.number));
    await writeFile(join(slot, 'choosing'), String(number), { mode: 0o600 });
    await rename(join(slot, 'choosing'), join(slot, 'ticket'));
    const deadline = Date.now() + 90_000;
    for (;;) {
      signal?.throwIfAborted();
      const peers = await tickets(queue);
      if (!peers.some(t => t.id !== id && (t.number < number || (t.number === number && t.id < id)))) break;
      if (Date.now() > deadline) throw new Error('另一窗口仍在更新飞书引用，请稍后重试。');
      await delay(50, undefined, { signal });
    }
    return await fn(base);
  } finally {
    await rm(slot, { recursive: true, force: true });
  }
}
