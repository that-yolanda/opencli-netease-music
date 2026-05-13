import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, ArgumentError } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function cdpSend(wsUrl, method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('ws error')); });
    ws.addEventListener('open', () => {
      const id = 1;
      ws.addEventListener('message', function handler(event) {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          ws.close();
          resolve(msg.result);
        }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  });
}

async function cdpMouseClick(wsUrl, x, y) {
  await cdpSend(wsUrl, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdpSend(wsUrl, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const GET_SEARCH_INPUT_RECT = `(function() {
  var input = document.querySelector('.searchbox input, .cmd-input');
  if (!input) return JSON.stringify(null);
  var r = input.getBoundingClientRect();
  return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)});
})()`;

const CLEAR_AND_SET_INPUT = (query) => `(function() {
  var input = document.querySelector('.searchbox input, .cmd-input');
  if (!input) return JSON.stringify({error: 'no input'});
  input.focus();
  input.select();
  var nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  nativeSetter.call(input, '');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  nativeSetter.call(input, ${JSON.stringify(query)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`;

const PRESS_ENTER = `(function() {
  var input = document.querySelector('.searchbox input, .cmd-input');
  if (!input) return JSON.stringify({error: 'no input'});
  input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',code:'Enter',keyCode:13,bubbles:true}));
  input.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter',code:'Enter',keyCode:13,bubbles:true}));
  input.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter',code:'Enter',keyCode:13,bubbles:true}));
  return 'ok';
})()`;

const CLICK_SINGLE_TAB = `(function() {
  var tabs = document.querySelectorAll('.cmd-tabs-tab');
  for (var tab of tabs) {
    if (tab.textContent.trim() === '单曲') {
      tab.click();
      return 'clicked';
    }
  }
  return JSON.stringify({ error: 'no 单曲 tab' });
})()`;

const EXTRACT_SONGS = `(function() {
  var rows = document.querySelectorAll('.tr');
  var songs = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var numEl = row.querySelector('.td-num');
    var titleEl = row.querySelector('.td-title .title');
    var subTitleEl = row.querySelector('.td-title .sub-title');
    var albumEl = row.querySelector('.td-album');
    var durEl = row.querySelector('.td-duration');
    if (!numEl) continue;
    var title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent.trim()) : '';
    var artist = subTitleEl ? subTitleEl.textContent.replace(/超清母带|VIP|SQ|Hi-Res|无损|标准|原唱|MV/g, '').trim() : '';
    if (!title) continue;
    songs.push({
      index: parseInt(numEl.textContent.trim()) || i,
      name: title,
      artist: artist,
      album: albumEl ? albumEl.textContent.trim() : '',
      duration: durEl ? durEl.textContent.trim() : ''
    });
  }
  return JSON.stringify(songs);
})()`;

const GET_SONG_RECT = (index) => `(function() {
  var rows = document.querySelectorAll('.tr');
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    var numEl = row.querySelector('.td-num');
    var num = parseInt(numEl?.textContent?.trim());
    if (num === ${index}) {
      var rect = row.getBoundingClientRect();
      return JSON.stringify({x: Math.round(rect.left + rect.width/2), y: Math.round(rect.top + rect.height/2)});
    }
  }
  return JSON.stringify(null);
})()`;

cli({
  site: 'netease-music',
  name: 'search',
  access: 'write',
  description: '搜索歌曲并播放',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', type: 'string', help: '搜索关键词' },
    { name: 'play', type: 'int', help: '播放指定序号的歌曲' },
  ],
  columns: ['Index', 'Name', 'Artist', 'Album', 'Duration'],
  func: async (args) => {
    const query = String(args.query ?? '');
    if (!query) throw new ArgumentError('query is required');

    ensureCdpReady();

    // Click search input with CDP native mouse event for reliable focus
    let wsUrl = await getCdpSocket();
    const rectRaw = await cdpEvaluate(wsUrl, GET_SEARCH_INPUT_RECT);
    const pos = JSON.parse(rectRaw);
    if (!pos) throw new CommandExecutionError('Search input not found');

    await cdpMouseClick(wsUrl, pos.x, pos.y);
    await delay(200);

    // Set value and trigger search
    await cdpEvaluate(wsUrl, CLEAR_AND_SET_INPUT(query));
    await cdpSend(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdpSend(wsUrl, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

    await delay(2000);

    // Reconnect and click "单曲" tab
    wsUrl = await getCdpSocket();
    await cdpEvaluate(wsUrl, CLICK_SINGLE_TAB);
    await delay(1200);

    if (args.play != null) {
      const playIdx = Number(args.play);
      if (!Number.isInteger(playIdx) || playIdx < 1) throw new ArgumentError('play must be a positive integer');

      wsUrl = await getCdpSocket();
      const songRect = await cdpEvaluate(wsUrl, GET_SONG_RECT(playIdx));
      const songPos = JSON.parse(songRect);
      if (!songPos) throw new CommandExecutionError(`Song #${playIdx} not found`);

      // Double-click to play (single click only selects)
      await cdpSend(wsUrl, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: songPos.x, y: songPos.y, button: 'left', clickCount: 1 });
      await cdpSend(wsUrl, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: songPos.x, y: songPos.y, button: 'left', clickCount: 1 });
      await cdpSend(wsUrl, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: songPos.x, y: songPos.y, button: 'left', clickCount: 2 });
      await cdpSend(wsUrl, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: songPos.x, y: songPos.y, button: 'left', clickCount: 2 });

      return [{ Action: 'Playing', Song: `#${playIdx}`, Query: query }];
    }

    // Extract results
    wsUrl = await getCdpSocket();
    const raw = await cdpEvaluate(wsUrl, EXTRACT_SONGS);
    const songs = JSON.parse(raw);

    if (songs.length === 0) {
      return [{ Index: '-', Name: '(无结果)', Artist: '', Album: '', Duration: '' }];
    }

    return songs.map((s) => ({
      Index: s.index,
      Name: s.name,
      Artist: s.artist,
      Album: s.album,
      Duration: s.duration,
    }));
  },
});
