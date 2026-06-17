// API基础URL
const API_BASE = '/api';

// 应用状态
const state = {
    currentPage: 'home',
    currentMatch: null,
    userId: localStorage.getItem('userId') || null,
    user: null,
    matches: [],
    pickCount: 5,
    currentBottleId: null,   // 当前回复目标瓶子ID
    currentBottleTab: 'thrown',
    accountVersion: 0,
    isSwitchingAccount: false,
    pendingActions: new Set(),
    navigationReady: false,
    bottleInputReady: false
};

// 漂流瓶类型
const bottleTypes = {
    support: { icon: '🏳️', name: '支持宣言' },
    predict: { icon: '🎯', name: '比分预测' },
    chat:    { icon: '💬', name: '闲聊祝福' },
    meet:    { icon: '🍀', name: '遇见有缘' }
};

// ==================== API请求封装 ====================

async function apiRequest(endpoint, options = {}) {
    try {
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        const requestUserId = state.userId;
        if (state.userId) headers['X-User-Id'] = state.userId;

        const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
        const data = await response.json();

        const newUserId = response.headers.get('X-User-Id');
        const canAdoptUserId = state.userId === requestUserId || (!state.userId && !requestUserId);
        if (newUserId && newUserId !== state.userId && canAdoptUserId) {
            state.userId = newUserId;
            localStorage.setItem('userId', newUserId);
        }
        return data;
    } catch (error) {
        console.error('API请求失败:', error);
        return { success: false, error: error.message };
    }
}

function captureAccountVersion() {
    return state.accountVersion;
}

function isFreshAccount(version) {
    return version === state.accountVersion;
}

function isActionPending(key) {
    return state.pendingActions.has(key);
}

function setActionPending(key, pending) {
    if (pending) state.pendingActions.add(key);
    else state.pendingActions.delete(key);
}

