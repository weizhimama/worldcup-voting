// 应用状态
const state = {
    currentPage: 'home',
    currentMatch: null,
    userVotes: JSON.parse(localStorage.getItem('userVotes') || '{}'),
    userBottles: JSON.parse(localStorage.getItem('userBottles') || '[]'),
    collectedBottles: JSON.parse(localStorage.getItem('collectedBottles') || '[]'),
    pickCount: parseInt(localStorage.getItem('pickCount') || '5'),
    lastPickDate: localStorage.getItem('lastPickDate') || ''
};

// 比赛数据（模拟2026世界杯数据）
const matches = [
    {
        id: 1,
        group: 'C组',
        round: '第1轮',
        homeTeam: { name: '巴西', flag: '🇧🇷', rank: 1 },
        awayTeam: { name: '摩洛哥', flag: '🇲🇦', rank: 12 },
        time: '2026-06-14 06:00',
        status: 'upcoming',
        votes: { home: 8234, draw: 1205, away: 3567 }
    },
    {
        id: 2,
        group: 'D组',
        round: '第1轮',
        homeTeam: { name: '美国', flag: '🇺🇸', rank: 5 },
        awayTeam: { name: '巴拉圭', flag: '🇵🇾', rank: 35 },
        time: '2026-06-13 09:00',
        status: 'upcoming',
        votes: { home: 6543, draw: 987, away: 2134 }
    },
    {
        id: 3,
        group: 'A组',
        round: '第1轮',
        homeTeam: { name: '墨西哥', flag: '🇲🇽', rank: 15 },
        awayTeam: { name: '南非', flag: '🇿🇦', rank: 58 },
        time: '2026-06-12 03:00',
        status: 'upcoming',
        votes: { home: 7654, draw: 1567, away: 1890 }
    },
    {
        id: 4,
        group: 'F组',
        round: '第1轮',
        homeTeam: { name: '荷兰', flag: '🇳🇱', rank: 7 },
        awayTeam: { name: '日本', flag: '🇯🇵', rank: 18 },
        time: '2026-06-14 09:00',
        status: 'upcoming',
        votes: { home: 5678, draw: 2345, away: 3456 }
    },
    {
        id: 5,
        group: 'E组',
        round: '第1轮',
        homeTeam: { name: '德国', flag: '🇩🇪', rank: 4 },
        awayTeam: { name: '厄瓜多尔', flag: '🇪🇨', rank: 42 },
        time: '2026-06-15 06:00',
        status: 'upcoming',
        votes: { home: 9123, draw: 876, away: 1234 }
    },
    {
        id: 6,
        group: 'G组',
        round: '第1轮',
        homeTeam: { name: '比利时', flag: '🇧🇪', rank: 6 },
        awayTeam: { name: '伊朗', flag: '🇮🇷', rank: 22 },
        time: '2026-06-15 09:00',
        status: 'upcoming',
        votes: { home: 6789, draw: 1234, away: 2567 }
    }
];

// 漂流瓶类型
const bottleTypes = {
    support: { icon: '🏳️', name: '支持宣言' },
    predict: { icon: '🎯', name: '比分预测' },
    chat: { icon: '💬', name: '闲聊祝福' },
    meet: { icon: '🍀', name: '遇见有缘' }
};

// 示例漂流瓶数据
const sampleBottles = [
    {
        id: 1,
        type: 'support',
        content: '巴西必胜！内马尔这次要证明自己！希望能看到桑巴足球的精彩表演！',
        matchId: 1,
        time: '2026-06-13 20:30'
    },
    {
        id: 2,
        type: 'predict',
        content: '我猜这场会是2:1，巴西小胜。摩洛哥防守很强，但巴西攻击线太豪华了。',
        matchId: 1,
        time: '2026-06-13 19:15'
    },
    {
        id: 3,
        type: 'chat',
        content: '这届世界杯时间对中国球迷太友好了！不用熬夜看球，早上起来就能看！',
        matchId: null,
        time: '2026-06-13 18:00'
    },
    {
        id: 4,
        type: 'meet',
        content: '北京阿根廷球迷集合！有人一起看决赛吗？',
        matchId: null,
        time: '2026-06-13 17:30'
    },
    {
        id: 5,
        type: 'support',
        content: '日本队加油！亚洲足球的骄傲！希望能再创奇迹！',
        matchId: 4,
        time: '2026-06-13 16:45'
    }
];

