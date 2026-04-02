# XHS Growth

一个面向小红书选题与内容研究的 Chrome 插件 + 后端服务组合。

它可以在搜索结果页批量抓取笔记，自动补齐作者粉丝数，计算潜力值，调用 AI 总结爆款共性，并把结果统一同步到飞书多维表格。

## 为什么做这个项目

在手动做小红书选题研究时，最耗时间的通常不是“看内容”，而是这些重复动作：

- 在搜索结果页一篇篇点进去看数据
- 手动确认作者粉丝数，避免把赞藏数看成粉丝数
- 计算点赞 / 粉丝的潜力值
- 整理到飞书或表格里
- 再把前几篇爆款交给 AI 做结构总结

这个项目把这条链路串成了一套可复用的工作流。

## 核心能力

- 批量抓取当前小红书搜索页的笔记列表
- 自动滚动页面并去重，尽量拿全结果
- 深度进入详情页 / 作者主页补齐粉丝数
- 只识别明确的“粉丝”统计项，避免误抓“获赞与收藏”
- 根据 `点赞数 / 粉丝数` 计算潜力值并排序
- 使用每个用户自己的 DeepSeek API Key 发起 AI 分析
- 将最终结果统一写入同一个飞书表格

## 适合谁用

- 内容运营
- 小红书投放 / 增长团队
- 选题研究和竞品分析场景
- 需要把“灵感采集 -> 结构总结 -> 飞书归档”串起来的小团队

## 项目结构

```text
.
├── chrome-extension/   # Chrome 插件源码
├── backend/            # Express + TypeScript 后端
├── DEPLOY.md           # Railway 部署说明
└── README.md
```

## 工作流

1. 在 Chrome 中打开小红书搜索结果页
2. 点击插件，抓取当前页面笔记
3. 插件自动补齐作者粉丝数
4. 按潜力值重新排序
5. 使用用户自己的 AI Key 对前 5 篇做共性分析
6. 将结果同步到统一的飞书表格

## 技术栈

- Chrome Extension Manifest V3
- Vanilla JavaScript
- Node.js + Express
- TypeScript
- SQLite (`better-sqlite3`)
- DeepSeek API
- 飞书多维表格 API
- Railway

## 快速开始

### 1. 启动后端

进入 [backend/](backend/) 目录：

```bash
npm install
cp .env.example .env
npm run dev
```

你需要在 `.env` 里填写：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`

说明：

- 如果所有用户都使用自己的 AI Key，`DEEPSEEK_API_KEY` 可以留空
- 本地默认数据库是 SQLite

### 2. 安装插件

1. 打开 `chrome://extensions`
2. 开启右上角“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 [chrome-extension/](chrome-extension/) 目录

### 3. 首次配置

打开插件后：

1. 检查后端地址是否正确
2. 输入你自己的 DeepSeek API Key
3. 点击“保存 Key”

## 多用户使用方式

这个项目默认采用下面这套协作模式：

- 飞书表格共用一份，由后端统一写入
- 每个用户使用自己的 DeepSeek API Key
- 用户的 API Key 存在本地浏览器中，不写入飞书，也不落库到后端数据库

这套模式适合小团队内部协作：

- 数据集中沉淀
- AI 成本按个人账号承担
- 不需要每个人单独部署后端

## 部署

推荐部署到 Railway。

原因：

- 适合 Node / Express 服务
- 支持持久化 Volume，方便存放 SQLite 数据
- 配置简单，适合当前这个架构

详细步骤见 [DEPLOY.md](DEPLOY.md)。

## 当前实现重点

- 修复了粉丝数与“获赞与收藏”混淆的问题
- 支持多轮补抓，尽量补齐粉丝数
- 新增“潜力值”字段并同步到飞书
- 支持在插件中配置后端地址
- 支持用户本地保存自己的 AI Key

## 注意事项

- 本项目依赖小红书当前页面结构，目标站点改版后需要维护选择器
- 当前数据库仍是 SQLite，更适合小团队 / MVP 阶段
- 如果未来面向大量用户，建议把数据库升级到 Postgres
- 如果准备上 Chrome Web Store，建议进一步收紧 `host_permissions`

## Roadmap

- 支持单篇笔记更细的 AI 拆解
- 支持更多筛选维度
- 支持导出为更适合内容团队协作的报告格式
- 为 Chrome Web Store 上架整理正式素材与权限说明

## 免责声明

本项目仅用于内容研究、效率工具和内部工作流自动化。

请在遵守目标平台服务条款、隐私政策和当地法律法规的前提下使用。
