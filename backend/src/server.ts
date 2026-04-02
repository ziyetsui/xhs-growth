import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as db from './db';
import * as handlers from './handlers';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ==================== 路由注册 ====================

// 分析任务
app.post('/api/jobs', handlers.createJob);
app.get('/api/jobs', handlers.listJobs);
app.get('/api/jobs/:job_id', handlers.getJob);
app.post('/api/jobs/:job_id/notes', handlers.pushNotes);
app.post('/api/jobs/:job_id/analyze', handlers.startAnalysis);
app.post('/api/jobs/:job_id/retry', handlers.retryJob);

// 飞书记录
app.post('/api/records', handlers.createRecord);
app.get('/api/records/:record_id', handlers.getRecord);
app.post('/api/records/:record_id/retry-sync', handlers.retrySyncRecord);

// 健康检查
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== 启动 ====================

db.initDB();

app.listen(PORT, HOST, () => {
  console.log(`
🚀 小红书爆款分析工具后端已启动
📡 地址: http://${HOST}:${PORT}
📋 接口:
   POST   /api/jobs                    创建任务（含笔记数据）
   GET    /api/jobs                    任务列表
   GET    /api/jobs/:id                查询任务
   POST   /api/jobs/:id/notes          推送笔记数据
   POST   /api/jobs/:id/analyze        触发 AI 分析
   POST   /api/jobs/:id/retry          失败重试
   POST   /api/records                 收集到飞书
   GET    /api/records/:id             查询飞书记录
   POST   /api/records/:id/retry-sync  重试飞书同步
  `);
});