// 初始化
function init() {
    updateDate();
    renderMatches();
    updateStats();
    checkPickCountReset();
    initBottleSelect();
}

// 更新日期显示
function updateDate() {
    const today = new Date();
    const options = { month: 'long', day: 'numeric', weekday: 'long' };
    document.getElementById('today-date').textContent = today.toLocaleDateString('zh-CN', options);
}

// 渲染比赛列表
function renderMatches() {
    const container = document.getElementById('match-list');
    container.innerHTML = matches.map(match => {
        const voted = state.userVotes[match.id];
        const totalVotes = match.votes.home + match.votes.draw + match.votes.away;
        const homePercent = ((match.votes.home / totalVotes) * 100).toFixed(1);
        const drawPercent = ((match.votes.draw / totalVotes) * 100).toFixed(1);
        const awayPercent = ((match.votes.away / totalVotes) * 100).toFixed(1);
        
        const statusText = {
            upcoming: '即将开始',
            live: '进行中',
            ended: '已结束'
        };
        
        return `
            <div class="match-card ${voted ? 'voted' : ''}" onclick="showMatchDetail(${match.id})">
                <div class="match-header">
                    <span class="match-time">⏰ ${match.time.split(' ')[1]}</span>
                    <span class="match-status ${match.status}">${statusText[match.status]}</span>
                </div>
                <div class="teams">
                    <div class="team-brief">
                        <div class="team-flag">${match.homeTeam.flag}</div>
                        <div class="team-name">${match.homeTeam.name}</div>
                    </div>
                    <div class="vs">VS</div>
                    <div class="team-brief">
                        <div class="team-flag">${match.awayTeam.flag}</div>
                        <div class="team-name">${match.awayTeam.name}</div>
                    </div>
                </div>
                ${voted ? `
                    <div class="vote-preview">
                        <div class="vote-bar-mini">
                            <div class="home" style="width: ${homePercent}%"></div>
                            <div class="draw" style="width: ${drawPercent}%"></div>
                            <div class="away" style="width: ${awayPercent}%"></div>
                        </div>
                        <div class="vote-labels">
                            <span>${homePercent}%</span>
                            <span>${drawPercent}%</span>
                            <span>${awayPercent}%</span>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
}

// 显示比赛详情
function showMatchDetail(matchId) {
    const match = matches.find(m => m.id === matchId);
    if (!match) return;
    
    state.currentMatch = match;
    
    // 更新详情页内容
    document.getElementById('detail-group').textContent = `${match.group} ${match.round}`;
    document.getElementById('detail-time').textContent = `⏰ ${match.time}`;
    
    // 更新队伍信息
    const homeTeamEl = document.getElementById('team-home');
    homeTeamEl.querySelector('.team-flag').textContent = match.homeTeam.flag;
    homeTeamEl.querySelector('.team-name').textContent = match.homeTeam.name;
    homeTeamEl.querySelector('.team-rank').textContent = `世界排名 #${match.homeTeam.rank}`;
    
    const awayTeamEl = document.getElementById('team-away');
    awayTeamEl.querySelector('.team-flag').textContent = match.awayTeam.flag;
    awayTeamEl.querySelector('.team-name').textContent = match.awayTeam.name;
    awayTeamEl.querySelector('.team-rank').textContent = `世界排名 #${match.awayTeam.rank}`;
    
    // 更新投票按钮文字
    document.querySelector('.vote-home').innerHTML = `
        <span class="team-flag-small">${match.homeTeam.flag}</span>
        <span>投${match.homeTeam.name}</span>
    `;
    document.querySelector('.vote-away').innerHTML = `
        <span class="team-flag-small">${match.awayTeam.flag}</span>
        <span>投${match.awayTeam.name}</span>
    `;
    
    // 检查是否已投票
    const voted = state.userVotes[match.id];
    if (voted) {
        document.getElementById('voting-section').style.display = 'none';
        document.getElementById('vote-result-section').style.display = 'block';
        updateVoteStats(match, voted);
    } else {
        document.getElementById('voting-section').style.display = 'block';
        document.getElementById('vote-result-section').style.display = 'none';
    }
    
    // 加载相关漂流瓶
    loadMatchBottles(matchId);
    
    showPage('match-detail');
}

// 更新投票统计
function updateVoteStats(match, userVote) {
    const totalVotes = match.votes.home + match.votes.draw + match.votes.away;
    const homePercent = ((match.votes.home / totalVotes) * 100).toFixed(1);
    const drawPercent = ((match.votes.draw / totalVotes) * 100).toFixed(1);
    const awayPercent = ((match.votes.away / totalVotes) * 100).toFixed(1);
    
    document.getElementById('home-percent').textContent = `${homePercent}%`;
    document.getElementById('draw-percent').textContent = `${drawPercent}%`;
    document.getElementById('away-percent').textContent = `${awayPercent}%`;
    
    document.getElementById('home-bar').style.width = `${homePercent}%`;
    document.getElementById('draw-bar').style.width = `${drawPercent}%`;
    document.getElementById('away-bar').style.width = `${awayPercent}%`;
    
    document.getElementById('home-count').textContent = `${match.votes.home.toLocaleString()} 票`;
    document.getElementById('draw-count').textContent = `${match.votes.draw.toLocaleString()} 票`;
    document.getElementById('away-count').textContent = `${match.votes.away.toLocaleString()} 票`;
    
    const voteText = {
        home: match.homeTeam.name,
        draw: '平局',
        away: match.awayTeam.name
    };
    document.getElementById('my-vote').innerHTML = `✅ 你投给了 <strong>${voteText[userVote]}</strong>`;
}

// 投票
function vote(choice) {
    if (!state.currentMatch) return;
    
    const match = state.currentMatch;
    
    // 模拟投票
    match.votes[choice]++;
    state.userVotes[match.id] = choice;
    
    // 保存到本地存储
    localStorage.setItem('userVotes', JSON.stringify(state.userVotes));
    
    // 更新UI
    document.getElementById('voting-section').style.display = 'none';
    document.getElementById('vote-result-section').style.display = 'block';
    updateVoteStats(match, choice);
    
    // 更新统计数据
    updateStats();
    
    // 显示成功提示
    showToast('投票成功！');
}

// 加载比赛相关漂流瓶
function loadMatchBottles(matchId) {
    const container = document.getElementById('match-bottles');
    const relatedBottles = sampleBottles.filter(b => b.matchId === matchId);
    
    if (relatedBottles.length === 0) {
        container.innerHTML = '<p class="empty-tip">暂无漂流瓶，来投一个吧！</p>';
        return;
    }
    
    container.innerHTML = relatedBottles.map(bottle => `
        <div class="bottle-item">
            <div class="bottle-item-header">
                <span class="bottle-type-tag">${bottleTypes[bottle.type].icon} ${bottleTypes[bottle.type].name}</span>
                <span>${bottle.time}</span>
            </div>
            <div class="bottle-item-content">${bottle.content}</div>
        </div>
    `).join('');
}

// 页面切换
function showPage(pageName) {
    state.currentPage = pageName;
    
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // 显示目标页面
    const pageId = pageName === 'match-detail' ? 'match-detail-page' : `${pageName}-page`;
    document.getElementById(pageId).classList.add('active');
    
    // 更新导航状态
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const navMap = {
        'home': 0,
        'bottle': 1,
        'profile': 2
    };
    
    if (navMap[pageName] !== undefined) {
        document.querySelectorAll('.nav-item')[navMap[pageName]].classList.add('active');
    }
    
    // 如果是个人中心，更新数据
    if (pageName === 'profile') {
        updateProfileStats();
    }
}

// 更新统计
function updateStats() {
    const totalVotes = Object.keys(state.userVotes).length;
    const totalBottles = state.userBottles.length + state.collectedBottles.length;
    
    document.getElementById('total-votes').textContent = totalVotes;
    document.getElementById('total-bottles').textContent = totalBottles;
}

// 更新个人中心统计
function updateProfileStats() {
    const votes = Object.keys(state.userVotes).length;
    document.getElementById('my-votes').textContent = votes;
    document.getElementById('my-correct').textContent = Math.floor(votes * 0.6); // 模拟准确率
    document.getElementById('my-accuracy').textContent = votes > 0 ? '60%' : '0%';
    document.getElementById('my-bottles-count').textContent = state.userBottles.length + state.collectedBottles.length;
}

// 显示投瓶弹窗
function showThrowModal() {
    document.getElementById('throw-modal').classList.add('show');
    document.getElementById('bottle-content').value = '';
    document.getElementById('char-count').textContent = '0';
}

// 关闭弹窗
function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// 选择瓶子类型
function selectBottleType(btn) {
    document.querySelectorAll('.bottle-type').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

// 初始化漂流瓶比赛选择
function initBottleSelect() {
    const select = document.getElementById('bottle-match');
    select.innerHTML = '<option value="">不关联</option>' + 
        matches.map(m => `<option value="${m.id}">${m.homeTeam.name} vs ${m.awayTeam.name}</option>`).join('');
}

// 投放漂流瓶
function throwBottle() {
    const content = document.getElementById('bottle-content').value.trim();
    if (!content) {
        showToast('请输入内容');
        return;
    }
    
    const type = document.querySelector('.bottle-type.active').dataset.type;
    const matchId = document.getElementById('bottle-match').value;
    
    const bottle = {
        id: Date.now(),
        type,
        content,
        matchId: matchId ? parseInt(matchId) : null,
        time: new Date().toLocaleString('zh-CN'),
        replies: []
    };
    
    state.userBottles.push(bottle);
    localStorage.setItem('userBottles', JSON.stringify(state.userBottles));
    
    closeModal('throw-modal');
    showToast('瓶子已投入海洋！');
    updateStats();
    renderMyBottles('thrown');
}

// 收瓶
function pickBottle() {
    if (state.pickCount <= 0) {
        showToast('今日收瓶次数已用完');
        return;
    }
    
    // 随机选择一个瓶子
    const randomBottle = sampleBottles[Math.floor(Math.random() * sampleBottles.length)];
    
    // 显示收瓶弹窗
    document.getElementById('picked-type').textContent = `${bottleTypes[randomBottle.type].icon} ${bottleTypes[randomBottle.type].name}`;
    document.getElementById('picked-content').textContent = randomBottle.content;
    document.getElementById('picked-time').textContent = randomBottle.time;
    
    // 保存到已收集
    state.collectedBottles.push(randomBottle);
    localStorage.setItem('collectedBottles', JSON.stringify(state.collectedBottles));
    
    // 更新收瓶次数
    state.pickCount--;
    localStorage.setItem('pickCount', state.pickCount);
    localStorage.setItem('lastPickDate', new Date().toDateString());
    document.getElementById('pick-count').textContent = state.pickCount;
    
    document.getElementById('pick-modal').classList.add('show');
    updateStats();
}

// 回复漂流瓶
function replyBottle() {
    showToast('回复功能开发中...');
    closeModal('pick-modal');
}

// 切换瓶子标签
function switchBottleTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    renderMyBottles(tab);
}

// 渲染我的瓶子
function renderMyBottles(tab) {
    const container = document.getElementById('my-bottle-list');
    const bottles = tab === 'thrown' ? state.userBottles : state.collectedBottles;
    
    if (bottles.length === 0) {
        container.innerHTML = `<p class="empty-tip">${tab === 'thrown' ? '还没有投出过瓶子' : '还没有收到过瓶子'}</p>`;
        return;
    }
    
    container.innerHTML = bottles.map(bottle => `
        <div class="bottle-item">
            <div class="bottle-item-header">
                <span class="bottle-type-tag">${bottleTypes[bottle.type].icon} ${bottleTypes[bottle.type].name}</span>
                <span>${bottle.time}</span>
            </div>
            <div class="bottle-item-content">${bottle.content}</div>
        </div>
    `).join('');
}

// 检查并重置收瓶次数
function checkPickCountReset() {
    const today = new Date().toDateString();
    if (state.lastPickDate !== today) {
        state.pickCount = 5;
        localStorage.setItem('pickCount', '5');
        localStorage.setItem('lastPickDate', today);
    }
    document.getElementById('pick-count').textContent = state.pickCount;
}

// 显示提示
function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        padding: 15px 30px;
        border-radius: 10px;
        z-index: 2000;
        animation: fadeIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 2000);
}

// 字数统计
document.addEventListener('DOMContentLoaded', () => {
    init();
    
    const textarea = document.getElementById('bottle-content');
    if (textarea) {
        textarea.addEventListener('input', (e) => {
            document.getElementById('char-count').textContent = e.target.value.length;
        });
    }
});

// 点击弹窗外部关闭
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
    }
});
