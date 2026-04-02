// ==================== 状态类型 ====================

export type JobStatus =
  | 'IDLE' | 'FETCHING' | 'SCORED' | 'ANALYZING' | 'DONE' | 'FAILED';

export type AnalysisMode = 'single' | 'batch_top5';

export type RecordStatus =
  | 'PENDING' | 'SYNCED' | 'PUBLISHING' | 'PUBLISHED'
  | 'SYNC_FAILED' | 'PUBLISH_FAILED';

// ==================== 笔记数据 ====================

export interface XhsNote {
  note_id: string;
  title: string;
  author: string;
  author_id: string;
  cover_url: string;
  image_urls: string[];
  like_count: number;
  follower_count: number;
  note_content: string;
  note_url: string;
  potential_score: number; // like_count / follower_count
}

// ==================== 分析结果 ====================

export interface SingleAnalysis {
  note_id: string;
  image_descriptions: string[];
  target_audience: string;
  hook: string;
  structure: string;
  value_points: string[];
}

export interface BatchAnalysis {
  title_formula: string;
  content_template: string;
  visual_style: string;
  replication_guide: string;
}

export interface AIRequestConfig {
  api_key?: string;
}

// ==================== 分析任务 ====================

export interface AnalysisJob {
  id: string;
  keyword: string;
  status: JobStatus;
  mode: AnalysisMode | null;
  target_note_id: string | null;
  notes_json: string | null;    // JSON string of XhsNote[]
  analysis_json: string | null; // JSON string of SingleAnalysis | BatchAnalysis
  error_code: string | null;
  error_stage: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// ==================== 飞书记录 ====================

export interface FeishuRecord {
  id: string;
  job_id: string;
  note_id: string;
  note_url: string;
  title: string;
  author: string;
  cover_url: string;
  like_count: number;
  follower_count: number;
  potential_score: number;
  note_content: string;
  analysis_result: string; // JSON string
  status: RecordStatus;
  feishu_record_url: string | null;
  platform_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRecordPayload {
  job_id: string;
  note_id: string;
  note_url: string;
  title: string;
  author: string;
  cover_url: string;
  like_count: number;
  follower_count: number;
  potential_score: number;
  note_content: string;
  analysis_result: object;
}
