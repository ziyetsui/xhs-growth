// ============================================================
// 小红书爆款分析助手 — Popup 逻辑升级
// ============================================================

const DEFAULT_API_BASE = 'https://xhs-tool-backend-production.up.railway.app';
const STORAGE_KEYS = {
  backendBaseUrl: 'backend_base_url',
  aiApiKey: 'deepseek_api_key',
};

let currentJobId = null;
let currentNotes = [];
let currentAnalysis = null;
let backendBaseUrl = DEFAULT_API_BASE;
let savedApiKey = '';
let analysisInProgress = false;

const MAX_SCAN_ROUNDS = 10;

const $ = (sel) => document.querySelector(sel);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) {
    return `${key.slice(0, 3)}***`;
  }
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function getApiKeyStatusColor(type = 'default') {
  if (type === 'success') return '#10B981';
  if (type === 'error') return '#EF4444';
  return '#8E8EA0';
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function formatBackendUrl(url) {
  return normalizeBaseUrl(url) || DEFAULT_API_BASE;
}

function setBackendUrlStatus(text, type = 'default') {
  const status = $('#backendUrlStatus');
  if (!status) return;
  status.textContent = text;
  status.style.color = getApiKeyStatusColor(type);
}

function updateBackendUrlLabel() {
  const current = formatBackendUrl(backendBaseUrl);
  const footer = $('#backendUrlText');
  const input = $('#backendUrlInput');

  if (footer) {
    footer.textContent = current;
  }

  if (input) {
    input.value = current;
  }
}

function setApiKeyStatus(text, type = 'default') {
  const status = $('#apiKeyStatus');
  if (!status) return;
  status.textContent = text;
  status.style.color = getApiKeyStatusColor(type);
}

function setStatus(text, type = 'loading') {
  const bar = $('#statusBar');
  if (!bar) return;
  bar.className = `status-bar ${type}`;
  $('#statusText').textContent = text;
  bar.classList.remove('hidden');
}

function decorateNote(note) {
  return {
    ...note,
    sync_status: note.follower_count > 0 ? 'done' : 'scanning',
    sync_error: null,
    scan_attempts: 0,
  };
}

function hasMissingFollowerCounts() {
  return currentNotes.some((note) => !note.follower_count || note.follower_count <= 0);
}

function updateActionButtons() {
  const collectAll = $('#btnCollectAll');
  const analyzeBatch = $('#btnAnalyzeBatch');
  const blockedByFollowers = hasMissingFollowerCounts();
  const blockedByApiKey = !savedApiKey;

  if (collectAll) {
    collectAll.disabled = blockedByFollowers || !currentNotes.length;
    collectAll.title = blockedByFollowers ? '请先等待所有笔记粉丝数补齐' : '';
  }

  if (analyzeBatch) {
    analyzeBatch.disabled = !currentJobId || blockedByFollowers || blockedByApiKey || analysisInProgress;

    if (!currentJobId) {
      analyzeBatch.title = '请先抓取笔记';
    } else if (blockedByFollowers) {
      analyzeBatch.title = '请先等待所有笔记粉丝数补齐';
    } else if (blockedByApiKey) {
      analyzeBatch.title = '请先保存你自己的 AI API Key';
    } else if (analysisInProgress) {
      analyzeBatch.title = 'AI 正在分析中';
    } else {
      analyzeBatch.title = '';
    }
  }
}

function getStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function setStorage(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function removeStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function loadApiKeySettings() {
  const result = await getStorage([STORAGE_KEYS.aiApiKey, STORAGE_KEYS.backendBaseUrl]);
  backendBaseUrl = formatBackendUrl(result?.[STORAGE_KEYS.backendBaseUrl] || DEFAULT_API_BASE);
  const key = String(result?.[STORAGE_KEYS.aiApiKey] || '').trim();
  savedApiKey = key;

  updateBackendUrlLabel();
  setBackendUrlStatus(`当前后端地址：${backendBaseUrl}`, 'success');

  const input = $('#apiKeyInput');
  if (input) {
    input.value = key;
  }

  if (key) {
    setApiKeyStatus(`已保存个人 API Key：${maskKey(key)}`, 'success');
  } else {
    setApiKeyStatus('AI 分析会使用每个用户自己保存的 API Key；不会写入飞书，也不会存入后端数据库。');
  }

  updateActionButtons();
}

async function saveBackendUrl() {
  const input = $('#backendUrlInput');
  const raw = normalizeBaseUrl(input?.value || '');
  const nextUrl = raw || DEFAULT_API_BASE;

  let parsed;
  try {
    parsed = new URL(nextUrl);
  } catch (_error) {
    setBackendUrlStatus('后端地址格式不正确，请输入完整的 http(s) 地址。', 'error');
    return;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    setBackendUrlStatus('后端地址只支持 http 或 https。', 'error');
    return;
  }

  await setStorage({ [STORAGE_KEYS.backendBaseUrl]: nextUrl });
  backendBaseUrl = nextUrl;
  updateBackendUrlLabel();
  const healthy = await refreshBackendHealth();
  setBackendUrlStatus(`已保存后端地址：${backendBaseUrl}`, healthy ? 'success' : 'error');
  setStatus(healthy ? '✅ 已保存后端地址，后端连接正常' : '⚠️ 已保存后端地址，但当前连不上后端', healthy ? 'success' : 'error');
}

async function resetBackendUrl() {
  await removeStorage([STORAGE_KEYS.backendBaseUrl]);
  backendBaseUrl = DEFAULT_API_BASE;
  updateBackendUrlLabel();
  const healthy = await refreshBackendHealth();
  setBackendUrlStatus(`当前后端地址：${backendBaseUrl}`, healthy ? 'success' : 'error');
  setStatus(healthy ? '✅ 已恢复默认后端地址' : '⚠️ 已恢复默认后端地址，但当前连不上后端', healthy ? 'success' : 'error');
}

async function saveApiKey() {
  const input = $('#apiKeyInput');
  const key = input?.value?.trim() || '';

  if (!key) {
    setApiKeyStatus('请输入有效的 API Key 后再保存。', 'error');
    return;
  }

  await setStorage({ [STORAGE_KEYS.aiApiKey]: key });
  savedApiKey = key;
  setApiKeyStatus(`已保存个人 API Key：${maskKey(key)}`, 'success');
  setStatus('✅ 已保存你的个人 AI API Key', 'success');
  updateActionButtons();
}

async function clearApiKey() {
  await removeStorage([STORAGE_KEYS.aiApiKey]);
  savedApiKey = '';

  const input = $('#apiKeyInput');
  if (input) {
    input.value = '';
    input.type = 'password';
  }

  const toggleBtn = $('#btnToggleApiKey');
  if (toggleBtn) {
    toggleBtn.textContent = '显示';
  }

  setApiKeyStatus('已清空本地保存的 API Key。', 'success');
  setStatus('✅ 已清空本地 API Key', 'success');
  updateActionButtons();
}

function toggleApiKeyVisibility() {
  const input = $('#apiKeyInput');
  const button = $('#btnToggleApiKey');
  if (!input || !button) return;

  const shouldShow = input.type === 'password';
  input.type = shouldShow ? 'text' : 'password';
  button.textContent = shouldShow ? '隐藏' : '显示';
}

async function apiCall(path, method = 'GET', body = null) {
  const res = await fetch(`${backendBaseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};

  if (!res.ok || data?.error) {
    throw new Error(data?.error?.message || data?.message || `请求失败 (${res.status})`);
  }

  return data;
}

async function refreshBackendHealth() {
  try {
    await apiCall('/api/health');
    $('#statusDot').style.background = '#10B981';
    return true;
  } catch (_error) {
    $('#statusDot').style.background = '#EF4444';
    return false;
  }
}

async function waitForAnalysis(jobId, timeoutMs = 180000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const job = await apiCall(`/api/jobs/${jobId}`);

    if (job.status === 'DONE' && job.analysis) {
      return job;
    }

    if (job.status === 'FAILED') {
      throw new Error(job.error_message || 'AI 分析失败，请检查 API Key 是否正确');
    }

    await sleep(2000);
  }

  throw new Error('AI 分析超时，请稍后重试');
}

function formatParagraph(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

function renderBatchAnalysis(analysis) {
  const container = $('#analysisContent');
  if (!container) return;

  container.innerHTML = `
    <div class="analysis-panel">
      <h3>🔬 前 5 篇笔记共性分析</h3>

      <div class="analysis-section">
        <label>标题公式</label>
        <p>${formatParagraph(analysis.title_formula || '暂无')}</p>
      </div>

      <div class="analysis-section">
        <label>内容模板</label>
        <p>${formatParagraph(analysis.content_template || '暂无')}</p>
      </div>

      <div class="analysis-section">
        <label>视觉风格</label>
        <p>${formatParagraph(analysis.visual_style || '暂无')}</p>
      </div>

      <div class="analysis-section">
        <label>复制指南</label>
        <p>${formatParagraph(analysis.replication_guide || '暂无')}</p>
      </div>
    </div>
  `;

  $('#stepAnalysis').classList.remove('hidden');
}

async function runBatchAnalysis() {
  if (!currentJobId) {
    setStatus('请先抓取笔记后再进行 AI 分析', 'error');
    return;
  }

  if (hasMissingFollowerCounts()) {
    setStatus('请先等待所有笔记粉丝数补齐后再分析', 'error');
    return;
  }

  if (!savedApiKey) {
    setStatus('请先保存你自己的 AI API Key', 'error');
    setApiKeyStatus('还没有保存 API Key，请先在上方输入并保存。', 'error');
    return;
  }

  analysisInProgress = true;
  updateActionButtons();
  setStatus('🤖 正在用你的 API Key 分析前 5 篇共性，请稍等...', 'loading');

  try {
    await apiCall(`/api/jobs/${currentJobId}/analyze`, 'POST', {
      mode: 'batch_top5',
      api_key: savedApiKey,
    });

    const job = await waitForAnalysis(currentJobId);
    currentAnalysis = job.analysis || null;
    renderBatchAnalysis(currentAnalysis || {});
    setStatus('✅ AI 分析完成，已展示结果', 'success');
  } catch (error) {
    setStatus(`AI 分析失败：${error?.message || '未知错误'}`, 'error');
  } finally {
    analysisInProgress = false;
    updateActionButtons();
  }
}

async function startExtract() {
  try {
    setStatus('正在滚动加载并抓取页面笔记，请稍等...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'extractNotes' });
    if (resp?.error) {
      setStatus(resp.error, 'error');
      return;
    }
    if (!resp || !resp.notes || resp.notes.length === 0) {
      setStatus('未找到笔记，请确保已打开搜索页', 'error');
      return;
    }

    const keyword = new URL(tab.url).searchParams.get('keyword') || '搜索结果';
    const job = await apiCall('/api/jobs', 'POST', { keyword, notes: resp.notes });

    currentJobId = job.job_id;
    currentNotes = (job.notes || []).map(decorateNote);
    currentAnalysis = null;
    $('#stepAnalysis').classList.add('hidden');

    renderNotes();
    setStatus(`已抓取 ${currentNotes.length} 篇，开始后台同步真实粉丝数...`, 'loading');
    await startDeepScan();
  } catch (error) {
    setStatus(`抓取失败：${error?.message || '未知错误'}`, 'error');
  }
}

async function startDeepScan() {
  for (let round = 1; round <= MAX_SCAN_ROUNDS; round += 1) {
    const targets = currentNotes.filter((note) => !note.follower_count || note.follower_count <= 0);
    if (!targets.length) {
      setStatus(`✨ 所有 ${currentNotes.length} 篇笔记都已补齐粉丝数`, 'success');
      updateActionButtons();
      return;
    }

    const label = round === 1
      ? `启动全量深度扫描 第${round}轮`
      : `重试缺失粉丝数 第${round}轮`;
    await scanNotes(targets, label);
  }

  const remaining = currentNotes.filter((note) => !note.follower_count || note.follower_count <= 0).length;
  if (remaining > 0) {
    setStatus(`仍有 ${remaining} 篇未补齐粉丝数，已暂停后续操作，请继续排查`, 'error');
  }

  updateActionButtons();
}

async function scanNotes(notesToScan, label) {
  const limit = notesToScan.length;
  if (!limit) return;

  const CONCURRENCY = 2;
  let finished = 0;

  setStatus(`🚀 ${label}... (0/${limit})`);

  for (let i = 0; i < limit; i += CONCURRENCY) {
    const batch = notesToScan.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (note) => {
      const noteIndex = currentNotes.findIndex((item) => item.note_id === note.note_id);
      if (noteIndex >= 0) {
        currentNotes[noteIndex].sync_status = 'scanning';
        currentNotes[noteIndex].sync_error = null;
        currentNotes[noteIndex].scan_attempts = (currentNotes[noteIndex].scan_attempts || 0) + 1;
        renderNotes();
      }

      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'deepFetchNote',
          url: note.note_url,
          note_id: note.note_id,
          author_profile_url: note.author_profile_url || '',
        });

        const currentIndex = currentNotes.findIndex((item) => item.note_id === note.note_id);
        if (currentIndex >= 0 && resp && resp.success) {
          currentNotes[currentIndex].follower_count = resp.note.follower_count || 0;
          currentNotes[currentIndex].like_count = resp.note.like_count || currentNotes[currentIndex].like_count || 0;
          currentNotes[currentIndex].note_content = resp.note.note_content || '';
          currentNotes[currentIndex].video_url = resp.note.video_url || '';
          currentNotes[currentIndex].potential_score = resp.note.follower_count > 0
            ? currentNotes[currentIndex].like_count / resp.note.follower_count
            : 0;
          currentNotes[currentIndex].sync_status = resp.note.follower_count > 0 ? 'done' : 'empty';
          currentNotes[currentIndex].sync_error = resp.note.follower_count > 0
            ? null
            : `第 ${currentNotes[currentIndex].scan_attempts} 次未抓到粉丝数`;
          renderNotes();
        } else if (currentIndex >= 0) {
          currentNotes[currentIndex].potential_score = 0;
          currentNotes[currentIndex].sync_status = 'empty';
          currentNotes[currentIndex].sync_error = `第 ${currentNotes[currentIndex].scan_attempts} 次失败：${resp?.error || '抓取失败'}`;
          renderNotes();
        }
      } catch (error) {
        const currentIndex = currentNotes.findIndex((item) => item.note_id === note.note_id);
        if (currentIndex >= 0) {
          currentNotes[currentIndex].potential_score = 0;
          currentNotes[currentIndex].sync_status = 'empty';
          currentNotes[currentIndex].sync_error = `第 ${currentNotes[currentIndex].scan_attempts} 次失败：${error?.message || '抓取失败'}`;
          renderNotes();
        }
      }

      finished += 1;
      setStatus(`⚡ ${label} (${finished}/${limit}): ${note.title.substring(0, 8)}...`);
    }));

    currentNotes.sort((a, b) => b.potential_score - a.potential_score);
    renderNotes();
  }

  updateActionButtons();
  setStatus(`✨ ${label}完成，已按真实潜力值重新排序`, 'success');
}

function renderNotes() {
  const list = $('#noteList');
  list.innerHTML = '';
  $('#noteCount').textContent = String(currentNotes.length);
  $('#stepNotes').classList.remove('hidden');
  $('#emptyState').classList.add('hidden');

  currentNotes.forEach((note) => {
    const followerText = note.follower_count > 0
      ? formatCount(note.follower_count)
      : note.sync_status === 'scanning'
        ? '补齐中'
        : note.sync_status === 'empty'
          ? '重试中'
          : '补齐中';

    const scoreText = note.sync_status === 'scanning'
      ? '...'
      : note.potential_score
        ? note.potential_score.toFixed(1)
        : '--';

    const hintText = note.sync_error
      ? `<div class="note-hint" style="font-size:11px;color:#8E8EA0;margin-top:4px;">${escapeHtml(note.sync_error)}</div>`
      : '';

    const card = document.createElement('div');
    card.className = 'note-card';
    card.innerHTML = `
      <img class="note-cover" src="${escapeHtml(note.cover_url)}">
      <div class="note-info">
        <div class="note-title">${escapeHtml(note.title)}</div>
        <div class="note-meta">
          <span>👤 ${escapeHtml(note.author)}</span>
          <span>❤️ ${formatCount(note.like_count)}</span>
          <span>👥 ${followerText}</span>
        </div>
        ${hintText}
      </div>
      <div class="score-badge">${scoreText}</div>
    `;
    list.appendChild(card);
  });

  updateActionButtons();
}

async function collectAllToFeishu() {
  if (!currentNotes.length) return;
  if (hasMissingFollowerCounts()) {
    setStatus('请先等待所有笔记粉丝数补齐后再同步', 'error');
    return;
  }

  // 测试模式：只截取第一条
  const testNotes = currentNotes.slice(0, 1);
  setStatus(`🚀 测试模式：正在同步第 1 篇笔记到飞书...`, 'loading');

  let success = 0;
  for (const note of testNotes) {
    try {
      await apiCall('/api/records', 'POST', {
        job_id: currentJobId,
        note_id: note.note_id,
        note_url: note.note_url,
        title: note.title,
        author: note.author,
        cover_url: note.cover_url,
        like_count: note.like_count,
        follower_count: note.follower_count,
        potential_score: note.potential_score || 0,
        note_content: note.note_content || '(自动采集)',
        video_url: note.video_url || '',
        analysis_result: { message: '批量快速收录' },
      });
      success += 1;
    } catch (_error) {}

    await sleep(1000);
  }

  setStatus(`✅ 同步完成！成功保存 ${success} 篇到飞书`, 'success');
}

function formatCount(num) {
  if (!num) return '0';
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
  return num.toString();
}

$('#btnSaveApiKey').addEventListener('click', saveApiKey);
$('#btnClearApiKey').addEventListener('click', clearApiKey);
$('#btnToggleApiKey').addEventListener('click', toggleApiKeyVisibility);
$('#btnSaveBackendUrl').addEventListener('click', saveBackendUrl);
$('#btnResetBackendUrl').addEventListener('click', resetBackendUrl);
$('#btnExtract').addEventListener('click', startExtract);
$('#btnAnalyzeBatch').addEventListener('click', runBatchAnalysis);
$('#btnCollectAll').addEventListener('click', collectAllToFeishu);
$('#btnCollectFeishu').addEventListener('click', () => {
  setStatus('批量分析结果暂不单独同步，请使用“同步所有到飞书”按钮。', 'error');
});

(async () => {
  try {
    await loadApiKeySettings();
  } catch (error) {
    setApiKeyStatus(`本地读取 API Key 失败：${error?.message || '未知错误'}`, 'error');
  }

  const healthy = await refreshBackendHealth();
  if (!healthy) {
    setStatus('⚠️ 请先点击右上角 [Antigravity] 确保后端运行中', 'error');
  }

  updateActionButtons();
})();
