const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'worldcup.db'));

// 开启WAL模式，提升并发性能
db.pragma('journal_mode = WAL');

// ==================== 建表 ====================

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT NOT NULL,
    round TEXT NOT NULL,
    home_team TEXT NOT NULL,
    home_flag TEXT NOT NULL DEFAULT '',
    home_rank INTEGER,
    away_team TEXT NOT NULL,
    away_flag TEXT NOT NULL DEFAULT '',
    away_rank INTEGER,
    match_time DATETIME NOT NULL,
    end_time DATETIME,
    status TEXT DEFAULT 'upcoming',
    home_score INTEGER,
    away_score INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    choice TEXT NOT NULL CHECK(choice IN ('home', 'draw', 'away')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(match_id, user_id),
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS vote_stats (
    match_id INTEGER PRIMARY KEY,
    home_votes INTEGER DEFAULT 0,
    draw_votes INTEGER DEFAULT 0,
    away_votes INTEGER DEFAULT 0,
    total_votes INTEGER DEFAULT 0,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bottles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('support', 'predict', 'chat', 'meet')),
    content TEXT NOT NULL,
    match_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (match_id) REFERENCES matches(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS bottle_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bottle_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bottle_id) REFERENCES bottles(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT DEFAULT '足球爱好者',
    avatar TEXT DEFAULT '⚽',
    level INTEGER DEFAULT 1,
    total_votes INTEGER DEFAULT 0,
    correct_votes INTEGER DEFAULT 0,
    total_bottles INTEGER DEFAULT 0,
    username TEXT UNIQUE,
    password_hash TEXT,
    is_setup INTEGER DEFAULT 0,
    is_preset INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// 对已存在的表做兼容升级
try { db.exec(`ALTER TABLE users ADD COLUMN username TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_setup INTEGER DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_preset INTEGER DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE matches ADD COLUMN end_time DATETIME`); } catch(e) {}
try { db.exec(`
  CREATE TABLE IF NOT EXISTS bottle_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bottle_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bottle_id) REFERENCES bottles(id)
  )
`); } catch(e) {}

db.exec(`
  CREATE TABLE IF NOT EXISTS user_picks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    bottle_id INTEGER NOT NULL,
    pick_date TEXT NOT NULL,
    picked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bottle_id) REFERENCES bottles(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    phone TEXT UNIQUE,
    role TEXT DEFAULT 'admin',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    admin_name TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ==================== 初始化默认管理员 ====================

const initAdmins = db.transaction(() => {
  const crypto = require('crypto');
  const hash = (pwd) => crypto.createHash('sha256').update(pwd).digest('hex');

  const existing = db.prepare('SELECT COUNT(*) as c FROM admins').get().c;
  if (existing === 0) {
    db.prepare(`
      INSERT OR IGNORE INTO admins (username, password_hash, role)
      VALUES (?, ?, 'superadmin')
    `).run('admin', hash('worldcup-admin-2026'));
  }
});

// ==================== 初始化预设用户（3个） ====================

const initPresetUsers = db.transaction(() => {
  const crypto = require('crypto');
  const hash = (pwd) => crypto.createHash('sha256').update(pwd).digest('hex');

  const presets = [
    { id: 'preset-user-001', username: 'ball_fan_1',  nickname: '球迷小明', password: 'fan123456', avatar: '⚽' },
    { id: 'preset-user-002', username: 'ball_fan_2',  nickname: '球迷小红', password: 'fan234567', avatar: '🏆' },
    { id: 'preset-user-003', username: 'ball_fan_3',  nickname: '球迷小刚', password: 'fan345678', avatar: '🌟' },
  ];

  for (const u of presets) {
    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(u.id);
    if (!exists) {
      db.prepare(`
        INSERT INTO users (id, username, password_hash, nickname, avatar, is_setup, is_preset)
        VALUES (?, ?, ?, ?, ?, 1, 1)
      `).run(u.id, u.username, hash(u.password), u.nickname, u.avatar);
    }
  }
});

// ==================== 初始化比赛数据（含进行中/已结束/即将开始） ====================

// 清理无效比赛记录（home_team 或 away_team 为空/只有单字符的脏数据）
db.prepare(`
  DELETE FROM matches
  WHERE home_team IS NULL OR home_team = '' OR length(home_team) <= 1
     OR away_team IS NULL OR away_team = '' OR length(away_team) <= 1
`).run();

const initMatches = db.transaction(() => {
  const existing = db.prepare('SELECT COUNT(*) as c FROM matches').get().c;
  if (existing > 0) return;

  const now = new Date();
  const t = (offsetHours) => {
    const d = new Date(now.getTime() + offsetHours * 3600 * 1000);
    return d.toISOString().replace('T', ' ').substring(0, 19);
  };
  const te = (offsetHours) => t(offsetHours + 2);

  const matches = [
    // ===== 已结束 (6场) =====
    ['A组', '第1轮', '墨西哥',   '🇲🇽', 15, '南非',       '🇿🇦', 58, t(-120), te(-120), 'ended',   2, 1],
    ['A组', '第1轮', '美国',     '🇺🇸',  4,  '加拿大',     '🇨🇦', 45, t(-96),  te(-96),  'ended',   1, 1],
    ['B组', '第1轮', '德国',     '🇩🇪', 16,  '日本',       '🇯🇵', 15, t(-72),  te(-72),  'ended',   1, 2],
    ['B组', '第1轮', '葡萄牙',   '🇵🇹',  6,  '加纳',       '🇬🇭', 61, t(-48),  te(-48),  'ended',   3, 2],
    ['C组', '第1轮', '阿根廷',   '🇦🇷',  1,  '沙特阿拉伯', '🇸🇦', 56, t(-36),  te(-36),  'ended',   1, 2],
    ['C组', '第1轮', '法国',     '🇫🇷',  2,  '澳大利亚',   '🇦🇺', 27, t(-24),  te(-24),  'ended',   4, 1],
    // ===== 进行中 (3场) =====
    ['D组', '第1轮', '巴西',     '🇧🇷',  5,  '摩洛哥',     '🇲🇦', 14, t(-1.5), te(-1.5), 'live',    null, null],
    ['D组', '第1轮', '荷兰',     '🇳🇱',  8,  '厄瓜多尔',   '🇪🇨', 43, t(-0.8), te(-0.8), 'live',    null, null],
    ['E组', '第1轮', '西班牙',   '🇪🇸',  7,  '哥斯达黎加', '🇨🇷', 42, t(-0.3), te(-0.3), 'live',    null, null],
    // ===== 即将开始 (本周, 8场) =====
    ['E组', '第1轮', '英格兰',   '🏴󠁧󠁢󠁥󠁮󠁧󠁿',  4,  '伊朗',       '🇮🇷', 22, t(2),    te(2),    'upcoming',null, null],
    ['F组', '第1轮', '比利时',   '🇧🇪',  3,  '加拿大',     '🇨🇦', 41, t(5),    te(5),    'upcoming',null, null],
    ['F组', '第1轮', '克罗地亚', '🇭🇷',  9,  '摩洛哥',     '🇲🇦', 22, t(8),    te(8),    'upcoming',null, null],
    ['G组', '第1轮', '巴西',     '🇧🇷',  5,  '塞尔维亚',   '🇷🇸', 21, t(12),   te(12),   'upcoming',null, null],
    ['G组', '第1轮', '瑞士',     '🇨🇭', 13,  '喀麦隆',     '🇨🇲', 43, t(15),   te(15),   'upcoming',null, null],
    ['H组', '第1轮', '葡萄牙',   '🇵🇹',  6,  '乌拉圭',     '🇺🇾', 14, t(20),   te(20),   'upcoming',null, null],
    ['H组', '第1轮', '韩国',     '🇰🇷', 28,  '加纳',       '🇬🇭', 60, t(26),   te(26),   'upcoming',null, null],
    // ===== 下周场次 (6场) =====
    ['A组', '第2轮', '墨西哥',   '🇲🇽', 15,  '波兰',       '🇵🇱', 26, t(48),   te(48),   'upcoming',null, null],
    ['A组', '第2轮', '法国',     '🇫🇷',  2,  '丹麦',       '🇩🇰', 10, t(52),   te(52),   'upcoming',null, null],
    ['B组', '第2轮', '阿根廷',   '🇦🇷',  1,  '墨西哥',     '🇲🇽', 15, t(60),   te(60),   'upcoming',null, null],
    ['B组', '第2轮', '波兰',     '🇵🇱', 26,  '沙特阿拉伯', '🇸🇦', 56, t(64),   te(64),   'upcoming',null, null],
    ['C组', '第2轮', '英格兰',   '🏴󠁧󠁢󠁥󠁮󠁧󠁿',  4,  '美国',       '🇺🇸',  4, t(72),   te(72),   'upcoming',null, null],
    ['C组', '淘汰赛', '意大利',  '🇮🇹', 11,  '克罗地亚',   '🇭🇷',  9, t(96),   te(96),   'upcoming',null, null],
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO matches
    (group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time, status, home_score, away_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const match of matches) {
    stmt.run(...match);
  }
});

// ==================== 初始化投票统计 ====================

const initVoteStats = db.transaction(() => {
  const matches = db.prepare('SELECT id FROM matches').all();
  const stmt = db.prepare('INSERT OR IGNORE INTO vote_stats (match_id) VALUES (?)');
  for (const match of matches) {
    stmt.run(match.id);
  }
});

// ==================== 初始化示例漂流瓶 ====================

const initBottles = db.transaction(() => {
  const existing = db.prepare("SELECT COUNT(*) as c FROM bottles WHERE user_id='system'").get().c;
  if (existing > 0) return;

  const bottles = [
    ['system', 'support',  '巴西必胜！希望能看到桑巴足球的精彩表演！', 4],
    ['system', 'predict',  '我猜这场会是2:1，巴西小胜。摩洛哥防守很强，但巴西攻击线太豪华了。', 4],
    ['system', 'chat',     '这届世界杯时间对中国球迷太友好了！早上起来就能看！', null],
    ['system', 'meet',     '北京阿根廷球迷集合！有人一起看决赛吗？', null],
    ['system', 'support',  '日本队加油！亚洲足球的骄傲！', 3],
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO bottles (user_id, type, content, match_id)
    VALUES (?, ?, ?, ?)
  `);

  for (const bottle of bottles) {
    stmt.run(...bottle);
  }
});

// ==================== 执行初始化 ====================

try {
  initAdmins();
  initPresetUsers();
  initMatches();
  initVoteStats();
  initBottles();
  console.log('数据库初始化完成');
} catch (error) {
  console.error('数据库初始化失败:', error);
}

module.exports = db;
