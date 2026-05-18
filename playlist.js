import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError, ArgumentError } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const OPEN_PLAYLIST = `(function() {
  var footer = document.querySelector('footer');
  if (!footer) return JSON.stringify({ error: 'no footer' });
  var sheet = document.querySelector('.cmd-sidesheet-inner');
  if (!sheet) {
    var btn = footer.querySelector('[aria-label="playlist"]');
    if (btn) { var b = btn.closest('button'); if (b) b.click(); }
  }
  return JSON.stringify({ needWait: !document.querySelector('.cmd-sidesheet-inner') });
})()`;

const EXTRACT_SONGS = `(function() {
  var all = {};
  var container = document.querySelector('.ReactVirtualized__Grid__innerScrollContainer');
  if (!container) return JSON.stringify([]);
  var rows = container.children;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var titleEl = row.querySelector('.title');
    var subTitleEl = row.querySelector('.sub-title');
    var spans = row.querySelectorAll('span');
    var duration = '';
    for (var s of spans) {
      if (s.children.length === 0 && /^\\d{1,2}:\\d{2}$/.test(s.textContent.trim())) {
        duration = s.textContent.trim(); break;
      }
    }
    var title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent.trim()) : '';
    var artist = subTitleEl ? subTitleEl.textContent.replace(/超清母带|VIP|SQ|Hi-Res|无损|标准/g,'').trim() : '';
    var dataLog = row.getAttribute('data-log');
    var songId = '';
    var pos = 0;
    try { var p = JSON.parse(dataLog).params; songId = p.s_songId; pos = p.s_position; } catch(e) {}
    if (title && songId) all[songId] = { pos: pos, name: title, artist: artist, duration: duration };
  }
  return JSON.stringify(all);
})()`;

const SCROLL_DOWN = `(function() {
  var el = document.querySelector('[class*="CurPlayingListTrackWrapper"]');
  if (el) el.scrollTop += 500;
  return 'ok';
})()`;

const RESET_SCROLL = `(function() {
  var el = document.querySelector('[class*="CurPlayingListTrackWrapper"]');
  if (el) el.scrollTop = 0;
  return 'ok';
})()`;

const CLEAR_PLAYLIST = `(function() {
  var clearBtn = document.querySelector('.clear-icon button');
  if (!clearBtn) return JSON.stringify({ error: 'clear button not found' });
  clearBtn.click();
  return JSON.stringify({ clicked: true });
})()`;

const CONFIRM_CLEAR = `(function() {
  var modal = document.querySelector('[class*="ModalWrapper"]');
  if (!modal) return JSON.stringify({ error: 'no confirmation dialog' });
  var btn = modal.querySelector('button[aria-label="confirm"]');
  if (!btn) return JSON.stringify({ error: 'confirm button not found' });
  btn.click();
  return JSON.stringify({ confirmed: true });
})()`;

cli({
  site: 'netease-music',
  name: 'playlist',
  access: 'write',
  description: '获取当前播放列表，支持清空',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 50, help: '返回数量 (max 100)' },
    { name: 'clear', type: 'bool', default: false, help: '清空播放列表' },
  ],
  columns: ['Index', 'Name', 'Artist', 'Duration'],
  func: async (args) => {
    const n = Number(args.limit ?? 50);
    if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('limit must be a positive integer');
    if (n > 100) throw new ArgumentError('limit must be <= 100');

    const doClear = args.clear === true;

    ensureCdpReady();
    const wsUrl = await getCdpSocket();

    // Open playlist sidebar
    const openResult = JSON.parse(await cdpEvaluate(wsUrl, OPEN_PLAYLIST));
    if (openResult.needWait) {
      await new Promise(r => setTimeout(r, 800));
    }

    // Clear playlist mode
    if (doClear) {
      const clickResult = JSON.parse(await cdpEvaluate(wsUrl, CLEAR_PLAYLIST));
      if (clickResult.error) {
        throw new CommandExecutionError(`Clear failed: ${clickResult.error}`);
      }

      await new Promise(r => setTimeout(r, 500));

      const confirmResult = JSON.parse(await cdpEvaluate(wsUrl, CONFIRM_CLEAR));
      if (confirmResult.error) {
        throw new CommandExecutionError(`Confirm failed: ${confirmResult.error}`);
      }

      return [{ Action: 'Cleared', Playlist: '播放列表已清空' }];
    }

    // Scroll + collect all songs from virtualized list
    const collected = {};
    for (let step = 0; step <= 12; step++) {
      const raw = await cdpEvaluate(wsUrl, EXTRACT_SONGS);
      const batch = JSON.parse(raw);
      Object.assign(collected, batch);
      if (Object.keys(collected).length >= n || step === 12) break;

      await cdpEvaluate(wsUrl, SCROLL_DOWN);
      await new Promise(r => setTimeout(r, 300));
    }

    // Reset scroll position
    await cdpEvaluate(wsUrl, RESET_SCROLL);

    const songs = Object.values(collected)
      .sort((a, b) => a.pos - b.pos)
      .slice(0, n);

    if (songs.length === 0) {
      throw new EmptyResultError('netease-music playlist', '播放列表为空');
    }

    return songs.map((item) => ({
      Index: item.pos,
      Name: item.name || '',
      Artist: item.artist || '',
      Duration: item.duration || '',
    }));
  },
});
