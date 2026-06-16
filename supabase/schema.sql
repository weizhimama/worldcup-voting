CREATE TABLE IF NOT EXISTS matches (
  id BIGSERIAL PRIMARY KEY,
  group_name TEXT NOT NULL,
  round TEXT NOT NULL,
  home_team TEXT NOT NULL,
  home_flag TEXT NOT NULL DEFAULT '',
  home_rank INTEGER,
  away_team TEXT NOT NULL,
  away_flag TEXT NOT NULL DEFAULT '',
  away_rank INTEGER,
  match_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'upcoming',
  home_score INTEGER,
  away_score INTEGER,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS votes (
  id BIGSERIAL PRIMARY KEY,
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('home', 'draw', 'away')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(match_id, user_id)
);

CREATE TABLE IF NOT EXISTS vote_stats (
  match_id BIGINT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
  home_votes INTEGER DEFAULT 0,
  draw_votes INTEGER DEFAULT 0,
  away_votes INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bottles (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('support', 'predict', 'chat', 'meet')),
  content TEXT NOT NULL,
  match_id BIGINT REFERENCES matches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bottle_replies (
  id BIGSERIAL PRIMARY KEY,
  bottle_id BIGINT NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

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
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_picks (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  bottle_id BIGINT NOT NULL REFERENCES bottles(id) ON DELETE CASCADE,
  pick_date DATE NOT NULL,
  picked_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admins (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT UNIQUE,
  role TEXT DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id BIGSERIAL PRIMARY KEY,
  admin_id BIGINT,
  admin_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO admins (username, password_hash, role)
VALUES ('admin', 'a303ea67e5fce9601cace5fbc1ea0ae6d37d232302341862b077eea1a680a03b', 'superadmin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO users (id, username, password_hash, nickname, avatar, is_setup, is_preset)
VALUES
  ('preset-user-001', 'ball_fan_1', 'b3dd2c3a80c0b5f96e74d8795dc503af57d4ca5f1c888f9e86c8bc039739a8ed', '球迷小明', '⚽', 1, 1),
  ('preset-user-002', 'ball_fan_2', '25cf408122b67323a7f99df429922bd9a154067d9f094e2d3cfd6e48d21a4691', '球迷小红', '🏆', 1, 1),
  ('preset-user-003', 'ball_fan_3', 'f60f0fff94d9e5d16d4bf2984355a47f4f486fb8fa391fa240fa7197a6d62ac4', '球迷小刚', '🌟', 1, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO matches
(group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time, status, home_score, away_score)
VALUES
  ('A组', '第1轮', '墨西哥', '🇲🇽', 15, '南非', '🇿🇦', 58, CURRENT_TIMESTAMP - INTERVAL '120 hours', CURRENT_TIMESTAMP - INTERVAL '118 hours', 'ended', 2, 1),
  ('A组', '第1轮', '美国', '🇺🇸', 4, '加拿大', '🇨🇦', 45, CURRENT_TIMESTAMP - INTERVAL '96 hours', CURRENT_TIMESTAMP - INTERVAL '94 hours', 'ended', 1, 1),
  ('B组', '第1轮', '德国', '🇩🇪', 16, '日本', '🇯🇵', 15, CURRENT_TIMESTAMP - INTERVAL '72 hours', CURRENT_TIMESTAMP - INTERVAL '70 hours', 'ended', 1, 2),
  ('B组', '第1轮', '葡萄牙', '🇵🇹', 6, '加纳', '🇬🇭', 61, CURRENT_TIMESTAMP - INTERVAL '48 hours', CURRENT_TIMESTAMP - INTERVAL '46 hours', 'ended', 3, 2),
  ('C组', '第1轮', '阿根廷', '🇦🇷', 1, '沙特阿拉伯', '🇸🇦', 56, CURRENT_TIMESTAMP - INTERVAL '36 hours', CURRENT_TIMESTAMP - INTERVAL '34 hours', 'ended', 1, 2),
  ('C组', '第1轮', '法国', '🇫🇷', 2, '澳大利亚', '🇦🇺', 27, CURRENT_TIMESTAMP - INTERVAL '24 hours', CURRENT_TIMESTAMP - INTERVAL '22 hours', 'ended', 4, 1),
  ('D组', '第1轮', '巴西', '🇧🇷', 5, '摩洛哥', '🇲🇦', 14, CURRENT_TIMESTAMP - INTERVAL '90 minutes', CURRENT_TIMESTAMP + INTERVAL '30 minutes', 'live', NULL, NULL),
  ('D组', '第1轮', '荷兰', '🇳🇱', 8, '厄瓜多尔', '🇪🇨', 43, CURRENT_TIMESTAMP - INTERVAL '48 minutes', CURRENT_TIMESTAMP + INTERVAL '72 minutes', 'live', NULL, NULL),
  ('E组', '第1轮', '西班牙', '🇪🇸', 7, '哥斯达黎加', '🇨🇷', 42, CURRENT_TIMESTAMP - INTERVAL '18 minutes', CURRENT_TIMESTAMP + INTERVAL '102 minutes', 'live', NULL, NULL),
  ('E组', '第1轮', '英格兰', '🏴', 4, '伊朗', '🇮🇷', 22, CURRENT_TIMESTAMP + INTERVAL '2 hours', CURRENT_TIMESTAMP + INTERVAL '4 hours', 'upcoming', NULL, NULL),
  ('F组', '第1轮', '比利时', '🇧🇪', 3, '加拿大', '🇨🇦', 41, CURRENT_TIMESTAMP + INTERVAL '5 hours', CURRENT_TIMESTAMP + INTERVAL '7 hours', 'upcoming', NULL, NULL),
  ('F组', '第1轮', '克罗地亚', '🇭🇷', 9, '摩洛哥', '🇲🇦', 22, CURRENT_TIMESTAMP + INTERVAL '8 hours', CURRENT_TIMESTAMP + INTERVAL '10 hours', 'upcoming', NULL, NULL),
  ('G组', '第1轮', '巴西', '🇧🇷', 5, '塞尔维亚', '🇷🇸', 21, CURRENT_TIMESTAMP + INTERVAL '12 hours', CURRENT_TIMESTAMP + INTERVAL '14 hours', 'upcoming', NULL, NULL),
  ('G组', '第1轮', '瑞士', '🇨🇭', 13, '喀麦隆', '🇨🇲', 43, CURRENT_TIMESTAMP + INTERVAL '15 hours', CURRENT_TIMESTAMP + INTERVAL '17 hours', 'upcoming', NULL, NULL),
  ('H组', '第1轮', '葡萄牙', '🇵🇹', 6, '乌拉圭', '🇺🇾', 14, CURRENT_TIMESTAMP + INTERVAL '20 hours', CURRENT_TIMESTAMP + INTERVAL '22 hours', 'upcoming', NULL, NULL),
  ('H组', '第1轮', '韩国', '🇰🇷', 28, '加纳', '🇬🇭', 60, CURRENT_TIMESTAMP + INTERVAL '26 hours', CURRENT_TIMESTAMP + INTERVAL '28 hours', 'upcoming', NULL, NULL)
ON CONFLICT DO NOTHING;

INSERT INTO vote_stats (match_id)
SELECT id FROM matches
ON CONFLICT (match_id) DO NOTHING;

INSERT INTO bottles (user_id, type, content, match_id)
SELECT 'system', 'support', '巴西必胜！希望能看到桑巴足球的精彩表演！', id FROM matches WHERE home_team = '巴西' LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO bottles (user_id, type, content, match_id)
VALUES
  ('system', 'chat', '这届世界杯时间对中国球迷太友好了！早上起来就能看！', NULL),
  ('system', 'meet', '北京阿根廷球迷集合！有人一起看决赛吗？', NULL)
ON CONFLICT DO NOTHING;
