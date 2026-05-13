import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const CLICK_PREV = `
(function() {
  const footer = document.querySelector('footer');
  if (!footer) return JSON.stringify({ error: 'no footer' });

  const icon = footer.querySelector('[aria-label="pre"]');
  if (!icon) return JSON.stringify({ error: 'no prev button' });
  const btn = icon.closest('button');
  if (!btn) return JSON.stringify({ error: 'no button wrapper' });
  btn.click();
  return JSON.stringify({ clicked: true });
})()
`;

const CLICK_NEXT = `
(function() {
  const footer = document.querySelector('footer');
  if (!footer) return JSON.stringify({ error: 'no footer' });

  const icon = footer.querySelector('[aria-label="next"]');
  if (!icon) return JSON.stringify({ error: 'no next button' });
  const btn = icon.closest('button');
  if (!btn) return JSON.stringify({ error: 'no button wrapper' });
  btn.click();
  return JSON.stringify({ clicked: true });
})()
`;

cli({
  site: 'netease-music',
  name: 'next',
  access: 'write',
  description: '切换上一首/下一首',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'direction', type: 'string', default: 'next', help: '方向: next / prev' },
  ],
  columns: ['Action'],
  func: async (args) => {
    ensureCdpReady();
    const wsUrl = await getCdpSocket();
    const dir = String(args.direction ?? 'next').toLowerCase();

    const expr = dir === 'prev' ? CLICK_PREV : CLICK_NEXT;
    const raw = await cdpEvaluate(wsUrl, expr);
    const result = JSON.parse(raw);

    if (result.error) {
      throw new CommandExecutionError(`Failed: ${result.error}`);
    }

    return [{ Action: dir === 'prev' ? 'Previous' : 'Next' }];
  },
});
