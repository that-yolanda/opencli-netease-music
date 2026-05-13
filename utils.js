import { execSync } from 'node:child_process';
import { CommandExecutionError, ConfigError } from '@jackwener/opencli/errors';

export const BUNDLE_ID = 'com.netease.163music';
export const APP_NAME = 'NeteaseMusic';
export const DEBUG_PORT = 9223;

export function requireDarwin() {
  if (process.platform !== 'darwin') {
    throw new ConfigError('NetEase Music adapter requires macOS');
  }
}

export function isRunning() {
  try {
    const out = execSync(`pgrep -x ${APP_NAME}`, { encoding: 'utf-8' }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

export function requireRunning() {
  if (!isRunning()) {
    throw new CommandExecutionError('NetEase Music is not running. Launch with: /Applications/NeteaseMusic.app/Contents/MacOS/NeteaseMusic --remote-debugging-port=9223');
  }
}

export function activate() {
  execSync(`osascript -e 'tell application "${APP_NAME}" to activate'`);
  execSync('osascript -e "delay 0.5"');
}

export function ensureCdpReady() {
  requireDarwin();
  requireRunning();
}

export async function getCdpSocket() {
  const resp = await fetch(`http://localhost:${DEBUG_PORT}/json`);
  const targets = await resp.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new CommandExecutionError('No CDP page target found');
  return page.webSocketDebuggerUrl;
}

export async function cdpEvaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new CommandExecutionError('CDP evaluate timeout'));
    }, 10000);

    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new CommandExecutionError('CDP connection failed'));
    });

    ws.addEventListener('open', () => {
      const id = msgId++;
      ws.addEventListener('message', function handler(event) {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          ws.close();
          if (msg.result?.result?.value !== undefined) {
            resolve(msg.result.result.value);
          } else {
            reject(new CommandExecutionError('CDP evaluate returned no value'));
          }
        }
      });
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }));
    });
  });
}