function setBottleTabActive(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${tab}`);
    if (tabEl) tabEl.classList.add('active');
}

function resetAccountScopedUI(preferredBottleTab = 'thrown') {
    state.currentMatch = null;
    state.currentBottleId = null;
    state.matches = [];
    state.pickCount = 5;
    state.currentBottleTab = preferredBottleTab;
    updateElement('sidebar-votes', 0);
    updateElement('sidebar-bottles', 0);
    updateElement('pick-count', 5);
    updateElement('my-votes', 0);
    updateElement('my-correct', 0);
    updateElement('my-accuracy', '0%');
    updateElement('my-bottles-count', 0);
    updateElement('my-bottle-list', '');
    const matchList = document.getElementById('match-list');
    if (matchList) matchList.innerHTML = '<p class="empty-tip">加载中...</p>';
    const bottleList = document.getElementById('my-bottle-list');
    if (bottleList) bottleList.innerHTML = '<p class="empty-tip">加载中...</p>';
    setBottleTabActive(preferredBottleTab);
}

async function refreshAccountData(targetPage = state.currentPage, matchId = state.currentMatch?.id) {
    const version = captureAccountVersion();
    await Promise.all([
        loadGlobalStats(version),
        loadMatches(version),
        loadPickCount(version),
        loadOceanBottleCount(version)
    ]);
    if (!isFreshAccount(version)) return;
    loadProfileHeader();
    updateSidebarUser();
    if (targetPage === 'profile') await loadProfilePage(version);
    if (targetPage === 'bottle') await loadMyBottles(state.currentBottleTab || 'thrown', version);
    if (targetPage === 'match-detail' && matchId) await showMatchDetail(matchId);
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
    updateDate();
    if (!state.userId) await loadGlobalStats();
    await checkAuthStatus();
});

async function checkAuthStatus() {
    const result = await apiRequest('/user/profile');
    if (result.success) {
        state.user = result.data;
        if (!result.data.is_setup) {
            // 先加载页面数据，再弹出注册引导（防止注册框关闭后页面空白）
            await initApp();
            showAuthOverlay('register');
            return;
        }
    }
    await initApp();
}

async function initApp() {
    const version = captureAccountVersion();
    await Promise.all([
        loadGlobalStats(version),
        loadMatches(version),
        loadPickCount(version),
        loadOceanBottleCount(version)
    ]);
    if (!isFreshAccount(version)) return;
    loadProfileHeader();
    initNavigation();
    initBottleInput();
    updateSidebarUser();
}

function updateDate() {
    const today = new Date();
    const options = { month: 'long', day: 'numeric', weekday: 'long' };
    const el = document.getElementById('today-date');
    if (el) el.textContent = today.toLocaleDateString('zh-CN', options);
}

async function loadGlobalStats(version = captureAccountVersion()) {
    const result = await apiRequest('/stats/global');
    if (!isFreshAccount(version)) return;
    if (result.success) {
        const d = result.data;
        updateElement('sidebar-matches', d.weekMatches);
        updateElement('sidebar-votes', d.myVotes);
        updateElement('sidebar-bottles', d.myBottles);
    }
}

async function loadMatches(version = captureAccountVersion()) {
    const result = await apiRequest('/matches');
    if (!isFreshAccount(version)) return;
    if (result.success) {
        state.matches = result.data;
        renderMatches();
        initBottleSelect();
    } else {
        const container = document.getElementById('match-list');
        if (container) {
            container.innerHTML = `<p class="empty-tip">比赛加载失败，请稍后刷新</p>`;
        }
        console.error('比赛加载失败:', result.error);
    }
}

async function loadPickCount(version = captureAccountVersion()) {
    const result = await apiRequest('/bottles/picks/remaining');
    if (!isFreshAccount(version)) return;
    if (result.success) {
        state.pickCount = result.data.remaining;
        updateElement('pick-count', state.pickCount);
    }
}

async function loadOceanBottleCount(version = captureAccountVersion()) {
    const result = await apiRequest('/bottles/count');
    if (!isFreshAccount(version)) return;
    if (result.success) {
        updateElement('ocean-bottle-count', result.data.count);
    }
}

function updateElement(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function parseMatchDate(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    const text = String(value).trim();
    const normalizedZone = text.replace(/([+-]\d{2})$/, '$1:00');
    const hasTimeZone = /[zZ]$|[+-]\d{2}(?::?\d{2})?$/.test(text);
    return new Date(hasTimeZone ? normalizedZone.replace(' ', 'T') : text.replace(' ', 'T'));
}

function calcMatchStatus(matchTime, endTime) {
    if (!matchTime) return 'upcoming';
    const start = parseMatchDate(matchTime);
    const end = parseMatchDate(endTime);
    const now = new Date();

    if (!start || Number.isNaN(start.getTime())) return 'upcoming';
    if (end && !Number.isNaN(end.getTime()) && end <= now) return 'ended';
    if (start <= now) return 'live';
    return 'upcoming';
}

function getDisplayStatus(match) {
    return calcMatchStatus(match.match_time, match.end_time);
}

// ==================== 账号管理 ====================

function showAuthOverlay(tab) {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('hidden');
    // 隐藏改密码tab（仅在主动调用时显示）
    const tabChangepwd = document.getElementById('tab-changepwd');
    if (tabChangepwd) tabChangepwd.style.display = 'none';
    // 已有账号时（切换/改密码）才显示关闭按钮；首次注册引导不显示
    const closeBtn = document.getElementById('auth-overlay-close');
    if (closeBtn) closeBtn.style.display = (state.user && state.user.is_setup) ? 'flex' : 'none';
    switchAuthTab(tab || 'register');
}

function hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function showChangePassword() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.classList.remove('hidden');
    const tabChangepwd = document.getElementById('tab-changepwd');
    if (tabChangepwd) tabChangepwd.style.display = 'flex';
    switchAuthTab('changepwd');
}

function showSwitchAccount() {
    // 清除当前登录状态，弹出登录框
    showAuthOverlay('login');
}

function doLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    state.userId = null;
    state.user = null;
    localStorage.removeItem('userId');
    // 重新获取一个游客userId
    location.reload();
}

async function doChangePassword() {
    const oldPwd = document.getElementById('old-password').value;
    const newPwd = document.getElementById('new-password').value;
    const newPwd2 = document.getElementById('new-password2').value;
    const btn = document.getElementById('btn-changepwd');

    if (!oldPwd || !newPwd || !newPwd2) { showToast('请填写所有密码字段'); return; }
    if (newPwd.length < 6) { showToast('新密码至少6位'); return; }
    if (newPwd !== newPwd2) { showToast('两次新密码不一致'); return; }

    btn.disabled = true; btn.textContent = '修改中...';
    const result = await apiRequest('/user/password', {
        method: 'PUT',
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
    });
    btn.disabled = false; btn.textContent = '确认修改';

    if (result.success) {
        hideAuthOverlay();
        showToast('密码修改成功！');
        // 清空输入
        document.getElementById('old-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('new-password2').value = '';
    } else {
        showToast(result.error || '修改失败，请重试');
    }
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${tab}`);
    const formEl = document.getElementById(`form-${tab}`);
    if (tabEl) tabEl.classList.add('active');
    if (formEl) formEl.classList.add('active');
}

let usernameCheckTimer = null;
function checkUsername(val) {
    const feedback = document.getElementById('username-feedback');
    if (!val || val.length < 2) {
        feedback.textContent = '用户名至少2个字符';
        feedback.className = 'field-hint';
        return;
    }
    feedback.textContent = '检查中...';
    feedback.className = 'field-hint';
    clearTimeout(usernameCheckTimer);
    usernameCheckTimer = setTimeout(async () => {
        const res = await fetch(`/api/user/check-username?username=${encodeURIComponent(val)}&currentUserId=${state.userId || ''}`);
        const data = await res.json();
        if (data.success) {
            feedback.textContent = data.available ? '✓ 用户名可用' : '✗ 用户名已被使用，请换一个';
            feedback.className = data.available ? 'field-ok' : 'field-error';
        }
    }, 500);
}

