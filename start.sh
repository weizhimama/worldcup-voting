#!/bin/bash

# 2026世界杯投票漂流瓶 - 启动脚本

echo "🏆 2026世界杯投票漂流瓶"
echo "========================"

# 优先使用 nvm 的 Node，避免系统 Node 版本冲突
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"

# 进入后端目录
cd "$(dirname "$0")/backend"

# 检查是否已安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 启动服务器
echo "🚀 启动服务器..."
echo ""
echo "用户端地址:   http://localhost:3000"
echo "管理后台:     http://localhost:3000/admin.html  (默认密码: worldcup-admin-2026)"
echo "按 Ctrl+C 停止服务器"
echo ""

# 使用 cluster 模式，自动利用多核 CPU 并发处理请求
node cluster.js
