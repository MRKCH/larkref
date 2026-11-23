import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
// Desktop apps may launch without the PATH initialized by the user's shell.
const executableSearchPath = [process.env.PATH, dirname(process.execPath), ...(process.platform === 'darwin' ?
  ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin'), join(homedir(), '.local/bin')] : [])]
  .filter(Boolean).join(delimiter);

export class FeishuError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function configuration() {
  for (const directory of ['larkref', 'codex-feishu']) {
    const path = join(configHome, directory, 'settings.json');
    try {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      for (const key of ['imProfile', 'docsProfile', 'cliPath']) {
        if (key in value && (typeof value[key] !== 'string' || !value[key].trim())) throw new Error();
      }
      return value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new FeishuError('config', `请检查本机 ${directory}/settings.json 配置。`);
    }
  }
  return {};
}

function cliError(error) {
  if (error.code === 'ENOENT') return new FeishuError('config', '找不到 lark-cli，请安装飞书 CLI 或配置 cliPath。');
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new FeishuError('service', '此资源超过单次读取上限。');
  if (error.killed) return new FeishuError('service', '飞书读取超时，请重试。');
  // The CLI may print a warning before its JSON error on stderr.
  const text = [error.stderr, error.stdout].filter(Boolean).join('\n');
  if (/need_user_authorization|no token|not logged in|auth login|token.+expired/i.test(text) &&
      !/permission_violations|insufficient|99991672|99991679/i.test(text)) {
    return new FeishuError('auth', '请使用对应的 lark-cli profile 登录并授权读取。');
  }
  if (/permission|forbidden|access denied|scope|9999167[29]/i.test(text)) {
    return new FeishuError('permission', '请检查飞书应用的只读权限、用户授权及该对象的可见范围。');
  }
  if (/not found|not exist|deleted|disband/i.test(text)) {
    return new FeishuError('missing', '该飞书对象已移除或当前用户无法查看。');
  }
  return new FeishuError('service', '飞书请求失败，请检查网络、CLI 配置和资源访问权限。');
}

export async function runLark(domain, args, signal) {
  const settings = configuration();
  const profile = domain === 'docs' ? settings.docsProfile : settings.imProfile;
  // +table-list always emits JSON and has no --format flag in lark-cli 1.0.39.
  const format = args[0] === 'base' && args[1] === '+table-list' ? [] : ['--format', 'json'];
  const argv = [...(profile ? ['--profile', profile] : []), ...args, '--as', 'user', ...format];
  let stdout;
  try {
    ({ stdout } = await execute(settings.cliPath || 'lark-cli', argv, {
      signal,
      env: { ...process.env, PATH: executableSearchPath },
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    }));
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw cliError(error);
  }
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new FeishuError('service', '飞书 CLI 返回了无法识别的数据。');
  }
  if (result.ok === false || (typeof result.code === 'number' && result.code !== 0)) {
    throw cliError({ stdout: JSON.stringify(result.error || result) });
  }
  return result.data ?? result;
}
