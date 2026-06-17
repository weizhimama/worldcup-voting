const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const db = require('./db');
const { hasSupabaseStorage, uploadFlag } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_TIME_ZONE = 'Asia/Shanghai';
const hasPostgres = Boolean(process.env.DATABASE_URL);

// ==================== 工具函数 ====================

const sha256 = (str) => crypto.createHash('sha256').update(str).digest('hex');

function formatInAppTimeZone(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getAppDate(date = new Date()) {
  return formatInAppTimeZone(date).slice(0, 10);
}

function getAppDayRange(date = new Date()) {
  const appDate = getAppDate(date);
  const [year, month, day] = appDate.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  return {
    start: `${fmt(start)} 00:00:00`,
    end: `${fmt(end)} 00:00:00`
  };
}

function getAppWeekRange(date = new Date()) {
  const appDate = getAppDate(date);
  const [year, month, day] = appDate.split('-').map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const dayOfWeek = new Date(utcMidnight).getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = new Date(utcMidnight - daysSinceMonday * 24 * 60 * 60 * 1000);
  const nextMonday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  return {
    start: `${fmt(monday)} 00:00:00`,
    end: `${fmt(nextMonday)} 00:00:00`
  };
}

function normalizeMatchDateTime(value) {
  if (!value) return value;
  const text = String(value).trim();
  if (!hasPostgres) return text;

  const normalized = text.replace(' ', 'T');
  if (/[zZ]$|[+-]\d{2}(?::?\d{2})?$/.test(normalized)) {
    return normalized.replace(/([+-]\d{2})$/, '$1:00');
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00+08:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}+08:00`;
  }
  return text;
}

function normalizeMatchRange(range) {
  return {
    start: normalizeMatchDateTime(range.start),
    end: normalizeMatchDateTime(range.end)
  };
}

// ==================== 图片上传配置 ====================

const localStorage = multer.diskStorage({
  destination: path.join(__dirname, '../public/uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `flag_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage: hasSupabaseStorage ? multer.memoryStorage() : localStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('仅支持图片文件'));
  }
});

