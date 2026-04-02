// Content Script
const API_BASE = 'http://localhost:3000';

function parseSocialCount(text) {
  if (!text) return 0;
  text = text.replace(/[,\s]/g, '');
  if (text.includes('万') || text.toLowerCase().includes('w')) return Math.round(parseFloat(text) * 10000);
  if (text.toLowerCase().includes('k')) return Math.round(parseFloat(text) * 1000);
  return parseInt(text, 10) || 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getText(el) {
  return el?.innerText?.trim() || '';
}

function findBySelectors(selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStatMapFromText(text) {
  if (!text) return {};

  const labels = ['关注', '粉丝', '获赞与收藏'];
  const pattern = labels.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|');
  const maps = [];

  const numberBeforeLabel = new RegExp(`([0-9][0-9.,]*(?:万|[wWkK])?)\\s*(${pattern})`, 'gi');
  const beforeMap = {};
  let match;
  while ((match = numberBeforeLabel.exec(text)) !== null) {
    const value = parseSocialCount(match[1]);
    if (value > 0 || match[1] === '0') {
      beforeMap[match[2]] = value;
    }
  }
  if (Object.keys(beforeMap).length > 0) {
    maps.push(beforeMap);
  }

  const labelBeforeNumber = new RegExp(`(${pattern})\\s*[:：]?\\s*([0-9][0-9.,]*(?:万|[wWkK])?)`, 'gi');
  const afterMap = {};
  while ((match = labelBeforeNumber.exec(text)) !== null) {
    const value = parseSocialCount(match[2]);
    if (value > 0 || match[2] === '0') {
      afterMap[match[1]] = value;
    }
  }
  if (Object.keys(afterMap).length > 0) {
    maps.push(afterMap);
  }

  return maps.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0] || {};
}

function parseCountFromLabeledText(text, labels) {
  if (!text) return 0;

  const statMap = parseStatMapFromText(text);
  for (const label of labels) {
    if (typeof statMap[label] === 'number' && statMap[label] > 0) {
      return statMap[label];
    }
  }

  for (const label of labels) {
    const patterns = [
      new RegExp(`([0-9.,]+(?:万|[wWkK])?)\\s*${label}`, 'i'),
      new RegExp(`${label}\\s*[:：]?\\s*([0-9.,]+(?:万|[wWkK])?)`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;
      const value = parseSocialCount(match[1]);
      if (value > 0) return value;
    }
  }

  return 0;
}

function findCountNearLabels(labels) {
  const elements = Array.from(document.querySelectorAll('span, div, a, strong, p, li'))
    .filter((el) => {
      const text = getText(el);
      return text && text.length <= 80 && labels.some((label) => text.includes(label));
    });

  for (const el of elements) {
    const candidates = [
      getText(el),
      getText(el.previousElementSibling),
      getText(el.nextElementSibling),
      getText(el.parentElement),
      getText(el.parentElement?.previousElementSibling),
      getText(el.parentElement?.nextElementSibling),
      getText(el.closest('[class*="user"], [class*="author"], [class*="info"], [class*="stat"], header, section, li')),
    ].filter(Boolean);

    for (const text of candidates) {
      const value = parseCountFromLabeledText(text, labels);
      if (value > 0) return value;
    }
  }

  return 0;
}

function parseStandaloneCount(text) {
  if (!text) return 0;
  const match = text.match(/([0-9.,]+(?:万|[wWkK])?)/);
  return match ? parseSocialCount(match[1]) : 0;
}

function findFollowerCountFromExplicitLabel() {
  const labelElements = Array.from(document.querySelectorAll('span, div, p, li, a'))
    .filter((el) => {
      const text = getText(el);
      return text && text.length <= 40 && /粉丝/.test(text);
    });

  for (const labelEl of labelElements) {
    const selfValue = parseCountFromLabeledText(getText(labelEl), ['粉丝']);
    if (selfValue > 0) {
      return selfValue;
    }

    const parentValue = parseCountFromLabeledText(getText(labelEl.parentElement), ['粉丝']);
    if (parentValue > 0) {
      return parentValue;
    }

    const directPrev = parseStandaloneCount(getText(labelEl.previousElementSibling));
    if (directPrev > 0) {
      return directPrev;
    }

    const siblings = labelEl.parentElement ? Array.from(labelEl.parentElement.children) : [];
    const index = siblings.indexOf(labelEl);
    for (let i = index - 1; i >= 0; i -= 1) {
      const value = parseStandaloneCount(getText(siblings[i]));
      if (value > 0) {
        return value;
      }
    }
  }

  return 0;
}

function findFollowerCountFromDom() {
  const explicitLabelCount = findFollowerCountFromExplicitLabel();
  if (explicitLabelCount > 0) {
    return explicitLabelCount;
  }

  const labeledCount = findCountNearLabels(['粉丝']);
  if (labeledCount > 0) {
    return labeledCount;
  }

  return 0;
}

function findAuthorProfileUrl() {
  const selectors = [
    '[class*="author"] a[href*="/user/profile/"]',
    '[class*="author"] a[href*="/user/"]',
    '[class*="user"] a[href*="/user/profile/"]',
    '[class*="avatar"] a[href*="/user/profile/"]',
    'a[href*="/user/profile/"]',
    'a[href*="/user/"]',
  ];

  for (const selector of selectors) {
    const anchors = Array.from(document.querySelectorAll(selector));
    for (const anchor of anchors) {
      if (anchor.closest('header, nav, footer, [role="navigation"]')) {
        continue;
      }

      const href = anchor.getAttribute('href') || '';
      if (!href) continue;
      if (href.includes('/user/profile/') || href.includes('/user/') || href.includes('/profile/')) {
        return href.startsWith('http') ? href : new URL(href, location.origin).toString();
      }
    }
  }

  return '';
}

// ==================== 1. 列表页抓取 ====================
function getSearchNoteCards() {
  const cards = new Set(
    Array.from(document.querySelectorAll('section.note-item, .note-item, .feeds-container section, [class*="note-item"]')),
  );

  const noteLinks = Array.from(document.querySelectorAll('a[href*="/explore/"]'));
  for (const link of noteLinks) {
    const card = link.closest('section, article, li, div');
    if (card) {
      cards.add(card);
    }
  }

  return Array.from(cards);
}

function extractNoteIdFromHref(href) {
  if (!href) return '';

  try {
    const url = href.startsWith('http') ? new URL(href) : new URL(href, location.origin);
    const matched = url.pathname.match(/\/explore\/([^/?#]+)/i);
    return matched?.[1] || '';
  } catch (e) {
    const matched = href.match(/\/explore\/([^/?#]+)/i);
    return matched?.[1] || '';
  }
}

function upsertNote(map, note) {
  if (!note.note_id) return;

  const existing = map.get(note.note_id);
  if (!existing) {
    map.set(note.note_id, note);
    return;
  }

  map.set(note.note_id, {
    ...existing,
    ...note,
    title: note.title || existing.title,
    author: note.author || existing.author,
    cover_url: note.cover_url || existing.cover_url,
    note_url: note.note_url || existing.note_url,
    author_profile_url: note.author_profile_url || existing.author_profile_url,
    like_count: note.like_count || existing.like_count || 0,
  });
}

function collectVisibleNotes(noteMap) {
  const noteCards = getSearchNoteCards();
  noteCards.forEach(card => {
    try {
      const imgEl = card.querySelector('img.cover, .cover img, .note-img img, img');
      const cover_url = imgEl ? (imgEl.src || imgEl.getAttribute('data-src')) : '';
      const titleEl = card.querySelector('.title, .note-title, a.title span');
      const title = titleEl ? titleEl.innerText.trim() : '';
      const linkEl = card.querySelector('a[href*="/explore/"]');
      const href = linkEl ? linkEl.getAttribute('href') : '';
      const note_id = extractNoteIdFromHref(href);
      const note_url = href ? (href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}`) : '';
      const likeEl = card.querySelector('.count, .like-count');
      const like_count = likeEl ? parseSocialCount(likeEl.innerText.trim()) : 0;
      const authorEl = card.querySelector('.author, .name, .username');
      const author = authorEl ? authorEl.innerText.trim() : '未知';
      const authorLinkEl = card.querySelector('a[href*="/user/profile/"], a[href*="/user/"], .author a[href]');
      const author_profile_url = authorLinkEl
        ? new URL(authorLinkEl.getAttribute('href'), location.origin).toString()
        : '';
      if (note_id) {
        upsertNote(noteMap, {
          note_id,
          title,
          author,
          cover_url,
          like_count,
          follower_count: 0,
          note_content: '',
          note_url,
          author_profile_url,
        });
      }
    } catch (e) {}
  });
}

function getScrollableElement() {
  const candidates = [
    document.scrollingElement,
    ...Array.from(document.querySelectorAll('main, section, div')),
  ].filter(Boolean);

  let best = document.scrollingElement || document.documentElement;
  let bestScore = 0;

  for (const el of candidates) {
    const scrollHeight = el.scrollHeight || 0;
    const clientHeight = el.clientHeight || window.innerHeight || 0;
    const style = el === document.scrollingElement ? null : getComputedStyle(el);
    const overflowY = style?.overflowY || '';
    const isScrollable = el === document.scrollingElement || ['auto', 'scroll', 'overlay'].includes(overflowY);
    const score = scrollHeight - clientHeight;

    if (isScrollable && score > bestScore + 200) {
      best = el;
      bestScore = score;
    }
  }

  return best;
}

function getScrollMetrics(target) {
  if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
    const root = document.scrollingElement || document.documentElement;
    return {
      top: root.scrollTop,
      height: root.scrollHeight,
      client: root.clientHeight,
    };
  }

  return {
    top: target.scrollTop,
    height: target.scrollHeight,
    client: target.clientHeight,
  };
}

function triggerScroll(target) {
  window.dispatchEvent(new Event('scroll'));
  document.dispatchEvent(new Event('scroll'));

  if (target && target !== document.scrollingElement && target !== document.documentElement && target !== document.body) {
    target.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
}

function setScrollTop(target, top) {
  if (target === document.scrollingElement || target === document.documentElement || target === document.body) {
    window.scrollTo(0, top);
    triggerScroll(target);
    return;
  }

  target.scrollTop = top;
  triggerScroll(target);
}

function getLastExploreLink() {
  const links = Array.from(document.querySelectorAll('a[href*="/explore/"]'));
  return links[links.length - 1] || null;
}

async function advanceSearchPage(scrollTarget) {
  const beforeMetrics = getScrollMetrics(scrollTarget);
  const lastLink = getLastExploreLink();

  if (lastLink) {
    lastLink.scrollIntoView({ block: 'end' });
    triggerScroll(scrollTarget);
    await sleep(500);
  }

  const windowStep = Math.max(Math.floor(window.innerHeight * 0.9), 700);
  window.scrollBy(0, windowStep);
  triggerScroll(scrollTarget);

  if (scrollTarget && scrollTarget !== document.scrollingElement && scrollTarget !== document.documentElement && scrollTarget !== document.body) {
    scrollTarget.scrollTop += Math.max(Math.floor(scrollTarget.clientHeight * 0.9), 700);
    triggerScroll(scrollTarget);
  }

  await sleep(900);

  const afterMetrics = getScrollMetrics(scrollTarget);
  return {
    moved: afterMetrics.top !== beforeMetrics.top || afterMetrics.height !== beforeMetrics.height,
    metrics: afterMetrics,
  };
}

async function extractNotesFromSearchPage() {
  const noteMap = new Map();
  const scrollTarget = getScrollableElement();
  const originalTop = getScrollMetrics(scrollTarget).top;
  let stableRounds = 0;
  let previousCount = 0;

  setScrollTop(scrollTarget, 0);
  await sleep(800);

  for (let step = 0; step < 30; step += 1) {
    collectVisibleNotes(noteMap);

    const metrics = getScrollMetrics(scrollTarget);
    const nearBottom = metrics.top + metrics.client >= metrics.height - 120;

    if (nearBottom && noteMap.size === previousCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
    }

    if (stableRounds >= 3) {
      break;
    }

    previousCount = noteMap.size;
    const result = await advanceSearchPage(scrollTarget);

    if (!result.moved && noteMap.size === previousCount) {
      stableRounds += 1;
    }
  }

  collectVisibleNotes(noteMap);
  setScrollTop(scrollTarget, originalTop);
  return Array.from(noteMap.values());
}

// ==================== 2. 详情页抓取 ====================

// 从 window.__INITIAL_STATE__ 提取笔记详情（精确，不会抓错）
function extractFromInitialState() {
  try {
    const state = window.__INITIAL_STATE__;
    if (!state) return null;

    // 笔记详情页数据
    const noteState = state.note || {};
    const noteMap = noteState.noteDetailMap || noteState.noteData || {};
    const firstKey = Object.keys(noteMap)[0];
    const noteData = firstKey ? (noteMap[firstKey]?.note || noteMap[firstKey]) : null;

    if (!noteData) return null;

    // 提取笔记正文
    const note_content = noteData.desc || noteData.title || '';

    // 提取作者信息
    const user = noteData.user || {};
    const author_profile_url = user.userId
      ? `https://www.xiaohongshu.com/user/profile/${user.userId}`
      : '';

    // 提取粉丝数 - 可能在 user.fansCount 或 user.fans 中
    let follower_count = 0;
    if (typeof user.fansCount === 'number') {
      follower_count = user.fansCount;
    } else if (typeof user.fans === 'number') {
      follower_count = user.fans;
    } else if (typeof user.fansCount === 'string') {
      follower_count = parseSocialCount(user.fansCount);
    } else if (typeof user.fans === 'string') {
      follower_count = parseSocialCount(user.fans);
    }

    // 遍历 interactions 数组查找粉丝数
    if (follower_count <= 0 && Array.isArray(user.interactions)) {
      const fansItem = user.interactions.find(i => i.type === 'fans' || i.name === '粉丝');
      if (fansItem) {
        follower_count = parseSocialCount(String(fansItem.count));
      }
    }

    return { note_content, follower_count, author_profile_url };
  } catch (e) {
    return null;
  }
}

// 从 window.__INITIAL_STATE__ 提取用户主页粉丝数
function extractFollowerFromProfileState() {
  try {
    const state = window.__INITIAL_STATE__;
    if (!state) return 0;

    const userState = state.user || {};
    const userInfo = userState.userPageData || userState.userInfo || userState;

    // 直接字段
    if (typeof userInfo.fansCount === 'number' && userInfo.fansCount > 0) return userInfo.fansCount;
    if (typeof userInfo.fans === 'number' && userInfo.fans > 0) return userInfo.fans;
    if (typeof userInfo.fansCount === 'string') {
      const v = parseSocialCount(userInfo.fansCount);
      if (v > 0) return v;
    }

    // interactions 数组
    if (Array.isArray(userInfo.interactions)) {
      const fansItem = userInfo.interactions.find(i => i.type === 'fans' || i.name === '粉丝');
      if (fansItem) {
        const v = parseSocialCount(String(fansItem.count));
        if (v > 0) return v;
      }
    }

    // 递归搜索 state 中的 user 对象
    const basicInfo = userInfo.basicInfo || userInfo;
    if (typeof basicInfo.fansCount === 'number' && basicInfo.fansCount > 0) return basicInfo.fansCount;
    if (typeof basicInfo.fans === 'number' && basicInfo.fans > 0) return basicInfo.fans;

    return 0;
  } catch (e) {
    return 0;
  }
}

function extractNoteFromDetailPage() {
  try {
    // 优先从 __INITIAL_STATE__ 提取（精确）
    const stateData = extractFromInitialState();
    if (stateData && (stateData.note_content || stateData.follower_count > 0)) {
      // 如果 state 中没拿到正文，DOM 补充
      if (!stateData.note_content) {
        stateData.note_content = getText(findBySelectors([
          '.desc', '.note-text', '.note-content',
          '[class*="note-content"]', '[class*="content"]', '[class*="desc"]',
        ]));
      }
      if (!stateData.author_profile_url) {
        stateData.author_profile_url = findAuthorProfileUrl();
      }
      return stateData;
    }

    // 后备：DOM 解析
    const content = getText(findBySelectors([
      '.desc', '.note-text', '.note-content',
      '[class*="note-content"]', '[class*="content"]', '[class*="desc"]',
    ]));
    const follower_count = findFollowerCountFromDom();
    const author_profile_url = findAuthorProfileUrl();
    return { note_content: content, follower_count, author_profile_url };
  } catch (e) { return null; }
}

function extractAuthorFromProfilePage() {
  try {
    // 优先从 __INITIAL_STATE__ 提取
    const stateCount = extractFollowerFromProfileState();
    if (stateCount > 0) {
      return { follower_count: stateCount };
    }
    // 后备：DOM 解析
    return {
      follower_count: findFollowerCountFromDom(),
    };
  } catch (e) {
    return { follower_count: 0 };
  }
}

async function waitForDetailData(timeoutMs = 12000) {
  const start = Date.now();
  let best = extractNoteFromDetailPage() || { note_content: '', follower_count: 0, author_profile_url: '' };

  while (Date.now() - start < timeoutMs) {
    if (best.note_content && (best.follower_count > 0 || best.author_profile_url)) {
      return best;
    }

    await sleep(500);

    const current = extractNoteFromDetailPage();
    if (!current) continue;

    if (current.note_content.length > best.note_content.length) {
      best.note_content = current.note_content;
    }
    if (current.follower_count > best.follower_count) {
      best.follower_count = current.follower_count;
    }
    if (current.author_profile_url) {
      best.author_profile_url = current.author_profile_url;
    }
  }

  return best;
}

async function waitForProfileData(timeoutMs = 12000) {
  const start = Date.now();
  let best = extractAuthorFromProfilePage();
  let nudged = false;

  while (Date.now() - start < timeoutMs) {
    if (best.follower_count > 0) {
      return best;
    }

    if (!nudged) {
      window.scrollTo(0, 0);
      await sleep(200);
      window.scrollBy(0, 160);
      nudged = true;
    }

    await sleep(500);
    const current = extractAuthorFromProfilePage();
    if (current.follower_count > best.follower_count) {
      best = current;
    }
  }

  return best;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'extractNotes') {
    extractNotesFromSearchPage().then((notes) => {
      sendResponse({ notes });
    }).catch((error) => {
      sendResponse({ notes: [], error: error?.message || '抓取失败' });
    });
    return true;
  }

  if (msg.action === 'extractDetailPage') {
    waitForDetailData().then((note) => sendResponse({ note })).catch(() => {
      sendResponse({ note: { note_content: '', follower_count: 0, author_profile_url: '' } });
    });
    return true;
  }

  if (msg.action === 'extractAuthorProfile') {
    waitForProfileData().then((profile) => sendResponse({ profile })).catch(() => {
      sendResponse({ profile: { follower_count: 0 } });
    });
    return true;
  }
});
