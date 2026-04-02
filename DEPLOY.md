# 部署说明

## 目标架构

- 后端部署到 Railway
- 飞书表格共用一份，由后端统一写入
- 每个用户在插件里填写自己的 DeepSeek API Key
- 插件通过“后端地址”连接线上服务

## 1. 准备后端环境变量

参考 [backend/.env.example](backend/.env.example)：

- `PORT=3000`
- `HOST=0.0.0.0`
- `DB_PATH=/data/data.db`
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`
- `DEEPSEEK_API_KEY`

说明：

- 如果所有用户都用自己的 API Key，`DEEPSEEK_API_KEY` 可以留空，作为兜底时再填。
- Railway 上建议挂一个持久化 Volume，并把挂载路径设为 `/data`。
- `DB_PATH` 必须指向持久化目录，否则重启后 SQLite 数据会丢。

## 2. 部署后端到 Railway

在 `backend` 目录里已经放好了 [backend/railway.json](backend/railway.json)。

推荐流程：

1. 安装并登录 Railway CLI
2. 进入 `backend` 目录
3. 执行 `npx @railway/cli init`
4. 创建 Volume，挂载到 `/data`
5. 在 Railway 面板里配置环境变量
6. 执行 `npx @railway/cli up`
7. 部署完成后，拿到 Railway 分配的 `https://...up.railway.app` 地址

当前已部署地址：

- `https://xhs-tool-backend-production.up.railway.app`

## 3. 配置插件

插件现在支持在界面里配置后端地址和用户自己的 API Key：

- 后端地址：线上 Railway 域名
- API Key：用户自己的 DeepSeek Key

相关代码：

- [chrome-extension/popup.html](chrome-extension/popup.html)
- [chrome-extension/popup.js](chrome-extension/popup.js)

安装方式：

1. 打开 `chrome://extensions`
2. 开启开发者模式
3. 选择“加载已解压的扩展程序”
4. 选择 `chrome-extension` 目录
5. 在插件最上方填入你的后端地址
6. 每个用户再填自己的 DeepSeek API Key

## 4. 对外分发

当前最省事的分发方式：

- 先用“加载已解压扩展”给团队或朋友试用
- 稳定后再整理素材，上架 Chrome Web Store

当前 manifest 已允许：

- 小红书页面抓取
- 本地开发后端
- 任意 `https` 后端地址

如果后面准备上 Chrome Web Store，建议把后端权限从通配符收紧到你的正式线上域名。