if (!hasSupabaseStorage) {
  const fs = require('fs');
  const uploadsDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

// ==================== 管理员鉴权 ====================

async function adminAuth(req, res, next) {
  try {
    const token = req.headers['x-admin-token'] || req.query.adminToken;
    if (!token) {
      return res.status(401).json({ success: false, error: '未授权，请先登录' });
    }

    const parts = token.split(':');
    const admin = await db.prepare('SELECT * FROM admins WHERE id = ?').get(parseInt(parts[0]));
    if (!admin) {
      return res.status(401).json({ success: false, error: '无效 Token' });
    }

    const expectedToken = `${admin.id}:${sha256(admin.id + admin.username + admin.password_hash)}`;
    if (token !== expectedToken) {
      return res.status(401).json({ success: false, error: 'Token 已失效，请重新登录' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

// 操作日志记录
async function logAction(admin, action, targetType, targetId, detail) {
  try {
   await db.prepare(`
      INSERT INTO admin_logs (admin_id, admin_name, action, target_type, target_id, detail)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(admin.id, admin.username, action, targetType || null, targetId ? String(targetId) : null, detail ? JSON.stringify(detail) : null);
  } catch (e) {
    console.error('日志记录失败:', e.message);
  }
}

async function getSingleValue(sql, params = [], key = 'c') {
  const row = await db.prepare(sql).get(...params);
  return row?.[key] || 0;
}

const ADMIN_PAGE_SIZES = [20, 50, 100];

function normalizeAdminPagination(query, defaultPageSize = 20) {
  const requestedPage = parseInt(query.page, 10);
  const requestedPageSize = parseInt(query.pageSize, 10);
  const fallbackSize = ADMIN_PAGE_SIZES.includes(defaultPageSize) ? defaultPageSize : 20;
  return {
    page: Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    pageSize: ADMIN_PAGE_SIZES.includes(requestedPageSize) ? requestedPageSize : fallbackSize
  };
}

function clampAdminPagination(total, pagination) {
  const totalPages = Math.max(1, Math.ceil((total || 0) / pagination.pageSize));
  const page = Math.min(Math.max(1, pagination.page), totalPages);
  return {
    ...pagination,
    page,
    totalPages,
    offset: (page - 1) * pagination.pageSize
  };
}

async function recomputeVoteStats(matchId = null) {
  if (matchId) {
    await db.prepare(`
      UPDATE vote_stats SET
        home_votes = (SELECT COUNT(*) FROM votes WHERE match_id = ? AND choice = 'home'),
        draw_votes = (SELECT COUNT(*) FROM votes WHERE match_id = ? AND choice = 'draw'),
        away_votes = (SELECT COUNT(*) FROM votes WHERE match_id = ? AND choice = 'away'),
        total_votes = (SELECT COUNT(*) FROM votes WHERE match_id = ?)
      WHERE match_id = ?
    `).run(matchId, matchId, matchId, matchId, matchId);
    return;
  }

  await db.prepare(`
    UPDATE vote_stats SET
      home_votes = (SELECT COUNT(*) FROM votes WHERE match_id = vote_stats.match_id AND choice = 'home'),
      draw_votes = (SELECT COUNT(*) FROM votes WHERE match_id = vote_stats.match_id AND choice = 'draw'),
      away_votes = (SELECT COUNT(*) FROM votes WHERE match_id = vote_stats.match_id AND choice = 'away'),
      total_votes = (SELECT COUNT(*) FROM votes WHERE match_id = vote_stats.match_id)
  `).run();
}

async function recomputeCorrectVotes(userId = null) {
  const where = userId ? 'WHERE users.id = ?' : '';
  const params = userId ? [userId] : [];
  await db.prepare(`
    UPDATE users SET correct_votes = (
      SELECT COUNT(*)
      FROM votes v
      JOIN matches m ON v.match_id = m.id
      WHERE v.user_id = users.id
        AND m.status = 'ended'
        AND m.home_score IS NOT NULL
        AND m.away_score IS NOT NULL
        AND v.choice = CASE
          WHEN m.home_score > m.away_score THEN 'home'
          WHEN m.home_score < m.away_score THEN 'away'
          ELSE 'draw'
        END
    )
    ${where}
  `).run(...params);
}

async function getComputedUserStats(userId) {
  const totalVotes = await getSingleValue('SELECT COUNT(*) as c FROM votes WHERE user_id = ?', [userId]);
  const correctVotes = await getSingleValue(`
    SELECT COUNT(*) as c
    FROM votes v
    JOIN matches m ON v.match_id = m.id
    WHERE v.user_id = ?
      AND m.status = 'ended'
      AND m.home_score IS NOT NULL
      AND m.away_score IS NOT NULL
      AND v.choice = CASE
        WHEN m.home_score > m.away_score THEN 'home'
        WHEN m.home_score < m.away_score THEN 'away'
        ELSE 'draw'
      END
  `, [userId]);
  const thrownBottles = await getSingleValue('SELECT COUNT(*) as c FROM bottles WHERE user_id = ?', [userId]);
  const collectedBottles = await getSingleValue('SELECT COUNT(*) as c FROM user_picks WHERE user_id = ?', [userId]);
  const receivedReplies = await getSingleValue(`
    SELECT COUNT(*) as c
    FROM bottle_replies r
    JOIN bottles b ON r.bottle_id = b.id
    WHERE b.user_id = ? AND r.user_id != ?
  `, [userId, userId]);
  const sentReplies = await getSingleValue('SELECT COUNT(*) as c FROM bottle_replies WHERE user_id = ?', [userId]);
  const totalMatches = await getSingleValue('SELECT COUNT(*) as c FROM matches');
  const accuracy = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0;

  return {
    total_votes: totalVotes,
    correct_votes: correctVotes,
    total_bottles: thrownBottles,
    collected_bottles: collectedBottles,
    total_bottle_all: thrownBottles + collectedBottles,
    received_replies: receivedReplies,
    sent_replies: sentReplies,
    accuracy: `${accuracy}%`,
    achievements: {
      predictNovice: { unlocked: totalVotes >= 5, progress: totalVotes, target: 5 },
      prophecyMaster: { unlocked: correctVotes >= 3, progress: correctVotes, target: 3 },
      bottleDrifter: { unlocked: thrownBottles >= 5, progress: thrownBottles, target: 5 },
      fatedFriend: { unlocked: receivedReplies >= 5, progress: receivedReplies, target: 5 },
      fullAttendance: { unlocked: totalMatches > 0 && totalVotes >= totalMatches, progress: totalVotes, target: totalMatches }
    }
  };
}

// ==================== 赛事状态自动更新 ====================
// 根据 match_time / end_time 与当前时间对比自动更新 status
async function autoUpdateMatchStatus() {
  if (hasPostgres) {
    await db.prepare(`
      UPDATE matches SET status = 'ended'
      WHERE end_time IS NOT NULL AND end_time <= CURRENT_TIMESTAMP
    `).run();
    await db.prepare(`
      UPDATE matches SET status = 'live'
      WHERE match_time <= CURRENT_TIMESTAMP
        AND (end_time IS NULL OR end_time > CURRENT_TIMESTAMP)
    `).run();
    await db.prepare(`
      UPDATE matches SET status = 'upcoming'
      WHERE match_time > CURRENT_TIMESTAMP
    `).run();
    return;
  }

  const now = formatInAppTimeZone();
  await db.prepare(`
    UPDATE matches SET status = 'ended'
    WHERE end_time IS NOT NULL AND end_time <= ?
  `).run(now);
  await db.prepare(`
    UPDATE matches SET status = 'live'
    WHERE match_time <= ?
      AND (end_time IS NULL OR end_time > ?)
  `).run(now, now);
  await db.prepare(`
    UPDATE matches SET status = 'upcoming'
    WHERE match_time > ?
  `).run(now);
}

// ==================== 中间件 ====================

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      ok: true,
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasSupabaseUrl: Boolean(process.env.SUPABASE_URL),
      hasSupabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'flags'
    }
  });
});

// 用户ID中间件
app.use(async (req, res, next) => {
  try {
    if (
      req.path === '/api/user/register' ||
      req.path === '/api/user/login' ||
      req.path === '/api/admin/login' ||
      req.path.startsWith('/api/admin') ||
      req.path.startsWith('/api/upload')
    ) {
      return next();
    }

    let userId = req.headers['x-user-id'];
    if (!userId) {
      userId = uuidv4();
    }
    req.userId = userId;

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      await db.prepare('INSERT INTO users (id) VALUES (?)').run(userId);
    }

    res.setHeader('X-User-Id', userId);
    next();
  } catch (error) {
    next(error);
  }
});

// ==================== 比赛相关API ====================

app.get('/api/matches', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const userId = req.userId;
    const matches = await db.prepare(`
      SELECT m.*,
        COALESCE(vs.home_votes, 0) as home_votes,
        COALESCE(vs.draw_votes, 0) as draw_votes,
        COALESCE(vs.away_votes, 0) as away_votes,
        COALESCE(vs.total_votes, 0) as total_votes
      FROM matches m
      LEFT JOIN vote_stats vs ON m.id = vs.match_id
      ORDER BY m.match_time ASC
    `).all();
    // 批量查出当前用户的投票记录
    const myVotes = userId
      ? await db.prepare(`SELECT match_id, choice FROM votes WHERE user_id = ?`).all(userId)
      : [];
    const voteMap = {};
    myVotes.forEach(v => { voteMap[v.match_id] = v.choice; });
    const data = matches.map(m => ({ ...m, userVote: voteMap[m.id] || null }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 本周比赛场次
app.get('/api/matches/week-count', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const week = normalizeMatchRange(getAppWeekRange());
    const count = await getSingleValue(`
      SELECT COUNT(*) as c FROM matches
      WHERE match_time >= ? AND match_time < ?
    `, [week.start, week.end]);
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/matches/today', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const today = normalizeMatchRange(getAppDayRange());
    const matches = await db.prepare(`
      SELECT m.*,
        COALESCE(vs.home_votes, 0) as home_votes,
        COALESCE(vs.draw_votes, 0) as draw_votes,
        COALESCE(vs.away_votes, 0) as away_votes,
        COALESCE(vs.total_votes, 0) as total_votes
      FROM matches m
      LEFT JOIN vote_stats vs ON m.id = vs.match_id
      WHERE m.match_time >= ? AND m.match_time < ?
      ORDER BY m.match_time ASC
    `).all(today.start, today.end);
    res.json({ success: true, data: matches });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/matches/:id', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const match = await db.prepare(`
      SELECT m.*,
        COALESCE(vs.home_votes, 0) as home_votes,
        COALESCE(vs.draw_votes, 0) as draw_votes,
        COALESCE(vs.away_votes, 0) as away_votes,
        COALESCE(vs.total_votes, 0) as total_votes
      FROM matches m
      LEFT JOIN vote_stats vs ON m.id = vs.match_id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!match) return res.status(404).json({ success: false, error: '比赛不存在' });

    const userVote = await db.prepare(`
      SELECT choice FROM votes WHERE match_id = ? AND user_id = ?
    `).get(req.params.id, req.userId);

    res.json({ success: true, data: { ...match, userVote: userVote?.choice || null } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 投票相关API ====================

app.post('/api/votes', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const { matchId, choice } = req.body;
    if (!['home', 'draw', 'away'].includes(choice)) {
      return res.status(400).json({ success: false, error: '无效的投票选项' });
    }

    const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    if (!match) return res.status(404).json({ success: false, error: '比赛不存在' });
    if (match.status === 'ended') {
      return res.status(400).json({ success: false, error: '比赛已结束，无法投票' });
    }

    const existingVote = await db.prepare('SELECT * FROM votes WHERE match_id = ? AND user_id = ?').get(matchId, req.userId);
    if (existingVote) return res.status(400).json({ success: false, error: '您已经投过票了', code: 'ALREADY_VOTED' });

    await db.transaction(async () => {
      await db.prepare('INSERT INTO votes (match_id, user_id, choice) VALUES (?, ?, ?)').run(matchId, req.userId, choice);
      const col = choice === 'home' ? 'home_votes' : choice === 'draw' ? 'draw_votes' : 'away_votes';
      await db.prepare(`UPDATE vote_stats SET ${col} = ${col} + 1, total_votes = total_votes + 1 WHERE match_id = ?`).run(matchId);
      await db.prepare('UPDATE users SET total_votes = total_votes + 1 WHERE id = ?').run(req.userId);
    })();

    await recomputeCorrectVotes(req.userId);

    const stats = await db.prepare('SELECT * FROM vote_stats WHERE match_id = ?').get(matchId);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 撤销投票（重新投票）
app.delete('/api/votes/:matchId', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const { matchId } = req.params;
    const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    if (!match) return res.status(404).json({ success: false, error: '比赛不存在' });
    if (match.status === 'ended') {
      return res.status(400).json({ success: false, error: '比赛已结束，无法修改投票' });
    }

    const existingVote = await db.prepare('SELECT * FROM votes WHERE match_id = ? AND user_id = ?').get(matchId, req.userId);
    if (!existingVote) return res.status(400).json({ success: false, error: '您还没有投票' });

    await db.transaction(async () => {
      const col = existingVote.choice === 'home' ? 'home_votes' : existingVote.choice === 'draw' ? 'draw_votes' : 'away_votes';
      await db.prepare('DELETE FROM votes WHERE match_id = ? AND user_id = ?').run(matchId, req.userId);
      await db.prepare(`UPDATE vote_stats SET ${col} = MAX(0, ${col} - 1), total_votes = MAX(0, total_votes - 1) WHERE match_id = ?`).run(matchId);
      await db.prepare('UPDATE users SET total_votes = MAX(0, total_votes - 1) WHERE id = ?').run(req.userId);
    })();

    await recomputeCorrectVotes(req.userId);

    const stats = await db.prepare('SELECT * FROM vote_stats WHERE match_id = ?').get(matchId);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/votes/stats/:matchId', async (req, res) => {
  try {
    const stats = await db.prepare('SELECT * FROM vote_stats WHERE match_id = ?').get(req.params.matchId);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 漂流瓶相关API ====================

app.post('/api/bottles', async (req, res) => {
  try {
    const { type, content, matchId } = req.body;
    if (!['support', 'predict', 'chat', 'meet'].includes(type)) {
      return res.status(400).json({ success: false, error: '无效的瓶子类型' });
    }
    if (!content || content.length < 10 || content.length > 200) {
      return res.status(400).json({ success: false, error: '内容长度需在10-200字之间' });
    }

    const result = await db.prepare(`
      INSERT INTO bottles (user_id, type, content, match_id) VALUES (?, ?, ?, ?)
    `).run(req.userId, type, content, matchId || null);

   await db.prepare('UPDATE users SET total_bottles = total_bottles + 1 WHERE id = ?').run(req.userId);
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/bottles/pick', async (req, res) => {
  try {
    const today = getAppDate();
    const todayPicks = await db.prepare('SELECT COUNT(*) as count FROM user_picks WHERE user_id = ? AND pick_date = ?').get(req.userId, today);
    if (todayPicks.count >= 5) {
      return res.status(400).json({ success: false, error: '今日收瓶次数已用完' });
    }

    const bottle = await db.prepare(`
      SELECT * FROM bottles
      WHERE user_id != ?
        AND id NOT IN (SELECT bottle_id FROM user_picks WHERE user_id = ?)
      ORDER BY RANDOM() LIMIT 1
    `).get(req.userId, req.userId);
    if (!bottle) return res.status(404).json({ success: false, error: '暂无新漂流瓶可收取，所有瓶子都捞过啦！' });

   await db.prepare('INSERT INTO user_picks (user_id, bottle_id, pick_date) VALUES (?, ?, ?)').run(req.userId, bottle.id, today);
    res.json({ success: true, data: { ...bottle, remainingPicks: 4 - todayPicks.count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bottles/my/thrown', async (req, res) => {
  try {
    const bottles = await db.prepare(`
      SELECT b.*, m.home_team, m.away_team,
        (SELECT COUNT(*) FROM bottle_replies WHERE bottle_id = b.id) as reply_count
      FROM bottles b LEFT JOIN matches m ON b.match_id = m.id
      WHERE b.user_id = ? ORDER BY b.created_at DESC
    `).all(req.userId);
    res.json({ success: true, data: bottles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bottles/my/collected', async (req, res) => {
  try {
    const bottles = await db.prepare(`
      SELECT b.*, m.home_team, m.away_team, up.picked_at,
        (SELECT COUNT(*) FROM bottle_replies WHERE bottle_id = b.id) as reply_count
      FROM user_picks up
      JOIN bottles b ON up.bottle_id = b.id
      LEFT JOIN matches m ON b.match_id = m.id
      WHERE up.user_id = ? ORDER BY up.picked_at DESC
    `).all(req.userId);
    res.json({ success: true, data: bottles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bottles/match/:matchId', async (req, res) => {
  try {
    const bottles = await db.prepare(`
      SELECT b.*,
        (SELECT COUNT(*) FROM bottle_replies WHERE bottle_id = b.id) as reply_count
      FROM bottles b
      WHERE match_id = ? ORDER BY created_at DESC LIMIT 20
    `).all(req.params.matchId);
    res.json({ success: true, data: bottles });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/bottles/picks/remaining', async (req, res) => {
  try {
    const today = getAppDate();
    const todayPicks = await db.prepare('SELECT COUNT(*) as count FROM user_picks WHERE user_id = ? AND pick_date = ?').get(req.userId, today);
    res.json({ success: true, data: { remaining: 5 - (todayPicks?.count || 0), used: todayPicks?.count || 0 } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 漂流瓶总数
app.get('/api/bottles/count', async (req, res) => {
  try {
    const count = await getSingleValue('SELECT COUNT(*) as c FROM bottles');
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 单个漂流瓶详情
app.get('/api/bottles/:bottleId', async (req, res) => {
  try {
    const bottle = await db.prepare(`
      SELECT b.*, u.nickname, u.username, u.avatar,
        m.home_team, m.away_team
      FROM bottles b
      LEFT JOIN users u ON b.user_id = u.id
      LEFT JOIN matches m ON b.match_id = m.id
      WHERE b.id = ?
    `).get(req.params.bottleId);
    if (!bottle) return res.status(404).json({ success: false, error: '漂流瓶不存在' });
    res.json({ success: true, data: bottle });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 漂流瓶回复列表
app.get('/api/bottles/:bottleId/replies', async (req, res) => {
  try {
    const replies = await db.prepare(`
      SELECT r.*, u.nickname, u.username, u.avatar
      FROM bottle_replies r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.bottle_id = ?
      ORDER BY r.created_at ASC
    `).all(req.params.bottleId);
    res.json({ success: true, data: replies });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 发回复
app.post('/api/bottles/:bottleId/replies', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || content.length < 2 || content.length > 200) {
      return res.status(400).json({ success: false, error: '回复内容需在2-200字之间' });
    }
    const bottle = await db.prepare('SELECT * FROM bottles WHERE id = ?').get(req.params.bottleId);
    if (!bottle) return res.status(404).json({ success: false, error: '漂流瓶不存在' });

    const result = await db.prepare(
      'INSERT INTO bottle_replies (bottle_id, user_id, content) VALUES (?, ?, ?)'
    ).run(req.params.bottleId, req.userId, content);

    const reply = await db.prepare(`
      SELECT r.*, u.nickname, u.username, u.avatar FROM bottle_replies r
      LEFT JOIN users u ON r.user_id = u.id WHERE r.id = ?
    `).get(result.lastInsertRowid);

    res.json({ success: true, data: reply });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 用户相关API ====================

// 用户注册
app.post('/api/user/register', async (req, res) => {
  try {
    const { userId, username, password, nickname, claimGuestData } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '缺少必填字段' });
    }
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ success: false, error: '用户名长度应为2-20个字符' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码至少6位' });
    }

    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(400).json({ success: false, error: '用户名已被使用，请换一个' });
    }

    let newUserId = uuidv4();
    if (claimGuestData && userId) {
      const guest = await db.prepare('SELECT id, is_setup FROM users WHERE id = ?').get(userId);
      if (guest && !guest.is_setup) {
        newUserId = userId;
      }
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);
    if (!user) {
     await db.prepare('INSERT INTO users (id) VALUES (?)').run(newUserId);
    }

    const passwordHash = sha256(password);
    const displayNickname = nickname || username;

   await db.prepare(`
      UPDATE users SET username = ?, password_hash = ?, nickname = ?, is_setup = 1
      WHERE id = ?
    `).run(username, passwordHash, displayNickname, newUserId);

    const updated = await db.prepare('SELECT * FROM users WHERE id = ?').get(newUserId);
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '用户名已被使用，请换一个' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// 用户登录
app.post('/api/user/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '请输入用户名和密码' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ success: false, error: '用户名或密码错误' });

    const passwordHash = sha256(password);
    if (user.password_hash !== passwordHash) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 修改密码
app.put('/api/user/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, error: '请输入旧密码和新密码' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: '新密码至少6位' });
    }

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
    if (user.password_hash !== sha256(oldPassword)) {
      return res.status(401).json({ success: false, error: '旧密码错误' });
    }

   await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(sha256(newPassword), req.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 检查用户名是否可用
app.get('/api/user/check-username', async (req, res) => {
  try {
    const { username, currentUserId } = req.query;
    if (!username) return res.json({ success: true, available: false, message: '用户名不能为空' });

    const existing = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, currentUserId || '');
    res.json({ success: true, available: !existing });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取用户信息
app.get('/api/user/profile', async (req, res) => {
  try {
    await recomputeCorrectVotes(req.userId);
    const user = await db.prepare('SELECT id, nickname, avatar, level, total_votes, correct_votes, total_bottles, username, is_setup, created_at FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
    const stats = await getComputedUserStats(req.userId);
    res.json({ success: true, data: { ...user, ...stats } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新用户资料
app.put('/api/user/profile', async (req, res) => {
  try {
    const { nickname, avatar } = req.body;
   await db.prepare('UPDATE users SET nickname = COALESCE(?, nickname), avatar = COALESCE(?, avatar) WHERE id = ?')
      .run(nickname || null, avatar || null, req.userId);
    const user = await db.prepare('SELECT id, nickname, avatar, level, total_votes, correct_votes, total_bottles, username, is_setup FROM users WHERE id = ?').get(req.userId);
    const stats = await getComputedUserStats(req.userId);
    res.json({ success: true, data: { ...user, ...stats } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取用户统计（含本人漂流瓶投出+收到总数）
app.get('/api/user/stats', async (req, res) => {
  try {
    await recomputeCorrectVotes(req.userId);
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.userId);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
    res.json({ success: true, data: await getComputedUserStats(req.userId) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 统计相关API ====================

app.get('/api/stats/global', async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    if (req.userId) await recomputeCorrectVotes(req.userId);
    const week = normalizeMatchRange(getAppWeekRange());
    const weekCount = await getSingleValue(`
      SELECT COUNT(*) as c FROM matches
      WHERE match_time >= ? AND match_time < ?
    `, [week.start, week.end]);

    const totalVotes = await db.prepare('SELECT SUM(total_votes) as total FROM vote_stats').get();
    const totalBottles = await db.prepare('SELECT COUNT(*) as count FROM bottles').get();

    // 当前用户投票数
    let myVotes = 0;
    if (req.userId) {
      myVotes = await getSingleValue('SELECT COUNT(*) as c FROM votes WHERE user_id = ?', [req.userId]);
    }
    // 当前用户漂流瓶数（投出+收到）
    let myBottles = 0;
    if (req.userId) {
      const thrown = await getSingleValue('SELECT COUNT(*) as c FROM bottles WHERE user_id = ?', [req.userId]);
      const picked = await getSingleValue('SELECT COUNT(*) as c FROM user_picks WHERE user_id = ?', [req.userId]);
      myBottles = thrown + picked;
    }

    res.json({
      success: true,
      data: {
        weekMatches: weekCount,
        totalVotes: totalVotes.total || 0,
        totalBottles: totalBottles.count,
        myVotes,
        myBottles
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 图片上传API ====================

app.post('/api/upload/flag', adminAuth, upload.single('flag'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: '请选择图片文件' });
    const url = await uploadFlag(req.file);
    res.json({ success: true, data: { url } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== 管理后台 API ====================

// ---- 管理员登录 ----
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '请输入用户名和密码' });
    }

    const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin || admin.password_hash !== sha256(password)) {
      return res.status(401).json({ success: false, error: '用户名或密码错误' });
    }

    const token = `${admin.id}:${sha256(admin.id + admin.username + admin.password_hash)}`;
   await db.prepare('UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);

    await logAction(admin, '管理员登录', 'admin', admin.id, { username: admin.username });

    res.json({
      success: true,
      data: {
        token,
        adminId: admin.id,
        username: admin.username,
        role: admin.role
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 仪表盘概览 ----
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const totalUsers = await getSingleValue("SELECT COUNT(*) as c FROM users WHERE username IS NOT NULL AND username != ''");
    const totalMatches = await getSingleValue('SELECT COUNT(*) as c FROM matches');
    const totalVotes = await getSingleValue('SELECT SUM(total_votes) as c FROM vote_stats');
    const totalBottles = await getSingleValue('SELECT COUNT(*) as c FROM bottles');
    const totalPicks = await getSingleValue('SELECT COUNT(*) as c FROM user_picks');

    const dailyVotes = await db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM votes WHERE created_at >= DATE('now', '-6 days')
      GROUP BY day ORDER BY day ASC
    `).all();

    const dailyBottles = await db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM bottles WHERE created_at >= DATE('now', '-6 days')
      GROUP BY day ORDER BY day ASC
    `).all();

    const topMatches = await db.prepare(`
      SELECT m.home_team, m.away_team, m.home_flag, m.away_flag,
             vs.home_votes, vs.draw_votes, vs.away_votes, vs.total_votes
      FROM vote_stats vs JOIN matches m ON vs.match_id = m.id
      ORDER BY vs.total_votes DESC LIMIT 10
    `).all();

    const statusDist = await db.prepare('SELECT status, COUNT(*) as count FROM matches GROUP BY status').all();

    res.json({
      success: true,
      data: { overview: { totalUsers, totalMatches, totalVotes, totalBottles, totalPicks }, dailyVotes, dailyBottles, topMatches, statusDist }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 比赛管理 ----

app.get('/api/admin/matches', adminAuth, async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const { status } = req.query;
    const requestedPagination = normalizeAdminPagination(req.query, 20);
    let where = '';
    const params = [];
    if (status) { where = 'WHERE m.status = ?'; params.push(status); }

    const total = await getSingleValue(`SELECT COUNT(*) as c FROM matches m ${where}`, params);
    const pagination = clampAdminPagination(total, requestedPagination);
    const matches = await db.prepare(`
      SELECT m.*,
        COALESCE(vs.home_votes, 0) as home_votes,
        COALESCE(vs.draw_votes, 0) as draw_votes,
        COALESCE(vs.away_votes, 0) as away_votes,
        COALESCE(vs.total_votes, 0) as total_votes
      FROM matches m LEFT JOIN vote_stats vs ON m.id = vs.match_id
      ${where} ORDER BY m.match_time ASC LIMIT ? OFFSET ?
    `).all(...params, pagination.pageSize, pagination.offset);

    res.json({ success: true, data: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, matches } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/matches/:id(\\d+)', adminAuth, async (req, res) => {
  try {
    await autoUpdateMatchStatus();
    const match = await db.prepare(`
      SELECT m.*,
        COALESCE(vs.home_votes, 0) as home_votes,
        COALESCE(vs.draw_votes, 0) as draw_votes,
        COALESCE(vs.away_votes, 0) as away_votes,
        COALESCE(vs.total_votes, 0) as total_votes
      FROM matches m LEFT JOIN vote_stats vs ON m.id = vs.match_id
      WHERE m.id = ?
    `).get(req.params.id);

    if (!match) return res.status(404).json({ success: false, error: '比赛不存在' });
    res.json({ success: true, data: match });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 新增单场比赛
app.post('/api/admin/matches', adminAuth, async (req, res) => {
  try {
    const { group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time } = req.body;
    if (!group_name || !round || !home_team || !away_team || !match_time) {
      return res.status(400).json({ success: false, error: '缺少必填字段' });
    }

    const normalizedMatchTime = normalizeMatchDateTime(match_time);
    const normalizedEndTime = normalizeMatchDateTime(end_time) || null;
    const result = await db.prepare(`
      INSERT INTO matches (group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')
    `).run(group_name, round, home_team, home_flag || '', home_rank || null, away_team, away_flag || '', away_rank || null, normalizedMatchTime, normalizedEndTime);

   await db.prepare('INSERT OR IGNORE INTO vote_stats (match_id) VALUES (?)').run(result.lastInsertRowid);

    await logAction(req.admin, '新增比赛', 'match', result.lastInsertRowid, { home_team, away_team, match_time: normalizedMatchTime });

    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 批量新增比赛
app.post('/api/admin/matches/batch', adminAuth, async (req, res) => {
  try {
    const { matches } = req.body;
    if (!Array.isArray(matches) || matches.length === 0) {
      return res.status(400).json({ success: false, error: '请提供比赛列表' });
    }

    const results = await db.transaction(async () => {
      const ids = [];
      for (const m of matches) {
        if (!m.group_name || !m.round || !m.home_team || !m.away_team || !m.match_time) {
          throw new Error(`比赛数据不完整: ${m.home_team || '?'} vs ${m.away_team || '?'}`);
        }
        const result = await db.prepare(`
          INSERT INTO matches (group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')
        `).run(
          m.group_name,
          m.round,
          m.home_team,
          m.home_flag || '',
          m.home_rank || null,
          m.away_team,
          m.away_flag || '',
          m.away_rank || null,
          normalizeMatchDateTime(m.match_time),
          normalizeMatchDateTime(m.end_time) || null
        );
       await db.prepare('INSERT OR IGNORE INTO vote_stats (match_id) VALUES (?)').run(result.lastInsertRowid);
        ids.push(result.lastInsertRowid);
      }
      return ids;
    })();

    await logAction(req.admin, '批量新增比赛', 'match', null, { count: results.length });

    res.json({ success: true, data: { ids: results, count: results.length } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新比赛
app.put('/api/admin/matches/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time, status, home_score, away_score } = req.body;

    const existing = await db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '比赛不存在' });

    const normalizedMatchTime = normalizeMatchDateTime(match_time);
    const normalizedEndTime = normalizeMatchDateTime(end_time);
   await db.prepare(`
      UPDATE matches SET
        group_name  = COALESCE(?, group_name),
        round       = COALESCE(?, round),
        home_team   = COALESCE(?, home_team),
        home_flag   = COALESCE(?, home_flag),
        home_rank   = COALESCE(?, home_rank),
        away_team   = COALESCE(?, away_team),
        away_flag   = COALESCE(?, away_flag),
        away_rank   = COALESCE(?, away_rank),
        match_time  = COALESCE(?, match_time),
        end_time    = COALESCE(?, end_time),
        status      = COALESCE(?, status),
        home_score  = COALESCE(?, home_score),
        away_score  = COALESCE(?, away_score)
      WHERE id = ?
    `).run(group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, normalizedMatchTime, normalizedEndTime, status, home_score, away_score, id);

    await recomputeCorrectVotes();

    await logAction(req.admin, '更新比赛', 'match', id, { before: { status: existing.status }, after: req.body });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除比赛
app.delete('/api/admin/matches/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '比赛不存在' });

    await db.transaction(async () => {
      await db.prepare('DELETE FROM bottle_replies WHERE bottle_id IN (SELECT id FROM bottles WHERE match_id = ?)').run(id);
      await db.prepare('DELETE FROM user_picks WHERE bottle_id IN (SELECT id FROM bottles WHERE match_id = ?)').run(id);
      await db.prepare('DELETE FROM votes WHERE match_id = ?').run(id);
      await db.prepare('DELETE FROM vote_stats WHERE match_id = ?').run(id);
      await db.prepare('DELETE FROM bottles WHERE match_id = ?').run(id);
      await db.prepare('DELETE FROM matches WHERE id = ?').run(id);
    })();

    await recomputeCorrectVotes();
    await logAction(req.admin, '删除比赛', 'match', id, { home_team: existing.home_team, away_team: existing.away_team });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 投票数据统计 ----

app.get('/api/admin/votes/match/:matchId', adminAuth, async (req, res) => {
  try {
    const { matchId } = req.params;
    const stats = await db.prepare('SELECT * FROM vote_stats WHERE match_id = ?').get(matchId);
    const match = await db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    if (!match) return res.status(404).json({ success: false, error: '比赛不存在' });

    const hourDist = await db.prepare(`
      SELECT strftime('%H', created_at) as hour, choice, COUNT(*) as count
      FROM votes WHERE match_id = ? GROUP BY hour, choice ORDER BY hour ASC
    `).all(matchId);

    res.json({ success: true, data: { match, stats, hourDist } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/votes', adminAuth, async (req, res) => {
  try {
    const { matchId } = req.query;
    const requestedPagination = normalizeAdminPagination(req.query, 20);
    let where = '';
    const params = [];
    if (matchId) { where = 'WHERE v.match_id = ?'; params.push(matchId); }

    const total = await getSingleValue(`SELECT COUNT(*) as c FROM votes v ${where}`, params);
    const pagination = clampAdminPagination(total, requestedPagination);
    const votes = await db.prepare(`
      SELECT v.id, v.user_id, v.choice, v.created_at, m.home_team, m.away_team, m.home_flag, m.away_flag
      FROM votes v JOIN matches m ON v.match_id = m.id
      ${where} ORDER BY v.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, pagination.pageSize, pagination.offset);

    res.json({ success: true, data: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, votes } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 漂流瓶管理 ----

app.get('/api/admin/bottles', adminAuth, async (req, res) => {
  try {
    const { type } = req.query;
    const requestedPagination = normalizeAdminPagination(req.query, 20);
    let where = '';
    const params = [];
    if (type) { where = 'WHERE b.type = ?'; params.push(type); }

    const total = await getSingleValue(`SELECT COUNT(*) as c FROM bottles b ${where}`, params);
    const pagination = clampAdminPagination(total, requestedPagination);
    const bottles = await db.prepare(`
      SELECT b.*, m.home_team, m.away_team,
             COALESCE(NULLIF(u.username, ''), 'ball_fan_1') as author_username,
             COALESCE(NULLIF(u.nickname, ''), '球迷小明') as author_nickname,
             (SELECT COUNT(*) FROM user_picks WHERE bottle_id = b.id) as pick_count,
             (SELECT COUNT(*) FROM bottle_replies WHERE bottle_id = b.id) as reply_count
      FROM bottles b LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN users u ON b.user_id = u.id
      ${where} ORDER BY b.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, pagination.pageSize, pagination.offset);

    res.json({ success: true, data: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, bottles } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/bottles/:id(\\d+)', adminAuth, async (req, res) => {
  try {
    const bottle = await db.prepare(`
      SELECT b.*, m.home_team, m.away_team,
             COALESCE(NULLIF(u.username, ''), 'ball_fan_1') as author_username,
             COALESCE(NULLIF(u.nickname, ''), '球迷小明') as author_nickname,
             (SELECT COUNT(*) FROM user_picks WHERE bottle_id = b.id) as pick_count
      FROM bottles b
      LEFT JOIN matches m ON b.match_id = m.id
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.id = ?
    `).get(req.params.id);

    if (!bottle) return res.status(404).json({ success: false, error: '漂流瓶不存在' });

    const replies = await db.prepare(`
      SELECT r.*,
             COALESCE(NULLIF(u.username, ''), 'ball_fan_1') as username,
             COALESCE(NULLIF(u.nickname, ''), '球迷小明') as nickname,
             COALESCE(NULLIF(u.avatar, ''), '⚽') as avatar
      FROM bottle_replies r
      LEFT JOIN users u ON r.user_id = u.id
      WHERE r.bottle_id = ?
      ORDER BY r.created_at ASC
    `).all(req.params.id);

    res.json({ success: true, data: { bottle, replies } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/bottles/:id(\\d+)', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.prepare('SELECT * FROM bottles WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ success: false, error: '漂流瓶不存在' });

    await db.transaction(async () => {
      await db.prepare('DELETE FROM bottle_replies WHERE bottle_id = ?').run(id);
      await db.prepare('DELETE FROM user_picks WHERE bottle_id = ?').run(id);
      await db.prepare('DELETE FROM bottles WHERE id = ?').run(id);
    })();

    await logAction(req.admin, '删除漂流瓶', 'bottle', id, { content: existing.content.substring(0, 30) });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/bottles/stats', adminAuth, async (req, res) => {
  try {
    const typeDist = await db.prepare('SELECT type, COUNT(*) as count FROM bottles GROUP BY type ORDER BY count DESC').all();
    const dailyTrend = await db.prepare(`
      SELECT DATE(created_at) as day, COUNT(*) as count
      FROM bottles WHERE created_at >= DATE('now', '-13 days')
      GROUP BY day ORDER BY day ASC
    `).all();
    res.json({ success: true, data: { typeDist, dailyTrend } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 用户管理 ----

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    await recomputeCorrectVotes();
    const requestedPagination = normalizeAdminPagination(req.query, 20);
    const total = await getSingleValue("SELECT COUNT(*) as c FROM users WHERE username IS NOT NULL AND username != ''");
    const pagination = clampAdminPagination(total, requestedPagination);
    const users = await db.prepare(`
      SELECT u.id, u.nickname, u.username, u.avatar, u.level, u.is_setup, u.is_preset, u.created_at,
        (SELECT COUNT(*) FROM votes WHERE user_id = u.id) as total_votes,
        (
          SELECT COUNT(*)
          FROM votes v
          JOIN matches m ON v.match_id = m.id
          WHERE v.user_id = u.id
            AND m.status = 'ended'
            AND m.home_score IS NOT NULL
            AND m.away_score IS NOT NULL
            AND v.choice = CASE
              WHEN m.home_score > m.away_score THEN 'home'
              WHEN m.home_score < m.away_score THEN 'away'
              ELSE 'draw'
            END
        ) as correct_votes,
        (SELECT COUNT(*) FROM bottles WHERE user_id = u.id) as total_bottles,
        (SELECT COUNT(*) FROM user_picks WHERE user_id = u.id) as total_picks
      FROM users u
      WHERE u.username IS NOT NULL AND u.username != ''
      ORDER BY total_votes DESC, u.created_at DESC LIMIT ? OFFSET ?
    `).all(pagination.pageSize, pagination.offset);
    res.json({ success: true, data: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, users } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除未注册用户（is_setup=0 且非预设）
app.delete('/api/admin/users/unregistered', adminAuth, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: '仅超级管理员可操作' });
    }
    const count = await getSingleValue("SELECT COUNT(*) as c FROM users WHERE is_setup = 0 AND is_preset = 0");

    await db.transaction(async () => {
      await db.prepare(`
        DELETE FROM bottle_replies
        WHERE user_id IN (SELECT id FROM users WHERE is_setup = 0 AND is_preset = 0)
           OR bottle_id IN (SELECT id FROM bottles WHERE user_id IN (SELECT id FROM users WHERE is_setup = 0 AND is_preset = 0))
      `).run();
      await db.prepare(`
        DELETE FROM user_picks
        WHERE user_id IN (SELECT id FROM users WHERE is_setup = 0 AND is_preset = 0)
           OR bottle_id IN (SELECT id FROM bottles WHERE user_id IN (SELECT id FROM users WHERE is_setup = 0 AND is_preset = 0))
      `).run();
      await db.prepare('DELETE FROM votes WHERE user_id IN (SELECT id FROM users WHERE is_setup = 0 AND is_preset = 0)').run();
      await db.prepare('DELETE FROM bottles WHERE user_id IN (SELECT id FROM users WHERE is_setup = 0 AND is_preset = 0)').run();
      await db.prepare('DELETE FROM users WHERE is_setup = 0 AND is_preset = 0').run();
    })();

    await recomputeVoteStats();
    await recomputeCorrectVotes();
    await logAction(req.admin, '批量删除未注册用户', 'user', null, { count });
    res.json({ success: true, data: { deleted: count } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await recomputeCorrectVotes(id);
    const user = await db.prepare('SELECT id, nickname, username, avatar, level, total_votes, correct_votes, total_bottles, is_setup, is_preset, created_at FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });
    const stats = await getComputedUserStats(id);

    const votes = await db.prepare(`
      SELECT v.choice, v.created_at, m.home_team, m.away_team, m.home_flag, m.away_flag
      FROM votes v JOIN matches m ON v.match_id = m.id
      WHERE v.user_id = ? ORDER BY v.created_at DESC LIMIT 20
    `).all(id);

    const bottles = await db.prepare(`
      SELECT b.type, b.content, b.created_at FROM bottles b
      WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 10
    `).all(id);

    res.json({ success: true, data: { user: { ...user, ...stats }, votes, bottles } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/users/:id/data', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.prepare('SELECT id, username FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });

    await db.transaction(async () => {
      await db.prepare(`
        DELETE FROM bottle_replies
        WHERE user_id = ?
           OR bottle_id IN (SELECT id FROM bottles WHERE user_id = ?)
      `).run(id, id);
      await db.prepare(`
        DELETE FROM user_picks
        WHERE user_id = ?
           OR bottle_id IN (SELECT id FROM bottles WHERE user_id = ?)
      `).run(id, id);
      await db.prepare('DELETE FROM votes WHERE user_id = ?').run(id);
      await db.prepare('DELETE FROM bottles WHERE user_id = ?').run(id);
      await db.prepare(`
        UPDATE users SET total_votes = 0, correct_votes = 0, total_bottles = 0
        WHERE id = ?
      `).run(id);
    })();

    await recomputeVoteStats();
    await recomputeCorrectVotes(id);
    await logAction(req.admin, '清空用户数据', 'user', id, { username: user.username });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 管理员修改用户信息
app.put('/api/admin/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, password, nickname, avatar } = req.body;

    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ success: false, error: '用户不存在' });

    if (username && username !== user.username) {
      const conflict = await db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, id);
      if (conflict) {
        return res.status(400).json({ success: false, error: '用户名已被其他用户使用，请换一个' });
      }
    }

    const updates = [];
    const params = [];
    if (username !== undefined && username !== '') { updates.push('username = ?'); params.push(username); }
    if (password !== undefined && password !== '') {
      if (password.length < 6) return res.status(400).json({ success: false, error: '密码至少6位' });
      updates.push('password_hash = ?'); params.push(sha256(password));
    }
    if (nickname !== undefined && nickname !== '') { updates.push('nickname = ?'); params.push(nickname); }
    if (avatar !== undefined && avatar !== '') { updates.push('avatar = ?'); params.push(avatar); }

    if (updates.length === 0) return res.status(400).json({ success: false, error: '没有要修改的内容' });

    params.push(id);
   await db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    await logAction(req.admin, '修改用户信息', 'user', id, { userId: id, fields: Object.keys(req.body).filter(k => k !== 'password') });
    res.json({ success: true });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '用户名已被使用' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 操作日志 ----

app.get('/api/admin/logs', adminAuth, async (req, res) => {
  try {
    const { action } = req.query;
    const requestedPagination = normalizeAdminPagination(req.query, 20);
    let where = '';
    const params = [];
    if (action) { where = 'WHERE action LIKE ?'; params.push(`%${action}%`); }

    const total = await getSingleValue(`SELECT COUNT(*) as c FROM admin_logs ${where}`, params);
    const pagination = clampAdminPagination(total, requestedPagination);
    const logs = await db.prepare(`
      SELECT * FROM admin_logs ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, pagination.pageSize, pagination.offset);

    res.json({ success: true, data: { total, page: pagination.page, pageSize: pagination.pageSize, totalPages: pagination.totalPages, logs } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---- 管理员账号管理 ----

app.get('/api/admin/admins', adminAuth, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: '仅超级管理员可操作' });
    }
    const admins = await db.prepare('SELECT id, username, phone, role, created_at, last_login FROM admins').all();
    res.json({ success: true, data: admins });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/admins', adminAuth, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: '仅超级管理员可操作' });
    }

    const { username, password, phone } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }

    const result = await db.prepare(`
      INSERT INTO admins (username, password_hash, phone, role) VALUES (?, ?, ?, 'admin')
    `).run(username, sha256(password), phone || null);

    await logAction(req.admin, '新增管理员', 'admin', result.lastInsertRowid, { username, phone });
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (error) {
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(400).json({ success: false, error: '用户名或手机号已存在' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/admin/admins/:id', adminAuth, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin' && req.admin.id !== parseInt(req.params.id)) {
      return res.status(403).json({ success: false, error: '无权限修改其他管理员' });
    }

    const { password, username } = req.body;
    const updates = [];
    const params = [];

    if (username) { updates.push('username = ?'); params.push(username); }
    if (password) { updates.push('password_hash = ?'); params.push(sha256(password)); }
    if (!updates.length) return res.status(400).json({ success: false, error: '没有要修改的内容' });

    params.push(req.params.id);
   await db.prepare(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    await logAction(req.admin, '修改管理员信息', 'admin', req.params.id, { fields: updates });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/admin/admins/:id', adminAuth, async (req, res) => {
  try {
    if (req.admin.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: '仅超级管理员可操作' });
    }
    if (req.admin.id === parseInt(req.params.id)) {
      return res.status(400).json({ success: false, error: '不能删除自己' });
    }

   await db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
    await logAction(req.admin, '删除管理员', 'admin', req.params.id, {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.use((error, req, res, next) => {
  console.error('请求处理失败:', error);
  res.status(500).json({
    success: false,
    error: error.message || 'Internal Server Error'
  });
});

// ==================== 启动服务器 ====================

if (require.main === module) {
  // 本地常驻服务可以定时刷新；Vercel Serverless 由请求触发刷新。
  setInterval(() => {
    autoUpdateMatchStatus().catch(error => console.error('状态更新失败:', error.message));
  }, 60 * 1000);

  app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log(`🔧 管理后台: http://localhost:${PORT}/admin.html`);
    autoUpdateMatchStatus().catch(error => console.error('状态更新失败:', error.message));
  });
}

module.exports = app;
