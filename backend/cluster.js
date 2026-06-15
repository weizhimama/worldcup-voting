const cluster = require('cluster');
const os      = require('os');

const WORKERS = Math.min(os.cpus().length, 4); // 最多4个，避免 SQLite 写争用

if (cluster.isMaster) {
  console.log(`🚀 主进程 PID=${process.pid}，派生 ${WORKERS} 个工作进程`);

  for (let i = 0; i < WORKERS; i++) cluster.fork();

  cluster.on('exit', (worker, code) => {
    console.log(`⚠️  工作进程 PID=${worker.process.pid} 退出 (code=${code})，重启中...`);
    cluster.fork();
  });
} else {
  require('./server');
  console.log(`✅ 工作进程 PID=${process.pid} 已就绪`);
}