async function doRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const nickname = document.getElementById('reg-nickname').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    const btn = document.getElementById('btn-register');

    if (!username || username.length < 2) { showToast('用户名至少2个字符'); return; }
    if (!password || password.length < 6) { showToast('密码至少6位'); return; }
    if (password !== password2) { showToast('两次密码输入不一致'); return; }

    btn.disabled = true; btn.textContent = '设置中...';
    const result = await apiRequest('/user/register', {
        method: 'POST',
        body: JSON.stringify({ userId: state.userId, username, nickname, password })
    });
    btn.disabled = false; btn.textContent = '开始参与';

    if (result.success) {
        const previousPage = state.currentPage;
        const previousMatchId = state.currentMatch?.id;
        const previousBottleTab = state.currentBottleTab || 'thrown';
        state.user = result.data;
        hideAuthOverlay();
        showToast(`欢迎加入，${result.data.nickname || username}！`);
        state.accountVersion += 1;
        resetAccountScopedUI(previousBottleTab);
        await refreshAccountData(previousPage, previousMatchId);
    } else {
        showToast(result.error || '设置失败，请重试');
    }
}

async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login');

    if (!username || !password) { showToast('请输入用户名和密码'); return; }

    btn.disabled = true; btn.textContent = '登录中...';
    const result = await apiRequest('/user/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });
    btn.disabled = false; btn.textContent = '登录';

    if (result.success) {
        const previousPage = state.currentPage;
        const previousMatchId = state.currentMatch?.id;
        const previousBottleTab = state.currentBottleTab || 'thrown';
        state.isSwitchingAccount = true;
        state.userId = result.data.id;
        localStorage.setItem('userId', result.data.id);
        state.user = result.data;
        state.accountVersion += 1;
        resetAccountScopedUI(previousBottleTab);
        hideAuthOverlay();
        showToast(`欢迎回来，${result.data.nickname}！`);
        await refreshAccountData(previousPage, previousMatchId);
        state.isSwitchingAccount = false;
    } else {
        showToast(result.error || '登录失败');
    }
}

function updateSidebarUser() {
    const el = document.getElementById('sidebar-user');
    if (!el) return;
    if (state.user && state.user.is_setup) {
        el.style.display = 'block';
        updateElement('sidebar-avatar', state.user.avatar || '⚽');
        updateElement('sidebar-nickname', state.user.nickname || state.user.username);
    } else {
        el.style.display = 'none';
    }
}

// ==================== 渲染比赛列表 ====================

function renderMatches() {
    const container = document.getElementById('match-list');
    if (!container) return;

    if (!state.matches || state.matches.length === 0) {
        container.innerHTML = '<p class="empty-tip">暂无比赛数据</p>';
        return;
    }

    // 按状态分组：live > upcoming > ended
    const statusOrder = { live: 0, upcoming: 1, ended: 2 };
    const sorted = [...state.matches].sort((a, b) => {
        const so = (statusOrder[getDisplayStatus(a)] ?? 3) - (statusOrder[getDisplayStatus(b)] ?? 3);
        if (so !== 0) return so;
        return new Date(a.match_time) - new Date(b.match_time);
    });

    container.innerHTML = sorted.map(match => {
        const displayStatus = getDisplayStatus(match);
        const totalVotes = match.total_votes || 0;
        const homePercent = totalVotes > 0 ? ((match.home_votes / totalVotes) * 100).toFixed(1) : 0;
        const drawPercent = totalVotes > 0 ? ((match.draw_votes / totalVotes) * 100).toFixed(1) : 0;
        const awayPercent = totalVotes > 0 ? ((match.away_votes / totalVotes) * 100).toFixed(1) : 0;

        const statusText = { upcoming: '即将开始', live: '⚡ 进行中', ended: '已结束' };
        const matchTime = new Date(match.match_time);
        const timeStr = matchTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const dateStr = matchTime.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });

        const homeFlag = renderFlag(match.home_flag, 40, 28);
        const awayFlag = renderFlag(match.away_flag, 40, 28);

        const scoreHtml = displayStatus === 'ended' && match.home_score !== null
            ? `<div class="match-score">${match.home_score} - ${match.away_score}</div>`
            : '';

        // ---- 底部区域：根据状态+投票情况决定显示内容 ----
        let bottomHtml = '';

        if (displayStatus === 'ended') {
            // 已结束：始终显示投票进度条
            const voteBar = totalVotes > 0 ? `
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
            ` : '<div class="vote-empty-tip">暂无投票数据</div>';

            // 猜中/猜错标志（需要有投票记录且已有比分）
            let resultBadge = '';
            if (match.userVote && match.home_score !== null) {
                const choiceText = { home: match.home_team, draw: '平局', away: match.away_team };
                const actual = match.home_score > match.away_score ? 'home'
                    : match.home_score < match.away_score ? 'away' : 'draw';
                const correct = match.userVote === actual;
                resultBadge = correct
                    ? `<div class="card-result-badge correct">🎉 猜对了！投了${choiceText[match.userVote]}</div>`
                    : `<div class="card-result-badge wrong">😔 猜错了，投了${choiceText[match.userVote]}</div>`;
            } else if (match.userVote) {
                // 有投票但比分未出
                const choiceText = { home: match.home_team, draw: '平局', away: match.away_team };
                resultBadge = `<div class="card-result-badge voted">✅ 投了${choiceText[match.userVote]}</div>`;
            }
            bottomHtml = resultBadge + voteBar;

        } else if (match.userVote) {
            // 进行中/即将开始 + 已投票：显示进度条 + 我的选择标志
            const choiceText = { home: match.home_team, draw: '平局', away: match.away_team };
            const myVoteBadge = `<div class="card-voted-badge">✅ 已投 ${choiceText[match.userVote]}</div>`;
            const voteBar = totalVotes > 0 ? `
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
            ` : '';
            bottomHtml = myVoteBadge + voteBar;

        } else {
            // 进行中/即将开始 + 未投票：只显示"去投票"按钮
            bottomHtml = `<div class="card-vote-cta">🗳️ 去投票 →</div>`;
        }

        return `
            <div class="match-card ${displayStatus}" onclick="showMatchDetail(${match.id})">
                <div class="match-header">
                    <span class="match-time">📅 ${dateStr} ⏰ ${timeStr}</span>
                    <span class="match-status ${displayStatus}">${statusText[displayStatus] || '即将开始'}</span>
                </div>
                <div class="match-group-tag">${match.group_name} · ${match.round}</div>
                <div class="teams">
                    <div class="team-brief">
                        <div class="team-flag">${homeFlag}</div>
                        <div class="team-name">${match.home_team}</div>
                    </div>
                    ${scoreHtml || '<div class="vs">VS</div>'}
                    <div class="team-brief">
                        <div class="team-flag">${awayFlag}</div>
                        <div class="team-name">${match.away_team}</div>
                    </div>
                </div>
                ${bottomHtml}
            </div>
        `;
    }).join('');
}

