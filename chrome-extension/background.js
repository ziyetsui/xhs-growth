// Background Service Worker
const DEFAULT_API_BASE = 'https://xhs-tool-backend-production.up.railway.app';
const STORAGE_KEYS = {
  backendBaseUrl: 'backend_base_url',
};

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getApiBase() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.backendBaseUrl], (result) => {
      const stored = normalizeBaseUrl(result?.[STORAGE_KEYS.backendBaseUrl]);
      resolve(stored || DEFAULT_API_BASE);
    });
  });
}

function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function updateTab(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => resolve());
  });
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let done = false;

    const finish = (handler, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      handler(value);
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('页面加载超时'));
    }, timeoutMs);

    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo.status !== 'complete') {
        return;
      }

      finish(resolve);
    };

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (tab) => {
      if (!chrome.runtime.lastError && tab?.status === 'complete') {
        finish(resolve);
      }
    });
  });
}

function sendMessageToTab(tabId, message, timeoutMs = 12000, attempts = 8) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let done = false;

    const finish = (handler, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      handler(value);
    };

    const trySend = () => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (done) return;

        if (chrome.runtime.lastError) {
          attempt += 1;
          if (attempt >= attempts) {
            finish(reject, new Error(chrome.runtime.lastError.message));
            return;
          }
          setTimeout(trySend, 400);
          return;
        }

        finish(resolve, response);
      });
    };

    const timeout = setTimeout(() => {
      finish(reject, new Error('提取页面数据超时'));
    }, timeoutMs);

    trySend();
  });
}

async function deepFetchNote(url, fallbackAuthorProfileUrl = '') {
  const tab = await createTab(url);

  try {
    await waitForTabComplete(tab.id);
    const detailResp = await sendMessageToTab(tab.id, { action: 'extractDetailPage' });
    const note = {
      note_content: detailResp?.note?.note_content || '',
      follower_count: detailResp?.note?.follower_count || 0,
      author_profile_url: fallbackAuthorProfileUrl || detailResp?.note?.author_profile_url || '',
      like_count: detailResp?.note?.like_count || 0,
      video_url: detailResp?.note?.video_url || '',
    };

    if ((!note.follower_count || note.follower_count <= 0) && note.author_profile_url) {
      await updateTab(tab.id, note.author_profile_url);
      await waitForTabComplete(tab.id);
      const profileResp = await sendMessageToTab(tab.id, { action: 'extractAuthorProfile' }, 16000, 12);
      note.follower_count = profileResp?.profile?.follower_count || note.follower_count || 0;

      if (!note.follower_count || note.follower_count <= 0) {
        const retryResp = await sendMessageToTab(tab.id, { action: 'extractAuthorProfile' }, 16000, 12);
        note.follower_count = retryResp?.profile?.follower_count || note.follower_count || 0;
      }
    }

    return {
      note_content: note.note_content,
      follower_count: note.follower_count,
      like_count: note.like_count,
      video_url: note.video_url,
    };
  } finally {
    await removeTab(tab.id);
  }
}

// 点击扩展图标时打开侧边栏
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 1. 常规 API 请求转发
  if (msg.action === 'apiRequest') {
    getApiBase()
      .then((apiBase) => fetch(`${apiBase}${msg.path}`, {
        method: msg.method || 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: msg.body ? JSON.stringify(msg.body) : undefined,
      }))
      .then(res => res.json())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // 2. 深度扫描任务：打开一个背景标签页抓取详情
  if (msg.action === 'deepFetchNote') {
    deepFetchNote(msg.url, msg.author_profile_url)
      .then((note) => sendResponse({ success: true, note }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
