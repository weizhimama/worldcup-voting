const db = require('../backend/db');
const { worldCup2026Schedule } = require('../backend/worldcup2026-schedule');
const hasPostgres = Boolean(process.env.DATABASE_URL);
const dbTime = (value) => hasPostgres ? `${value}+08` : value;

async function run() {
  await db.transaction(async () => {
    await db.prepare('DELETE FROM votes').run();
    await db.prepare('DELETE FROM vote_stats').run();
    await db.prepare('UPDATE users SET total_votes = 0, correct_votes = 0').run();
    await db.prepare('UPDATE bottles SET match_id = NULL').run();
    await db.prepare('DELETE FROM matches').run();
    if (!hasPostgres) {
      await db.prepare("DELETE FROM sqlite_sequence WHERE name = 'matches'").run();
    }

    const insertMatch = db.prepare(`
      INSERT INTO matches
      (group_name, round, home_team, home_flag, home_rank, away_team, away_flag, away_rank, match_time, end_time, status, home_score, away_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertStats = db.prepare('INSERT OR IGNORE INTO vote_stats (match_id) VALUES (?)');

    for (const match of worldCup2026Schedule) {
      const result = await insertMatch.run(
        match.groupName,
        match.round,
        match.homeTeam,
        match.homeFlag,
        null,
        match.awayTeam,
        match.awayFlag,
        null,
        dbTime(match.matchTime),
        dbTime(match.endTime),
        'upcoming',
        null,
        null
      );
      await insertStats.run(result.lastInsertRowid);
    }
  })();

  const count = await db.prepare('SELECT COUNT(*) as c FROM matches').get();
  console.log(`Synced ${count.c} World Cup 2026 matches from the Beijing-time schedule.`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