function renderFlag(flag, w = 40, h = 28) {
    if (!flag) return '🏳️';
    if (flag.startsWith('/')) return `<img src="${flag}" style="width:${w}px;height:${h}px;object-fit:cover;border-radius:4px" alt="">`;
    return `<span>${flag}</span>`;
}

// ==================== 比赛详情 ====================

async function showMatchDetail(matchId) {
    const result = await apiRequest(`/matches/${matchId}`);
    if (!result.success) { showToast('加载比赛详情失败'); return; }

    const match = result.data;
    state.currentMatch = match;
    const displayStatus = getDisplayStatus(match);

    updateElement('detail-group', `${match.group_name} · ${match.round}`);
    const matchTime = new Date(match.match_time);
    updateElement('detail-time', `📅 ${matchTime.toLocaleString('zh-CN')}`);

    const homeTeamEl = document.getElementById('team-home');
    const awayTeamEl = document.getElementById('team-away');
    if (homeTeamEl) {
        homeTeamEl.querySelector('.team-flag').innerHTML = renderFlag(match.home_flag, 56, 40);
        homeTeamEl.querySelector('.team-name').textContent = match.home_team;
        homeTeamEl.querySelector('.team-rank').textContent = match.home_rank ? `世界排名 #${match.home_rank}` : '';
    }
    if (awayTeamEl) {
        awayTeamEl.querySelector('.team-flag').innerHTML = renderFlag(match.away_flag, 56, 40);
        awayTeamEl.querySelector('.team-name').textContent = match.away_team;
        awayTeamEl.querySelector('.team-rank').textContent = match.away_rank ? `世界排名 #${match.away_rank}` : '';
    }

    // 比分/状态徽章
    const badge = document.getElementById('match-result-badge');
    if (badge) {
        if (displayStatus === 'ended' && match.home_score !== null) {
            badge.textContent = `${match.home_score} - ${match.away_score}`;
            badge.style.display = 'block';
        } else if (displayStatus === 'live') {
            badge.textContent = '⚡ 进行中';
            badge.style.display = 'block';
        } else {
            badge.style.display = 'none';
        }
    }

    // 投票按钮文字
    const voteHomeBtn = document.querySelector('.vote-home');
    const voteAwayBtn = document.querySelector('.vote-away');
    if (voteHomeBtn) voteHomeBtn.innerHTML = `<span class="team-flag-small">${renderFlag(match.home_flag, 24, 18)}</span><span>投${match.home_team}</span>`;
    if (voteAwayBtn) voteAwayBtn.innerHTML = `<span class="team-flag-small">${renderFlag(match.away_flag, 24, 18)}</span><span>投${match.away_team}</span>`;

    updateElement('home-label', `${match.home_team}`);
    updateElement('away-label', `${match.away_team}`);

    const votingSection = document.getElementById('voting-section');
    const voteResultSection = document.getElementById('vote-result-section');
    const revoteBtn = document.getElementById('revote-btn');

    if (displayStatus === 'ended') {
        // 已结束：只显示统计，不可操作
        if (votingSection) votingSection.style.display = 'none';
        if (voteResultSection) voteResultSection.style.display = 'block';
        if (revoteBtn) revoteBtn.style.display = 'none';
        updateVoteStats(match);
        showPredictResult(match);
    } else if (match.userVote) {
        // 已投票，但未结束：显示统计 + 撤票按钮
        if (votingSection) votingSection.style.display = 'none';
        if (voteResultSection) voteResultSection.style.display = 'block';
        if (revoteBtn) revoteBtn.style.display = 'inline-flex';
        updateVoteStats(match);
        const pr = document.getElementById('predict-result');
        if (pr) pr.style.display = 'none';
    } else {
        // 未投票，未结束
        if (votingSection) votingSection.style.display = 'block';
        if (voteResultSection) voteResultSection.style.display = 'none';
    }

    loadMatchBottles(matchId);
    showPage('match-detail');
}

