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
