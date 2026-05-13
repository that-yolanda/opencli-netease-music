import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const GET_LIKE_RECT = `(function() {
  var items = document.querySelectorAll('[class*="ItemContainer_"]');
  for (var item of items) {
    if (item.className.includes('NavItemContainer')) continue;
    var title = item.querySelector('[class*="Title_"]');
    if (title && title.textContent.trim() === '我喜欢的音乐') {
      var r = item.getBoundingClientRect();
      return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)});
    }
  }
  return JSON.stringify({error: 'not found'});
})()`;

const CLICK_PLAY_ALL = `(function() {
  var buttons = document.querySelectorAll('button');
  for (var b of buttons) {
    if (b.textContent.trim() === '播放全部') {
      b.click();
      return 'clicked';
    }
  }
  return JSON.stringify({ error: 'play all button not found' });
})()`;

function cdpMouseClick(wsUrl, x, y) {
  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('ws error')); });
    ws.addEventListener('open', async () => {
      const send = (method, params) => new Promise((res) => {
        const id = msgId++;
        const h = (event) => {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          if (msg.id === id) { ws.removeEventListener('message', h); res(); }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
      });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      clearTimeout(timeout);
      ws.close();
      resolve();
    });
  });
}

cli({
  site: 'netease-music',
  name: 'favorite',
  access: 'write',
  description: '播放"我喜欢的音乐"',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['Action', 'Playlist'],
  func: async () => {
    ensureCdpReady();

    // 获取"我喜欢的音乐"的位置
    const wsUrl = await getCdpSocket();
    const rectRaw = await cdpEvaluate(wsUrl, GET_LIKE_RECT);
    const pos = JSON.parse(rectRaw);
    if (pos.error) throw new CommandExecutionError(`Sidebar item not found: ${pos.error}`);

    // 用 CDP 原生鼠标事件点击
    await cdpMouseClick(wsUrl, pos.x, pos.y);

    await new Promise(r => setTimeout(r, 2000));

    // 重新连接后点击播放全部
    const wsUrl2 = await getCdpSocket();
    const result = await cdpEvaluate(wsUrl2, CLICK_PLAY_ALL);
    let parsed;
    try { parsed = JSON.parse(result); } catch { parsed = null; }
    if (parsed?.error) {
      throw new CommandExecutionError(`Play failed: ${parsed.error}`);
    }

    return [{ Action: 'Playing', Playlist: '我喜欢的音乐' }];
  },
});
