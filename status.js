import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const QUERY = `
(function() {
  const footer = document.querySelector('footer');
  if (!footer) return JSON.stringify({ error: 'no footer' });

  const titleEl = footer.querySelector('.title span, [class*="title"] span');
  const authorEl = footer.querySelector('.author span, [class*="author"] span');
  const timeEl = footer.querySelector('[class*="curtime"], [class*="TimeWarpper"]');

  const playIcon = footer.querySelector('[class*="playorPause"] [aria-label="play"], [class*="playorPause"] [aria-label="pause"]');
  const isPlaying = playIcon ? playIcon.getAttribute('aria-label') === 'pause' : false;

  const loopIcon = footer.querySelector('[aria-label="loop"], [aria-label="shuffle"], [aria-label="single"]');
  const loopMode = loopIcon ? loopIcon.getAttribute('aria-label') : '';

  return JSON.stringify({
    song: titleEl ? titleEl.textContent.trim() : '',
    artist: authorEl ? authorEl.textContent.trim() : '',
    progress: timeEl ? timeEl.textContent.trim() : '',
    isPlaying,
    loopMode
  });
})()
`;

cli({
  site: 'netease-music',
  name: 'status',
  access: 'read',
  description: '获取网易云音乐当前播放状态',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Song', 'Artist', 'Progress', 'State', 'LoopMode'],
  func: async () => {
    ensureCdpReady();
    const wsUrl = await getCdpSocket();
    const raw = await cdpEvaluate(wsUrl, QUERY);
    const info = JSON.parse(raw);

    if (info.error) {
      return [{ Song: '(未找到播放器)', Artist: '', Progress: '', State: '', LoopMode: '' }];
    }

    return [{
      Song: info.song || '(未知)',
      Artist: info.artist || '(未知)',
      Progress: info.progress || '',
      State: info.isPlaying ? 'Playing' : 'Paused',
      LoopMode: info.loopMode || '',
    }];
  },
});
