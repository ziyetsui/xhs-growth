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
  app_token?: string;
  table_id?: string;
}): Promise<string> {
  const token = await getFeishuToken();
  const finalAppToken = record.app_token || FEISHU_APP_TOKEN;
  const finalTableId = record.table_id || FEISHU_TABLE_ID;

  const res = await fetch(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${finalAppToken}/tables/${finalTableId}/records`,
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
    let errorMsg = data.msg || JSON.stringify(data);
    if (data.code === 91403) {
      errorMsg = '权限不足 (Forbidden)。请确保已在飞书多维表格中把“自建应用”添加为表格的协作者。';
    }
    throw new Error(`飞书写入失败: ${errorMsg}`);
  }

  const recordId = data.data?.record?.record_id || 'unknown';
  const feishuUrl = `https://feishu.cn/base/${finalAppToken}?table=${finalTableId}&record=${recordId}`;
  console.log('✅ 飞书记录写入成功:', recordId);
  return feishuUrl;
}
