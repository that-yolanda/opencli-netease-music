import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, ArgumentError } from '@jackwener/opencli/errors';
import { ensureCdpReady, getCdpSocket, cdpEvaluate } from './utils.js';

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function navAndWait(expression) {
  try {
    const wsUrl = await getCdpSocket();
    await cdpEvaluate(wsUrl, expression);
  } catch { /* navigation may disconnect */ }
  await delay(2500);
}

async function evalSafe(expression) {
  const wsUrl = await getCdpSocket();
  return cdpEvaluate(wsUrl, expression);
}

function cdpAsync(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 15000);
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('ws error')); });
    ws.addEventListener('open', () => {
      const id = msgId++;
      ws.addEventListener('message', function handler(event) {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          ws.close();
          if (msg.result?.result?.value !== undefined) resolve(msg.result.result.value);
          else reject(new Error('no value'));
        }
      });
      ws.send(JSON.stringify({
        id, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
  });
}

function cdpMouseClick(wsUrl, x, y) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('ws error')); });
    ws.addEventListener('open', () => {
      const send = (method, params) => new Promise((res) => {
        const id = msgId++;
        const h = (event) => {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
          if (msg.id === id) { ws.removeEventListener('message', h); res(); }
        };
        ws.addEventListener('message', h);
        ws.send(JSON.stringify({ id, method, params }));
      });
      send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
        .then(() => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }))
        .then(() => { clearTimeout(timeout); ws.close(); resolve(); });
    });
  });
}

const GET_FEATURED_RECT = `(function() {
  var items = document.querySelectorAll('[class*="ItemContainer_"]');
  for (var item of items) {
    if (item.className.includes('NavItemContainer')) continue;
    var title = item.querySelector('[class*="Title_"]');
    if (title && title.textContent.trim() === '精选') {
      var r = item.getBoundingClientRect();
      return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)});
    }
  }
  return JSON.stringify(null);
})()`;

const CLICK_PLAYLIST_SQUARE = `(function() {
  var tabs = document.querySelectorAll('.cmd-tabs-tab');
  for (var tab of tabs) {
    if (tab.textContent.trim() === '歌单广场') { tab.click(); return 'ok'; }
  }
  return 'not found';
})()`;

const GET_MORE_CATS_BTN_RECT = `(function() {
  var btns = document.querySelectorAll('.tags-btns button');
  for (var b of btns) {
    if (b.textContent.trim() === '更多分类') {
      var r = b.getBoundingClientRect();
      return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2)});
    }
  }
  return JSON.stringify(null);
})()`;

const EXTRACT_ALL_CATEGORIES = `(async function() {
  var panel = document.querySelector('[class*="Panel_p"]');
  if (!panel) return JSON.stringify(null);
  var tabs = panel.querySelectorAll('.cmd-tabs-tab');
  var container = panel.querySelector('[class*="TagsContainer"]');
  if (!container) return JSON.stringify(null);
  var allData = {};
  for (var tab of tabs) {
    var tabName = tab.textContent.trim();
    tab.click();
    await new Promise(r => setTimeout(r, 300));
    var btns = container.querySelectorAll('button');
    var items = [];
    for (var b of btns) items.push(b.textContent.trim());
    allData[tabName] = items;
  }
  return JSON.stringify(allData);
})()`;

const CLOSE_PANEL = `(function() {
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
})()`;

const EXTRACT_DEFAULT_CATEGORIES = `(function() {
  var tagsBtns = document.querySelector('.tags-btns');
  if (!tagsBtns) return JSON.stringify([]);
  var btns = tagsBtns.querySelectorAll('button');
  var tags = [];
  for (var b of btns) {
    var t = b.textContent.trim();
    if (t && t !== '更多分类') tags.push(t);
  }
  return JSON.stringify(tags);
})()`;

const CLICK_CATEGORY = (name) => `(function() {
  // Try tags-btns first
  var tagsBtns = document.querySelector('.tags-btns');
  if (tagsBtns) {
    var btns = tagsBtns.querySelectorAll('button');
    for (var b of btns) {
      if (b.textContent.trim() === ${JSON.stringify(name)}) {
        b.click();
        return 'ok';
      }
    }
  }
  // Try panel TagsContainer
  var container = document.querySelector('[class*="Panel_p"] [class*="TagsContainer"]');
  if (container) {
    var btns2 = container.querySelectorAll('button');
    for (var b of btns2) {
      if (b.textContent.trim() === ${JSON.stringify(name)}) {
        b.click();
        return 'ok';
      }
    }
  }
  return JSON.stringify({error: 'category not found'});
})()`;

const EXTRACT_PLAYLISTS = `(function() {
  var cards = document.querySelectorAll('.playlist-card');
  var items = [];
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var nameEl = card.querySelector('.name');
    var pcEl = card.querySelector('.play-count');
    var name = nameEl ? nameEl.textContent.trim() : '';
    if (!name) continue;
    items.push({
      index: i + 1,
      name: name.substring(0, 50),
      playCount: pcEl ? pcEl.textContent.trim() : ''
    });
  }
  return JSON.stringify(items);
})()`;

