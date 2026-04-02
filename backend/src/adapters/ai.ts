import { AIRequestConfig, AnalysisMode, XhsNote, SingleAnalysis, BatchAnalysis } from '../types';

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function resolveApiKey(config?: AIRequestConfig): string {
  const requestApiKey = config?.api_key?.trim();
  const fallbackApiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const apiKey = requestApiKey || fallbackApiKey;

  if (!apiKey) {
    throw new Error('未提供 AI API Key，请先在插件中保存你自己的 Key');
  }

  return apiKey;
}

export function hasConfiguredApiKey(config?: AIRequestConfig): boolean {
  return Boolean(config?.api_key?.trim() || process.env.DEEPSEEK_API_KEY?.trim());
}

async function callLLM(prompt: string, config?: AIRequestConfig): Promise<string> {
  const apiKey = resolveApiKey(config);
  const res = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: '你是一位专业的小红书内容分析师。请严格按照要求输出 JSON 格式，不要包含 markdown 代码块标记。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${err}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content || '';
}

export async function analyzeSingle(note: XhsNote, config?: AIRequestConfig): Promise<SingleAnalysis> {
  const prompt = `
请对以下小红书笔记进行深度拆解分析，并以 JSON 格式返回。

笔记标题：${note.title}
作者：${note.author}
点赞数：${note.like_count}
粉丝数：${note.follower_count}
潜力值：${note.potential_score.toFixed(2)}
正文内容：${note.note_content}
图片数量：${note.image_urls.length} 张

请返回以下 JSON 结构（不要包含代码块标记）：
{
  "note_id": "${note.note_id}",
  "image_descriptions": ["对每张图片的内容描述（文字、构图、色彩、元素）"],
  "target_audience": "目标受众人群描述",
  "hook": "这篇笔记的爆点/钩子是什么",
  "structure": "内容结构分析（如：痛点→方案→效果）",
  "value_points": ["价值点1", "价值点2", "价值点3"]
}
`;

  const text = await callLLM(prompt, config);
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    // 如果解析失败，返回基本结构
    return {
      note_id: note.note_id,
      image_descriptions: ['AI 分析原始结果: ' + text],
      target_audience: '解析失败，请查看原始分析',
      hook: text.substring(0, 200),
      structure: '未能解析',
      value_points: ['原始分析已保存'],
    };
  }
}

export async function analyzeBatch(notes: XhsNote[], config?: AIRequestConfig): Promise<BatchAnalysis> {
  const noteSummaries = notes.map((n, i) => `
笔记${i + 1}：
- 标题：${n.title}
- 作者：${n.author}（粉丝 ${n.follower_count}）
- 点赞：${n.like_count}，潜力值：${n.potential_score.toFixed(2)}
- 正文摘要：${n.note_content.substring(0, 300)}
`).join('\n');

  const prompt = `
请分析以下 ${notes.length} 篇小红书爆款笔记的共性规律，找出可复制的创作公式。

${noteSummaries}

请返回以下 JSON 结构（不要包含代码块标记）：
{
  "title_formula": "标题公式总结（是否用数字、是否解决问题型、是否制造对比等）",
  "content_template": "内容结构模板（如：痛点+解决方案+效果展示）",
  "visual_style": "视觉风格共性（色调、封面排版、元素使用规律）",
  "replication_guide": "可复制的创作框架（具体的步骤指南，让人照着就能写）"
}
`;

  const text = await callLLM(prompt, config);
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      title_formula: '解析失败，原始分析: ' + text.substring(0, 300),
      content_template: '未能解析',
      visual_style: '未能解析',
      replication_guide: text,
    };
  }
}

export async function analyze(
  mode: AnalysisMode,
  notes: XhsNote[],
  noteId?: string,
  config?: AIRequestConfig
): Promise<SingleAnalysis | BatchAnalysis> {
  if (mode === 'single') {
    const note = notes.find(n => n.note_id === noteId);
    if (!note) throw new Error(`Note ${noteId} not found`);
    return analyzeSingle(note, config);
  } else {
    return analyzeBatch(notes.slice(0, 5), config);
  }
}
