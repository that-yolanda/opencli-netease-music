import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const CLICK_PLAY = `
(function() {
  const footer = document.querySelector('footer');
  if (!footer) return JSON.stringify({ error: 'no footer' });

  const icon = footer.querySelector('[aria-label="play"], [aria-label="pause"]');
  if (!icon) return JSON.stringify({ error: 'no play/pause button' });

  const btn = icon.closest('button');
  if (!btn) return JSON.stringify({ error: 'no button wrapper' });

  btn.click();
  return JSON.stringify({ clicked: true, was: icon.getAttribute('aria-label') });
})()
`;

cli({
  site: 'netease-music',
  name: 'play',
  access: 'write',
  description: '播放/暂停切换',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Action', 'PreviousState'],
  func: async () => {
    ensureCdpReady();
    const wsUrl = await getCdpSocket();
    const raw = await cdpEvaluate(wsUrl, CLICK_PLAY);
    const result = JSON.parse(raw);

    if (result.error) {
      throw new CommandExecutionError(`Failed: ${result.error}`);
    }

    return [{
      Action: result.was === 'play' ? 'Resumed' : 'Paused',
      PreviousState: result.was === 'play' ? 'Paused' : 'Playing',
    }];
  },
});