function showPredictResult(match) {
    const el = document.getElementById('predict-result');
    if (!el) return;
    if (!match.userVote || match.home_score === null) { el.style.display = 'none'; return; }

    const actualResult = match.home_score > match.away_score ? 'home'
        : match.home_score < match.away_score ? 'away' : 'draw';
    const correct = match.userVote === actualResult;
    const choiceText = { home: match.home_team, draw: '平局', away: match.away_team };

    el.style.display = 'block';
    el.innerHTML = correct
        ? `<div class="predict-correct">🎉 猜对了！你投了 <strong>${choiceText[match.userVote]}</strong>，最终比分 ${match.home_score}:${match.away_score}</div>`
        : `<div class="predict-wrong">😔 猜错了，你投了 <strong>${choiceText[match.userVote]}</strong>，最终比分 ${match.home_score}:${match.away_score}</div>`;
}

function updateVoteStats(match) {
    const totalVotes = match.total_votes || 0;
    const homePercent = totalVotes > 0 ? ((match.home_votes / totalVotes) * 100).toFixed(1) : 0;
    const drawPercent = totalVotes > 0 ? ((match.draw_votes / totalVotes) * 100).toFixed(1) : 0;
    const awayPercent = totalVotes > 0 ? ((match.away_votes / totalVotes) * 100).toFixed(1) : 0;

    updateElement('home-percent', `${homePercent}%`);
    updateElement('draw-percent', `${drawPercent}%`);
    updateElement('away-percent', `${awayPercent}%`);

    const homeBar = document.getElementById('home-bar');
    const drawBar = document.getElementById('draw-bar');
    const awayBar = document.getElementById('away-bar');
    if (homeBar) homeBar.style.width = `${homePercent}%`;
    if (drawBar) drawBar.style.width = `${drawPercent}%`;
    if (awayBar) awayBar.style.width = `${awayPercent}%`;

    updateElement('home-count', `${match.home_votes || 0} 票`);
    updateElement('draw-count', `${match.draw_votes || 0} 票`);
    updateElement('away-count', `${match.away_votes || 0} 票`);

    if (match.userVote) {
        const voteText = { home: match.home_team, draw: '平局', away: match.away_team };
        updateElement('my-vote', `✅ 你投给了 ${voteText[match.userVote]}`);
    } else {
        updateElement('my-vote', '');
    }
}

async function vote(choice) {
    if (isActionPending('vote')) return;
    if (!state.currentMatch) { showToast('请先选择比赛'); return; }
    if (getDisplayStatus(state.currentMatch) === 'ended') { showToast('比赛已结束，无法投票'); return; }

    setActionPending('vote', true);
    const result = await apiRequest('/votes', {
        method: 'POST',
        body: JSON.stringify({ matchId: state.currentMatch.id, choice })
    });
    setActionPending('vote', false);

    if (result.success) {
        state.currentMatch.userVote = choice;
        state.currentMatch.home_votes = result.data.home_votes;
        state.currentMatch.draw_votes = result.data.draw_votes;
        state.currentMatch.away_votes = result.data.away_votes;
        state.currentMatch.total_votes = result.data.total_votes;

        // 同步更新列表中对应比赛的缓存，返回列表时卡片立即反映最新状态
        const listMatch = state.matches.find(m => m.id === state.currentMatch.id);
        if (listMatch) {
            listMatch.userVote = choice;
            listMatch.home_votes = result.data.home_votes;
            listMatch.draw_votes = result.data.draw_votes;
            listMatch.away_votes = result.data.away_votes;
            listMatch.total_votes = result.data.total_votes;
        }

        document.getElementById('voting-section').style.display = 'none';
        document.getElementById('vote-result-section').style.display = 'block';
        const revoteBtn = document.getElementById('revote-btn');
        if (revoteBtn) revoteBtn.style.display = 'inline-flex';
        updateVoteStats(state.currentMatch);
        const version = captureAccountVersion();
        loadGlobalStats(version);
        loadMatches(version);
        showToast('投票成功！');
    } else {
        showToast(result.error || '投票失败');
    }
}

async function revokeVote() {
    if (isActionPending('vote')) return;
    if (!state.currentMatch) return;
    if (!confirm('确定要撤销本次投票并重新选择吗？')) return;

    setActionPending('vote', true);
    const result = await apiRequest(`/votes/${state.currentMatch.id}`, { method: 'DELETE' });
    setActionPending('vote', false);
    if (result.success) {
        state.currentMatch.userVote = null;
        state.currentMatch.home_votes = result.data.home_votes;
        state.currentMatch.draw_votes = result.data.draw_votes;
        state.currentMatch.away_votes = result.data.away_votes;
        state.currentMatch.total_votes = result.data.total_votes;

        // 同步更新列表缓存
        const listMatch = state.matches.find(m => m.id === state.currentMatch.id);
        if (listMatch) {
            listMatch.userVote = null;
            listMatch.home_votes = result.data.home_votes;
            listMatch.draw_votes = result.data.draw_votes;
            listMatch.away_votes = result.data.away_votes;
            listMatch.total_votes = result.data.total_votes;
        }

        document.getElementById('voting-section').style.display = 'block';
        document.getElementById('vote-result-section').style.display = 'none';
        const version = captureAccountVersion();
        loadGlobalStats(version);
        loadMatches(version);
        showToast('已撤销投票，可重新选择');
    } else {
        showToast(result.error || '撤销失败');
    }
}