const CLICK_CARD = (idx) => `(function() {
  var cards = document.querySelectorAll('.playlist-card');
  var target = cards[${idx - 1}];
  if (!target) return JSON.stringify({error: 'card not found at index ${idx}'});
  var rect = target.getBoundingClientRect();
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(evt) {
    target.dispatchEvent(new MouseEvent(evt, {
      bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }));
  });
  return 'ok';
})()`;

const CLICK_PLAY_ALL = `(function() {
  var buttons = document.querySelectorAll('button');
  for (var b of buttons) {
    if (b.textContent.trim() === '播放全部') {
      b.click();
      return 'ok';
    }
  }
  return JSON.stringify({error: 'play all button not found'});
})()`;

cli({
  site: 'netease-music',
  name: 'explore',
  access: 'write',
  description: '探索推荐歌单',
  domain: 'localhost',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'category', type: 'string', help: '分类名称（不填则显示分类列表）' },
    { name: 'play', type: 'int', help: '播放指定位置的歌单' },
  ],
  columns: ['Index', 'Name'],
  func: async (args) => {
    ensureCdpReady();

    const category = args.category ? String(args.category) : null;
    const playIdx = args.play != null ? Number(args.play) : null;

    if (playIdx != null && (!Number.isInteger(playIdx) || playIdx < 1)) {
      throw new ArgumentError('play must be a positive integer');
    }
    if (playIdx != null && !category) {
      throw new ArgumentError('category is required when using --play');
    }

    // Navigate to 精选 with CDP native mouse click
    let wsUrl = await getCdpSocket();
    const featuredRect = await cdpEvaluate(wsUrl, GET_FEATURED_RECT);
    const featuredPos = JSON.parse(featuredRect);
    if (featuredPos) {
      await cdpMouseClick(wsUrl, featuredPos.x, featuredPos.y);
    }
    await delay(2500);

    // Click 歌单广场 tab
    await navAndWait(CLICK_PLAYLIST_SQUARE);

    if (!category) {
      // Get default categories
      const raw = await evalSafe(EXTRACT_DEFAULT_CATEGORIES);
      const defaults = JSON.parse(raw);

      // Try to get more categories from "更多分类" panel
      let extraByGroup = {};
      try {
        const rectRaw = await evalSafe(GET_MORE_CATS_BTN_RECT);
        const pos = JSON.parse(rectRaw);
        if (pos) {
          const wsUrl = await getCdpSocket();
          await cdpMouseClick(wsUrl, pos.x, pos.y);
          await delay(800);

          const wsUrl2 = await getCdpSocket();
          const panelRaw = await cdpAsync(wsUrl2, EXTRACT_ALL_CATEGORIES);
          const panelData = JSON.parse(panelRaw);
          if (panelData) extraByGroup = panelData;

          // Close panel
          await evalSafe(CLOSE_PANEL);
        }
      } catch { /* more categories not available */ }

      // Build result: defaults first, then grouped extras
      const rows = [];
      let idx = 1;
      for (const name of defaults) {
        rows.push({ Index: idx++, Name: name, Group: '' });
      }
      for (const [group, cats] of Object.entries(extraByGroup)) {
        for (const name of cats) {
          if (!defaults.includes(name)) {
            rows.push({ Index: idx++, Name: name, Group: group });
          }
        }
      }

      return rows.length > 0 ? rows : [{ Index: '-', Name: '(无分类)', Group: '' }];
    }

    // Click category (may need to re-open panel for extended categories)
    const catResult = await evalSafe(CLICK_CATEGORY(category));
    let cp;
    try { cp = JSON.parse(catResult); } catch { cp = null; }
    if (cp?.error) {
      // Category might be in the "更多分类" panel - try opening it
      try {
        const rectRaw = await evalSafe(GET_MORE_CATS_BTN_RECT);
        const pos = JSON.parse(rectRaw);
        if (pos) {
          const wsUrl = await getCdpSocket();
          await cdpMouseClick(wsUrl, pos.x, pos.y);
          await delay(800);

          // Find and click the category in panel
          const catResult2 = await evalSafe(CLICK_CATEGORY(category));
          let cp2;
          try { cp2 = JSON.parse(catResult2); } catch { cp2 = null; }
          if (cp2?.error) throw new CommandExecutionError(`Category not found: ${category}`);
        }
      } catch (e) {
        if (e instanceof CommandExecutionError) throw e;
        throw new CommandExecutionError(`Category not found: ${category}`);
      }
    }

    await delay(1500);

    if (!playIdx) {
      const raw = await evalSafe(EXTRACT_PLAYLISTS);
      const playlists = JSON.parse(raw);
      if (playlists.length === 0) {
        return [{ Index: '-', Name: '(该分类暂无歌单)', PlayCount: '' }];
      }
      return playlists.map((p) => ({
        Index: p.index,
        Name: p.name,
        PlayCount: p.playCount,
      }));
    }

    const cardResult = await evalSafe(CLICK_CARD(playIdx));
    let cr;
    try { cr = JSON.parse(cardResult); } catch { cr = null; }
    if (cr?.error) throw new CommandExecutionError(cr.error);

    await delay(2000);

    const playResult = await evalSafe(CLICK_PLAY_ALL);
    let pr;
    try { pr = JSON.parse(playResult); } catch { pr = null; }
    if (pr?.error) throw new CommandExecutionError(pr.error);

    return [{ Action: 'Playing', Playlist: `${category} #${playIdx}` }];
  },
});
