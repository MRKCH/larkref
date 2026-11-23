import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Both Codex app-server and MCP stdio use line-delimited JSON-RPC.
export function rpcClient(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let sequence = 0;
  const output = createInterface({ input: child.stdout });
  output.on('line', line => {
    const msg = JSON.parse(line);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    clearTimeout(waiter.timer);
    if (msg.error) waiter.reject(new Error(waiter.method + ': ' + msg.error.message));
    else waiter.resolve(msg.result);
  });
  function rejectPending(error) {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  }
  child.on('error', rejectPending);
  child.on('exit', code => rejectPending(new Error('RPC process exited (' + code + ')')));
  const send = msg => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  return {
    request(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('RPC timeout: ' + method));
        }, 60_000);
        pending.set(id, { method, timer, resolve, reject });
        send({ id, method, params });
      });
    },
    notify(method, params = {}) { send({ method, params }); },
    close() { child.stdin.end(); child.kill(); },
  };
}