async function loadMatchBottles(matchId, version = captureAccountVersion()) {
    const container = document.getElementById('match-bottles');
    if (!container) return;
    const result = await apiRequest(`/bottles/match/${matchId}`);
    if (!isFreshAccount(version)) return;
    if (result.success && result.data && result.data.length > 0) {
        container.innerHTML = result.data.map(bottle => `
            <div class="bottle-item" onclick="openBottleReplies(${bottle.id})">
                <div class="bottle-item-header">
                    <span class="bottle-type-tag">${bottleTypes[bottle.type]?.icon || '🍶'} ${bottleTypes[bottle.type]?.name || '瓶子'}</span>
                    <span>${formatTime(bottle.created_at)}</span>
                </div>
                <div class="bottle-item-content">${escapeHtml(bottle.content)}</div>
                ${bottle.reply_count > 0 ? `<div class="reply-count-badge">💬 ${bottle.reply_count} 条回复</div>` : ''}
            </div>
        `).join('');
    } else {
        container.innerHTML = '<p class="empty-tip">暂无漂流瓶，来投一个吧！</p>';
    }
}

// ==================== 页面切换 ====================

function showPage(pageName) {
    state.currentPage = pageName;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageId = pageName === 'match-detail' ? 'match-detail-page' : `${pageName}-page`;
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === pageName) item.classList.add('active');
    });

    const version = captureAccountVersion();
    if (pageName === 'profile') loadProfilePage(version);
    else if (pageName === 'bottle') {
        const activeTab = state.currentBottleTab || 'thrown';
        loadMyBottles(activeTab, version);
        loadOceanBottleCount(version);
        loadPickCount(version);
    } else if (pageName === 'home') {
        // 返回首页时重新渲染卡片，确保投票状态实时更新
        renderMatches();
        loadMatches(version);
    }
}

function initNavigation() {
    if (state.navigationReady) return;
    state.navigationReady = true;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            if (page) showPage(page);
        });
    });
}

// ==================== 漂流瓶功能 ====================

