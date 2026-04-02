const FEISHU_APP_ID = process.env.FEISHU_APP_ID!;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET!;
const FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN!;
const FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID!;

let cachedToken: { token: string; expiresAt: number } | null = null;

// 获取飞书 tenant_access_token
async function getFeishuToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    }),
  });

  const data = await res.json() as any;
  if (data.code !== 0) {
    throw new Error(`飞书 Token 获取失败: ${JSON.stringify(data)}`);
  }

  cachedToken = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + (data.expire - 300) * 1000, // 提前 5 分钟刷新
  };

  console.log('✅ 飞书 Token 获取成功');
  return cachedToken.token;
}

// 写入飞书多维表格
export async function writeRecord(record: {
  note_url: string;
  title: string;
  author: string;
  cover_url: string;
  like_count: number;
  follower_count: number;
  potential_score: number;
  note_content: string;
  analysis_result: string;
}): Promise<string> {
  const token = await getFeishuToken();

  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${FEISHU_APP_TOKEN}/tables/${FEISHU_TABLE_ID}/records`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          '收录时间': Date.now(),
          '笔记链接': record.note_url,
          '标题': record.title,
          '作者': record.author,
          '点赞数': record.like_count,
          '粉丝数': record.follower_count,
          // 潜力值为公式字段（点赞数/粉丝数），无需写入
          '笔记正文': record.note_content,
        },
      }),
    }
  );

  const data = await res.json() as any;

  if (data.code !== 0) {
    console.error('飞书写入失败详情:', {
      error: data,
      payload: record
    });
    throw new Error(`飞书写入失败: ${data.msg || JSON.stringify(data)}`);
  }

  const recordId = data.data?.record?.record_id || 'unknown';
  const feishuUrl = `https://feishu.cn/base/${FEISHU_APP_TOKEN}?table=${FEISHU_TABLE_ID}&record=${recordId}`;
  console.log('✅ 飞书记录写入成功:', recordId);
  return feishuUrl;
}
