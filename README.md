# 2026世界杯投票漂流瓶

一个基于 Node.js + Express 的完整前后端应用，支持 PC 端和移动端响应式布局。本地可使用 SQLite，线上推荐使用 Vercel + Supabase Database + Supabase Storage。

## 项目结构

```
worldcup-voting-app/
├── backend/                 # 后端服务
│   ├── server.js           # Express服务器
│   ├── database.js         # 本地 SQLite 数据库初始化
│   ├── db.js               # SQLite/Supabase 数据库适配
│   ├── storage.js          # 本地/Supabase Storage 上传适配
│   ├── package.json        # 后端依赖
│   └── worldcup.db         # SQLite数据库文件（自动生成）
├── public/                  # 前端文件
│   ├── index.html          # 主页面
│   ├── styles.css          # 样式文件（响应式设计）
│   └── app.js              # 前端逻辑
└── README.md               # 本文件
```

## 功能特性

### 核心功能
- **赛事投票**：每场比赛前开放投票，投票后显示实时统计
- **漂流瓶**：投瓶分享想法，收瓶与陌生球迷互动
- **个人中心**：投票战绩统计、成就徽章系统

### 技术特性
- **后端**：Node.js + Express，本地 SQLite，线上 Supabase/Postgres
- **前端**：原生HTML/CSS/JavaScript，无框架依赖
- **响应式**：PC端左侧边栏布局，移动端底部导航
- **数据持久化**：本地 SQLite 或线上 Supabase Database，用户 ID 存储在 localStorage

## 快速开始

### 1. 安装依赖

```bash
cd backend
npm install
```

### 2. 启动服务器

```bash
npm start
# 或开发模式（需要安装nodemon）
npm run dev
```

### 3. 访问应用

打开浏览器访问：http://localhost:3000

## Vercel + Supabase 部署

第一版不需要申请域名。Vercel 部署后会自动生成一个 `https://xxx.vercel.app` 地址，先用这个地址测试即可。等正式对外发布、需要品牌地址时，再在 Vercel 里绑定自有域名。

### 1. 创建 Supabase 项目

1. 注册并登录 Supabase。
2. 创建一个新 Project。
3. 在 Supabase SQL Editor 中执行 `supabase/schema.sql`。
4. 在 Storage 中创建 bucket：`flags`。
5. 如果希望上传后的队旗可直接访问，把 `flags` bucket 设为 Public。

### 2. 准备环境变量

复制 `.env.example`，并按 Supabase 项目信息填写：

```bash
DATABASE_URL=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_STORAGE_BUCKET=flags
PGSSLMODE=require
```

`SUPABASE_SERVICE_ROLE_KEY` 只放在服务端环境变量中，不要写进前端文件，也不要提交到代码仓库。

### 3. 部署到 Vercel

1. 把项目推送到 GitHub。
2. 在 Vercel 中 Import GitHub 仓库。
3. 在 Vercel Project Settings -> Environment Variables 中填写上面的环境变量。
4. 点击 Deploy。
5. 部署完成后访问 Vercel 自动分配的域名。

### 4. 验证接口

部署后重点检查：

```text
/
/admin.html
/api/matches
/api/stats/global
/api/upload/flag
```

管理员默认账号：

```text
admin / worldcup-admin-2026
```

## API接口文档

### 比赛相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/matches` | GET | 获取所有比赛 |
| `/api/matches/today` | GET | 获取今日比赛 |
| `/api/matches/:id` | GET | 获取比赛详情 |

### 投票相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/votes` | POST | 提交投票 |
| `/api/votes/stats/:matchId` | GET | 获取投票统计 |

### 漂流瓶相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/bottles` | POST | 投放漂流瓶 |
| `/api/bottles/pick` | POST | 收取漂流瓶 |
| `/api/bottles/my/thrown` | GET | 获取投出的瓶子 |
| `/api/bottles/my/collected` | GET | 获取收到的瓶子 |
| `/api/bottles/match/:matchId` | GET | 获取比赛相关瓶子 |
| `/api/bottles/picks/remaining` | GET | 获取今日剩余收瓶次数 |

### 用户相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/user/profile` | GET | 获取用户信息 |
| `/api/user/stats` | GET | 获取用户统计 |

### 统计相关

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/stats/global` | GET | 获取全局统计 |

## 数据库设计

### 表结构

- **matches**：比赛信息
- **votes**：投票记录
- **vote_stats**：投票统计缓存
- **bottles**：漂流瓶
- **users**：用户信息
- **user_picks**：用户收瓶记录

## 响应式设计

### PC端（> 768px）
- 左侧固定侧边栏（280px）
- 右侧主内容区
- 比赛卡片网格布局

### 移动端（≤ 768px）
- 隐藏侧边栏
- 底部固定导航栏
- 单列布局

## 开发说明

### 端口配置
- 默认端口：3000
- 可通过环境变量 `PORT` 修改

### 用户识别
- 首次访问自动生成UUID
- 存储在localStorage和请求头中
- 服务端通过 `X-User-Id` 头识别用户

## 后续优化

- [ ] 添加用户登录/注册
- [ ] 实现比赛结果自动更新
- [ ] 添加讨论区功能
- [ ] 实现比分预测验证
- [ ] 添加好友系统
- [ ] 优化成就解锁逻辑
- [ ] 添加管理后台

## 技术栈

- **后端**：Node.js 18+, Express 4.18, 本地 better-sqlite3, 线上 pg/Supabase
- **前端**：原生HTML5, CSS3, ES6+ JavaScript
- **数据库**：本地 SQLite 3，线上 Supabase Postgres

## License

MIT