function showThrowModal() {
    const modal = document.getElementById('throw-modal');
    if (modal) {
        modal.classList.add('show');
        const textarea = document.getElementById('bottle-content');
        if (textarea) textarea.value = '';
        updateElement('char-count', '0');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('show');
}

function selectBottleType(btn) {
    document.querySelectorAll('.bottle-type').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function initBottleSelect() {
    const select = document.getElementById('bottle-match');
    if (!select || !state.matches) return;
    select.innerHTML = '<option value="">不关联</option>' +
        state.matches.map(m => `<option value="${m.id}">${m.home_team} vs ${m.away_team}</option>`).join('');
}

function initBottleInput() {
    if (state.bottleInputReady) return;
    state.bottleInputReady = true;
    const textarea = document.getElementById('bottle-content');
    if (textarea) {
        textarea.addEventListener('input', (e) => updateElement('char-count', e.target.value.length));
    }
}

async function throwBottle() {
    if (isActionPending('throwBottle')) return;
    const textarea = document.getElementById('bottle-content');
    const content = textarea ? textarea.value.trim() : '';
    if (!content) { showToast('请输入内容'); return; }
    if (content.length < 10) { showToast('内容至少10个字'); return; }

    const activeType = document.querySelector('.bottle-type.active');
    const type = activeType ? activeType.dataset.type : 'chat';
    const matchSelect = document.getElementById('bottle-match');
    const matchId = matchSelect ? matchSelect.value : null;

    setActionPending('throwBottle', true);
    const result = await apiRequest('/bottles', {
        method: 'POST',
        body: JSON.stringify({ type, content, matchId: matchId ? parseInt(matchId) : null })
    });
    setActionPending('throwBottle', false);

    if (result.success) {
        closeModal('throw-modal');
        showToast('瓶子已投入海洋！');
        state.currentBottleTab = 'thrown';
        setBottleTabActive('thrown');
        const version = captureAccountVersion();
        loadGlobalStats(version);
        loadOceanBottleCount(version);
        loadMyBottles('thrown', version);
        if (state.currentMatch?.id && matchId && parseInt(matchId) === state.currentMatch.id) {
            loadMatchBottles(state.currentMatch.id, version);
        }
    } else {
        showToast(result.error || '投瓶失败');
    }
}

async function pickBottle() {
    if (isActionPending('pickBottle')) return;
    if (state.pickCount <= 0) { showToast('今日收瓶次数已用完'); return; }

    setActionPending('pickBottle', true);
    const result = await apiRequest('/bottles/pick', { method: 'POST' });
    setActionPending('pickBottle', false);
    if (result.success) {
        const bottle = result.data;
        state.currentBottleId = bottle.id;
        updateElement('picked-type', `${bottleTypes[bottle.type]?.icon || '🍶'} ${bottleTypes[bottle.type]?.name || '瓶子'}`);
        updateElement('picked-content', bottle.content);
        updateElement('picked-time', formatTime(bottle.created_at));
        state.pickCount = bottle.remainingPicks;
        updateElement('pick-count', state.pickCount);
        // 清空回复框
        const replyTA = document.getElementById('reply-content');
        if (replyTA) replyTA.value = '';
        document.getElementById('pick-modal').classList.add('show');
        const version = captureAccountVersion();
        state.currentBottleTab = 'collected';
        setBottleTabActive('collected');
        loadGlobalStats(version);
        loadMyBottles('collected', version);
    } else {
        showToast(result.error || '收瓶失败');
    }
}

async function submitReply() {
    if (isActionPending('pickReply')) return;
    if (!state.currentBottleId) { showToast('无效的漂流瓶'); return; }
    const ta = document.getElementById('reply-content');
    const content = ta ? ta.value.trim() : '';
    if (!content || content.length < 2) { showToast('回复至少2个字'); return; }

    setActionPending('pickReply', true);
    const result = await apiRequest(`/bottles/${state.currentBottleId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ content })
    });
    setActionPending('pickReply', false);
    if (result.success) {
        showToast('回复已发送！');
        if (ta) ta.value = '';
        closeModal('pick-modal');
        const version = captureAccountVersion();
        loadMyBottles(state.currentBottleTab || 'collected', version);
        if (state.currentPage === 'profile') loadProfilePage(version);
    } else {
        showToast(result.error || '回复失败');
    }
}

function switchBottleTab(tab, btn) {
    state.currentBottleTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadMyBottles(tab, captureAccountVersion());
}

async function loadMyBottles(tab, version = captureAccountVersion()) {
    const container = document.getElementById('my-bottle-list');
    if (!container) return;
    state.currentBottleTab = tab;
    container.innerHTML = '<p class="empty-tip">加载中...</p>';
    const endpoint = tab === 'thrown' ? '/bottles/my/thrown' : '/bottles/my/collected';
    const result = await apiRequest(endpoint);
    if (!isFreshAccount(version) || state.currentBottleTab !== tab) return;
    if (result.success && result.data && result.data.length > 0) {
        container.innerHTML = result.data.map(bottle => `
            <div class="bottle-item" onclick="openBottleReplies(${bottle.id})">
                <div class="bottle-item-header">
                    <span class="bottle-type-tag">${bottleTypes[bottle.type]?.icon || '🍶'} ${bottleTypes[bottle.type]?.name || '瓶子'}</span>
                    <span>${formatTime(bottle.created_at || bottle.picked_at)}</span>
                </div>
                <div class="bottle-item-content">${escapeHtml(bottle.content)}</div>
                ${bottle.home_team ? `<div class="bottle-meta" style="margin-top:6px;font-size:12px;opacity:0.7">🏟️ 关联: ${bottle.home_team} vs ${bottle.away_team}</div>` : ''}
                ${bottle.reply_count > 0 ? `<div class="reply-count-badge">💬 ${bottle.reply_count} 条回复</div>` : ''}
            </div>
        `).join('');
    } else {
        container.innerHTML = `<p class="empty-tip">${tab === 'thrown' ? '还没有投出过瓶子' : '还没有收到过瓶子'}</p>`;
    }
}

// 打开漂流瓶回复弹窗
async function openBottleReplies(bottleId) {
    state.currentBottleId = bottleId;
    const body = document.getElementById('bottle-replies-body');
    if (!body) return;
    body.innerHTML = '<p style="text-align:center;padding:20px;opacity:0.5">加载中...</p>';
    document.getElementById('bottle-replies-modal').classList.add('show');

    // 并行加载瓶子详情和回复列表
    const [bottleResult, repliesResult] = await Promise.all([
        apiRequest(`/bottles/${bottleId}`),
        apiRequest(`/bottles/${bottleId}/replies`)
    ]);

    let html = '';

    // 显示漂流瓶原文
    if (bottleResult.success) {
        const b = bottleResult.data;
        const typeIcon = bottleTypes[b.type]?.icon || '🍶';
        const typeName = bottleTypes[b.type]?.name || '瓶子';
        html += `
            <div class="bottle-origin-block">
                <div class="bottle-origin-header">
                    <span class="bottle-type-tag">${typeIcon} ${typeName}</span>
                    <span class="bottle-origin-time">${formatTime(b.created_at)}</span>
                </div>
                <p class="bottle-origin-text">${escapeHtml(b.content)}</p>
                ${b.home_team ? `<div class="bottle-meta">🏟️ ${escapeHtml(b.home_team)} vs ${escapeHtml(b.away_team)}</div>` : ''}
            </div>
            <div class="replies-divider">💬 ${repliesResult.success ? repliesResult.data.length : 0} 条回复</div>
        `;
    }

    // 显示回复列表
    if (repliesResult.success) {
        if (repliesResult.data.length === 0) {
            html += '<p class="empty-tip" style="margin-top:12px">暂无回复，来第一个回复吧！</p>';
        } else {
            html += repliesResult.data.map(r => `
                <div class="reply-item">
                    <span class="reply-avatar">${r.avatar || '⚽'}</span>
                    <div class="reply-content-wrap">
                        <span class="reply-nickname">${escapeHtml(r.nickname || r.username || '匿名球迷')}</span>
                        <p class="reply-text">${escapeHtml(r.content)}</p>
                        <span class="reply-time">${formatTime(r.created_at)}</span>
                    </div>
                </div>
            `).join('');
        }
    } else {
        html += '<p class="empty-tip">加载失败</p>';
    }

    body.innerHTML = html;
}

async function submitNewReply() {
    if (isActionPending('newReply')) return;
    if (!state.currentBottleId) return;
    const ta = document.getElementById('new-reply-content');
    const content = ta ? ta.value.trim() : '';
    if (!content || content.length < 2) { showToast('回复至少2个字'); return; }

    setActionPending('newReply', true);
    const result = await apiRequest(`/bottles/${state.currentBottleId}/replies`, {
        method: 'POST',
        body: JSON.stringify({ content })
    });
    setActionPending('newReply', false);
    if (result.success) {
        showToast('回复已发送！');
        if (ta) ta.value = '';
        // 刷新回复列表
        await openBottleReplies(state.currentBottleId);
        const version = captureAccountVersion();
        loadMyBottles(state.currentBottleTab || 'thrown', version);
        if (state.currentMatch?.id) loadMatchBottles(state.currentMatch.id, version);
        if (state.currentPage === 'profile') loadProfilePage(version);
    } else {
        showToast(result.error || '回复失败');
    }
}

// ==================== 个人中心 ====================

function loadProfileHeader() {
    if (!state.user) return;
    const el = document.getElementById('profile-avatar');
    if (el) el.textContent = state.user.avatar || '⚽';
    updateElement('profile-nickname', state.user.nickname || state.user.username || '足球爱好者');
    if (state.user.username) updateElement('profile-username-tag', `@${state.user.username}`);
}

async function loadProfilePage(version = captureAccountVersion()) {
    const result = await apiRequest('/user/profile');
    if (!isFreshAccount(version)) return;
    if (result.success) {
        state.user = result.data;
        updateElement('profile-avatar', result.data.avatar || '⚽');
        updateElement('profile-nickname', result.data.nickname || '足球爱好者');
        updateElement('profile-level', `Lv.${result.data.level} ${getLevelName(result.data.level)}`);
        if (result.data.username) updateElement('profile-username-tag', `@${result.data.username}`);
        updateSidebarUser();
    }

    const statsResult = await apiRequest('/user/stats');
    if (!isFreshAccount(version)) return;
    if (statsResult.success) {
        const d = statsResult.data;
        updateElement('my-votes', d.total_votes || 0);
        updateElement('my-correct', d.correct_votes || 0);
        updateElement('my-accuracy', d.accuracy || '0%');
        updateElement('my-bottles-count', d.total_bottle_all || 0);
        renderAchievements(d.achievements || {});
    }
}

function renderAchievements(achievements = {}) {
    const container = document.getElementById('achievements-grid');
    if (!container) return;
    const items = [
        { key: 'predictNovice', icon: '🔮', name: '预言新手', desc: '完成5次预测' },
        { key: 'prophecyMaster', icon: '👁️', name: '神预言', desc: '预测3场正确' },
        { key: 'bottleDrifter', icon: '🍶', name: '漂流达人', desc: '投出5个瓶子' },
        { key: 'fatedFriend', icon: '🤝', name: '有缘人', desc: '收到5个回复' },
        { key: 'fullAttendance', icon: '🏅', name: '全勤奖', desc: '参与全部场次' }
    ];
    container.innerHTML = items.map(item => {
        const data = achievements[item.key] || {};
        const progress = Number(data.progress || 0);
        const target = Number(data.target || 0);
        const unlocked = Boolean(data.unlocked);
        const progressText = target > 0 ? `${Math.min(progress, target)}/${target}` : `${progress}`;
        return `
            <div class="achievement ${unlocked ? 'unlocked' : 'locked'}">
                <span class="achievement-icon">${item.icon}</span>
                <span class="achievement-name">${item.name}</span>
                <span class="achievement-desc">${item.desc}</span>
                <span class="achievement-progress">${unlocked ? '已点亮' : progressText}</span>
            </div>
        `;
    }).join('');
}

function getLevelName(level) {
    const names = ['', '新手球迷', '资深球迷', '球迷达人', '预言大师', '世界杯之神'];
    return names[Math.min(level, names.length - 1)] || '球迷';
}

// ==================== 工具函数 ====================

function showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position:fixed;top:50%;left:50%;
        transform:translate(-50%,-50%);
        background:rgba(0,0,0,0.85);color:#fff;
        padding:16px 32px;border-radius:12px;
        z-index:99999;font-size:15px;
        max-width:80%;text-align:center;
        pointer-events:none;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
}

function formatTime(timeStr) {
    if (!timeStr) return '';
    try { return new Date(timeStr).toLocaleString('zh-CN'); }
    catch (e) { return timeStr; }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

document.addEventListener('click', (e) => {
    // 点击 modal 背景层关闭弹窗
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('show');
    }
    // 点击 auth-overlay 背景关闭（只有已登录用户才允许关闭）
    if (e.target.id === 'auth-overlay' && state.user && state.user.is_setup) {
        hideAuthOverlay();
    }
});
