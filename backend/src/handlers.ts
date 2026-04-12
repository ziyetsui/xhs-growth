import { Request, Response } from 'express';
import * as db from './db';
import * as aiAdapter from './adapters/ai';
import * as feishuAdapter from './adapters/feishu';
import { AIRequestConfig, XhsNote } from './types';

// ==================== AnalysisJob Handlers ====================

// POST /api/jobs — 创建分析任务，接收插件推送的笔记列表
export async function createJob(req: Request, res: Response) {
  try {
    const { keyword, notes } = req.body;

    if (!keyword) {
      return res.status(400).json({ error: { code: 'MISSING_KEYWORD', message: '缺少关键词', retryable: false } });
    }

    const job = db.createJob(keyword);

    if (notes && Array.isArray(notes) && notes.length > 0) {
      // 插件直接推送了笔记数据，直接计算潜力值
      const scored: XhsNote[] = notes
        .map((n: any) => ({
          ...n,
          potential_score: n.like_count / (n.follower_count || 1),
        }))
        .sort((a: XhsNote, b: XhsNote) => b.potential_score - a.potential_score);

      db.updateJob(job.id, {
        status: 'SCORED',
        notes_json: JSON.stringify(scored),
      });

      return res.json({
        job_id: job.id,
        status: 'SCORED',
        keyword,
        notes_count: scored.length,
        notes: scored,
      });
    }

    // 没有笔记数据，进入 FETCHING（等待插件推送）
    db.updateJob(job.id, { status: 'FETCHING' });

    res.json({
      job_id: job.id,
      status: 'FETCHING',
      keyword,
      created_at: job.created_at,
    });
  } catch (err: any) {
    console.error('createJob error:', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// POST /api/jobs/:job_id/notes — 插件推送笔记数据到已有任务
export async function pushNotes(req: Request, res: Response) {
  try {
    const job = db.getJob(req.params.job_id);
    if (!job) {
      return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job 不存在', retryable: false } });
    }

    const { notes } = req.body;
    if (!notes || !Array.isArray(notes)) {
      return res.status(400).json({ error: { code: 'INVALID_NOTES', message: '笔记数据格式错误', retryable: false } });
    }

    const scored: XhsNote[] = notes
      .map((n: any) => ({
        ...n,
        potential_score: n.like_count / (n.follower_count || 1),
      }))
      .sort((a: XhsNote, b: XhsNote) => b.potential_score - a.potential_score);

    db.updateJob(job.id, {
      status: 'SCORED',
      notes_json: JSON.stringify(scored),
    });

    res.json({
      job_id: job.id,
      status: 'SCORED',
      notes_count: scored.length,
      notes: scored,
    });
  } catch (err: any) {
    console.error('pushNotes error:', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// GET /api/jobs/:job_id — 查询任务状态
export async function getJob(req: Request, res: Response) {
  try {
    const job = db.getJob(req.params.job_id);
    if (!job) {
      return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job 不存在', retryable: false } });
    }

    const result: any = { ...job };
    if (job.notes_json) result.notes = JSON.parse(job.notes_json);
    if (job.analysis_json) result.analysis = JSON.parse(job.analysis_json);

    res.json(result);
  } catch (err: any) {
    console.error('getJob error:', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// GET /api/jobs — 查询任务列表
export async function listJobs(req: Request, res: Response) {
  try {
    const jobs = db.listJobs();
    res.json({ jobs });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// POST /api/jobs/:job_id/analyze — 触发 AI 分析
export async function startAnalysis(req: Request, res: Response) {
  try {
    const job = db.getJob(req.params.job_id);
    if (!job) {
      return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job 不存在', retryable: false } });
    }

    // 非法迁移拦截
    if (job.status !== 'SCORED' && job.status !== 'DONE') {
      return res.status(409).json({
        error: { code: 'INVALID_TRANSITION', message: `当前状态 ${job.status} 不允许触发分析`, retryable: false },
      });
    }

    const { mode, note_id, api_key } = req.body;
    if (!mode || !['single', 'batch_top5'].includes(mode)) {
      return res.status(400).json({ error: { code: 'INVALID_MODE', message: 'mode 必须是 single 或 batch_top5', retryable: false } });
    }
    if (mode === 'single' && !note_id) {
      return res.status(400).json({ error: { code: 'MISSING_NOTE_ID', message: '单篇分析需要 note_id', retryable: false } });
    }
    if (!aiAdapter.hasConfiguredApiKey({ api_key })) {
      return res.status(400).json({
        error: { code: 'MISSING_API_KEY', message: '请先在插件里保存你自己的 AI API Key', retryable: false },
      });
    }

    const aiConfig: AIRequestConfig = { api_key };

    db.updateJob(job.id, {
      status: 'ANALYZING',
      mode,
      target_note_id: note_id ?? null,
      error_code: null,
      error_stage: null,
      error_message: null,
    });

    // 先返回，异步分析
    res.json({ job_id: job.id, status: 'ANALYZING' });

    // 异步执行 AI 分析
    const notes: XhsNote[] = JSON.parse(job.notes_json!);
    aiAdapter.analyze(mode, notes, note_id, aiConfig)
      .then(analysis => {
        db.updateJob(job.id, {
          status: 'DONE',
          analysis_json: JSON.stringify(analysis),
          error_code: null,
          error_stage: null,
          error_message: null,
        });
        console.log(`✅ Job ${job.id} 分析完成`);
      })
      .catch(err => {
        console.error(`❌ Job ${job.id} 分析失败:`, err.message);
        db.updateJob(job.id, {
          status: 'FAILED',
          error_code: 'ANALYSIS_FAILED',
          error_stage: 'ANALYZING',
          error_message: err.message || 'AI 分析失败',
        });
      });
  } catch (err: any) {
    console.error('startAnalysis error:', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// POST /api/jobs/:job_id/retry — 失败重试
export async function retryJob(req: Request, res: Response) {
  try {
    const job = db.getJob(req.params.job_id);
    if (!job) {
      return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job 不存在', retryable: false } });
    }

    if (job.status !== 'FAILED') {
      return res.status(409).json({
        error: { code: 'INVALID_TRANSITION', message: '只有 FAILED 状态才能重试', retryable: false },
      });
    }

    if (job.error_stage === 'ANALYZING' && job.notes_json) {
      // 重试分析
      db.updateJob(job.id, { status: 'SCORED', error_code: null, error_stage: null, error_message: null });
      res.json({ job_id: job.id, status: 'SCORED', message: '已重置到 SCORED，请重新触发分析' });
    } else {
      // 重试搜索
      db.updateJob(job.id, { status: 'FETCHING', error_code: null, error_stage: null, error_message: null });
      res.json({ job_id: job.id, status: 'FETCHING', message: '已重置到 FETCHING，等待插件重新推送数据' });
    }
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// ==================== FeishuRecord Handlers ====================

// POST /api/records — 收集到飞书
export async function createRecord(req: Request, res: Response) {
  try {
    const payload = req.body;
    if (!payload.note_url || !payload.title) {
      return res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: '缺少必填字段', retryable: false } });
    }

    const record = db.createRecord(payload);

    // 先返回，异步写入飞书
    res.json({ record_id: record.id, status: 'PENDING' });

    // 异步写入飞书
    feishuAdapter.writeRecord({
      note_url: record.note_url,
      title: record.title,
      author: record.author,
      cover_url: record.cover_url,
      like_count: record.like_count,
      follower_count: record.follower_count,
      potential_score: record.potential_score,
      note_content: record.note_content,
      analysis_result: record.analysis_result,
      app_token: record.feishu_app_token || undefined,
      table_id: record.feishu_table_id || undefined,
    })
      .then(feishu_record_url => {
        db.updateRecord(record.id, { status: 'SYNCED', feishu_record_url });
        console.log(`✅ 飞书记录 ${record.id} 写入成功`);
      })
      .catch(err => {
        console.error(`❌ 飞书记录 ${record.id} 写入失败:`, err.message);
        db.updateRecord(record.id, { status: 'SYNC_FAILED', platform_error_code: err.message });
      });
  } catch (err: any) {
    console.error('createRecord error:', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// GET /api/records/:record_id — 查询记录状态
export async function getRecord(req: Request, res: Response) {
  try {
    const record = db.getRecord(req.params.record_id);
    if (!record) {
      return res.status(404).json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record 不存在', retryable: false } });
    }
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}

// POST /api/records/:record_id/retry-sync — 重新同步到飞书
export async function retrySyncRecord(req: Request, res: Response) {
  try {
    const record = db.getRecord(req.params.record_id);
    if (!record) {
      return res.status(404).json({ error: { code: 'RECORD_NOT_FOUND', message: 'Record 不存在', retryable: false } });
    }
    if (record.status !== 'SYNC_FAILED') {
      return res.status(409).json({
        error: { code: 'INVALID_TRANSITION', message: '只有 SYNC_FAILED 才能重试同步', retryable: false },
      });
    }

    db.updateRecord(record.id, { status: 'PENDING' });
    res.json({ record_id: record.id, status: 'PENDING' });

    // 异步重试写入
    feishuAdapter.writeRecord({
      note_url: record.note_url,
      title: record.title,
      author: record.author,
      cover_url: record.cover_url,
      like_count: record.like_count,
      follower_count: record.follower_count,
      potential_score: record.potential_score,
      note_content: record.note_content,
      analysis_result: record.analysis_result,
      app_token: record.feishu_app_token || undefined,
      table_id: record.feishu_table_id || undefined,
    })
      .then(feishu_record_url => {
        db.updateRecord(record.id, { status: 'SYNCED', feishu_record_url, platform_error_code: null });
      })
      .catch(err => {
        db.updateRecord(record.id, { status: 'SYNC_FAILED', platform_error_code: err.message });
      });
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message, retryable: true } });
  }
}
