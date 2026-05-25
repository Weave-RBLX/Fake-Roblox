/* ===========================================
   PIXELCITY — script.js
   Full platform logic: auth, games, studio,
   avatar, friends, messaging
   =========================================== */

// ── Password Manager ──────────────────────────
class PasswordManager {
    static generateSalt() {
        return Math.random().toString(36).substring(2, 15) +
               Math.random().toString(36).substring(2, 15);
    }
    static async hash(password, salt) {
        const data = new TextEncoder().encode(password + salt);
        const buf  = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
    }
}

// ── User Manager ──────────────────────────────
class UserManager {
    constructor() {
        this.users       = this._load('pc_users', []);
        this.currentUser = this._load('pc_current', null);
        this.lastCreate  = this._load('pc_lastCreate', 0);
    }
    _load(key, fallback) {
        try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
        catch { return fallback; }
    }
    _save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

    saveUsers()   { this._save('pc_users', this.users); }
    saveCurrent() {
        if (this.currentUser) this._save('pc_current', this.currentUser);
        else localStorage.removeItem('pc_current');
    }

    isLoggedIn()    { return !!this.currentUser; }
    getCurrentUser(){ return this.currentUser; }
    getByUsername(u){ return this.users.find(x => x.username.toLowerCase() === u.toLowerCase()); }

    canCreate() {
        return (Date.now() - this.lastCreate) >= 2 * 60 * 1000;
    }
    cooldownSecs() {
        return Math.ceil((2 * 60 * 1000 - (Date.now() - this.lastCreate)) / 1000);
    }

    async register(username, email, password) {
        if (!this.canCreate() && this.lastCreate > 0)
            return { ok: false, msg: `⏱ Wait ${this.cooldownSecs()}s before creating another account.` };
        if (username.length < 3)
            return { ok: false, msg: '❌ Username must be 3+ characters.' };
        if (!/^[a-zA-Z0-9_\-]+$/.test(username))
            return { ok: false, msg: '❌ Username: letters, numbers, _ and - only.' };
        if (this.getByUsername(username))
            return { ok: false, msg: '❌ Username taken.' };
        if (this.users.find(u => u.email.toLowerCase() === email.toLowerCase()))
            return { ok: false, msg: '❌ Email already registered.' };
        if (password.length < 8)
            return { ok: false, msg: '❌ Password must be 8+ characters.' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return { ok: false, msg: '❌ Invalid email address.' };

        const salt = PasswordManager.generateSalt();
        const hash = await PasswordManager.hash(password, salt);
        const user = {
            id: Date.now(), username, email,
            hash, salt,
            createdAt: new Date().toISOString(),
            avatar: null,
            friends: [], friendRequests: [], blocked: [],
            gamesPlayed: 0, worldsBuilt: 0,
            loginAttempts: 0, locked: false, lockTime: null
        };
        this.users.push(user);
        this.saveUsers();
        this.lastCreate = Date.now();
        this._save('pc_lastCreate', this.lastCreate);
        return { ok: true, msg: '✅ Account created! Please sign in.' };
    }

    async login(username, password) {
        const user = this.getByUsername(username);
        if (!user) return { ok: false, msg: '❌ No account with that username.' };

        if (user.locked) {
            const ago = Date.now() - new Date(user.lockTime).getTime();
            if (ago < 15 * 60 * 1000)
                return { ok: false, msg: `🔒 Account locked. Try again in ${Math.ceil((15*60*1000-ago)/60000)} min.` };
            user.locked = false; user.loginAttempts = 0; this.saveUsers();
        }

        const hash = await PasswordManager.hash(password, user.salt);
        if (hash !== user.hash) {
            user.loginAttempts = (user.loginAttempts||0) + 1;
            if (user.loginAttempts >= 5) {
                user.locked = true; user.lockTime = new Date().toISOString();
                this.saveUsers();
                return { ok: false, msg: '🔒 Too many attempts. Account locked 15 min.' };
            }
            this.saveUsers();
            return { ok: false, msg: `❌ Wrong password. (${5-user.loginAttempts} left)` };
        }

        user.loginAttempts = 0;
        this.saveUsers();
        this.currentUser = { id:user.id, username:user.username, email:user.email, createdAt:user.createdAt, avatar:user.avatar };
        this.saveCurrent();
        return { ok: true, msg: `✅ Welcome back, ${user.username}!` };
    }

    logout() { this.currentUser = null; this.saveCurrent(); }

    saveAvatar(data) {
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (user) { user.avatar = data; this.saveUsers(); this.currentUser.avatar = data; this.saveCurrent(); }
    }

    syncStats() {
        if (!this.currentUser) return;
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (user) {
            this.currentUser.gamesPlayed = user.gamesPlayed || 0;
            this.currentUser.worldsBuilt = user.worldsBuilt || 0;
        }
    }

    // Friends
    getFriends(userId) {
        const u = this.users.find(x => x.id === userId);
        return u ? (u.friends || []) : [];
    }
    getRequests(userId) {
        const u = this.users.find(x => x.id === userId);
        return u ? (u.friendRequests || []) : [];
    }
    getBlocked(userId) {
        const u = this.users.find(x => x.id === userId);
        return u ? (u.blocked || []) : [];
    }
    sendFriendRequest(fromId, toUsername) {
        const to = this.getByUsername(toUsername);
        if (!to) return { ok:false, msg:'❌ User not found.' };
        if (to.id === fromId) return { ok:false, msg:'❌ Cannot friend yourself.' };
        const from = this.users.find(u => u.id === fromId);
        if (!from) return { ok:false, msg:'❌ Error.' };
        if ((from.friends||[]).includes(to.id)) return { ok:false, msg:'❌ Already friends.' };
        if ((from.blocked||[]).includes(to.id)) return { ok:false, msg:'❌ You blocked this user.' };
        if ((to.friendRequests||[]).find(r => r.from === fromId)) return { ok:false, msg:'❌ Request already sent.' };
        if (!to.friendRequests) to.friendRequests = [];
        to.friendRequests.push({ from: fromId, fromName: from.username, at: new Date().toISOString() });
        this.saveUsers();
        return { ok:true, msg:`✅ Friend request sent to ${to.username}!` };
    }
    acceptRequest(userId, fromId) {
        const user = this.users.find(u => u.id === userId);
        const from = this.users.find(u => u.id === fromId);
        if (!user || !from) return;
        user.friendRequests = (user.friendRequests||[]).filter(r => r.from !== fromId);
        if (!user.friends) user.friends = [];
        if (!from.friends) from.friends = [];
        if (!user.friends.includes(fromId)) user.friends.push(fromId);
        if (!from.friends.includes(userId)) from.friends.push(userId);
        this.saveUsers();
    }
    declineRequest(userId, fromId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        user.friendRequests = (user.friendRequests||[]).filter(r => r.from !== fromId);
        this.saveUsers();
    }
    removeFriend(userId, friendId) {
        const user = this.users.find(u => u.id === userId);
        const friend = this.users.find(u => u.id === friendId);
        if (user) user.friends = (user.friends||[]).filter(id => id !== friendId);
        if (friend) friend.friends = (friend.friends||[]).filter(id => id !== userId);
        this.saveUsers();
    }
    blockUser(userId, targetId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        if (!user.blocked) user.blocked = [];
        if (!user.blocked.includes(targetId)) user.blocked.push(targetId);
        user.friends = (user.friends||[]).filter(id => id !== targetId);
        user.friendRequests = (user.friendRequests||[]).filter(r => r.from !== targetId);
        this.saveUsers();
    }
    unblockUser(userId, targetId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) return;
        user.blocked = (user.blocked||[]).filter(id => id !== targetId);
        this.saveUsers();
    }
}

// ── Messaging ─────────────────────────────────
class Messaging {
    _load() { try { return JSON.parse(localStorage.getItem('pc_msgs')||'[]'); } catch { return []; } }
    _save(msgs) { localStorage.setItem('pc_msgs', JSON.stringify(msgs)); }

    send(from, toUsername, subject, body) {
        if (!toUsername.trim()) return { ok:false, msg:'❌ Enter a recipient.' };
        if (!subject.trim())    return { ok:false, msg:'❌ Enter a subject.' };
        if (!body.trim())       return { ok:false, msg:'❌ Write a message.' };
        const to = userManager.getByUsername(toUsername.trim());
        if (!to) return { ok:false, msg:`❌ User "${toUsername}" not found.` };
        if (to.username.toLowerCase() === from.toLowerCase()) return { ok:false, msg:'❌ Cannot message yourself.' };
        const msgs = this._load();
        msgs.push({ id:Date.now(), from, to:to.username, subject:subject.trim(), body:body.trim(), at:new Date().toISOString(), read:false });
        this._save(msgs);
        return { ok:true, msg:`✅ Sent to ${to.username}!` };
    }
    inbox(username) {
        return this._load().filter(m => m.to.toLowerCase()===username.toLowerCase()).sort((a,b)=>new Date(b.at)-new Date(a.at));
    }
    sent(username) {
        return this._load().filter(m => m.from.toLowerCase()===username.toLowerCase()).sort((a,b)=>new Date(b.at)-new Date(a.at));
    }
    unread(username) { return this._load().filter(m => m.to.toLowerCase()===username.toLowerCase() && !m.read).length; }
    markRead(id) {
        const msgs = this._load();
        const m = msgs.find(x => x.id===id);
        if (m) { m.read=true; this._save(msgs); }
    }
    get(id) { return this._load().find(m => m.id===id) || null; }
}

// ── Avatar Data ───────────────────────────────
const SKIN_COLORS = [
    {id:'s1', color:'#FFDBB4', label:'Light'},
    {id:'s2', color:'#F1C27D', label:'Tan'},
    {id:'s3', color:'#E0AC69', label:'Warm'},
    {id:'s4', color:'#C68642', label:'Brown'},
    {id:'s5', color:'#8D5524', label:'Dark'},
    {id:'s6', color:'#FF9999', label:'Pink'},
    {id:'s7', color:'#99CCFF', label:'Blue'},
    {id:'s8', color:'#99FF99', label:'Green'},
    {id:'s9', color:'#CC99FF', label:'Purple'},
];
const PANTS_COLORS = [
    {id:'p1', color:'#2c3e50', label:'Dark'},
    {id:'p2', color:'#3498db', label:'Blue'},
    {id:'p3', color:'#1abc9c', label:'Teal'},
    {id:'p4', color:'#27ae60', label:'Green'},
    {id:'p5', color:'#8e44ad', label:'Purple'},
    {id:'p6', color:'#e74c3c', label:'Red'},
    {id:'p7', color:'#f39c12', label:'Orange'},
    {id:'p8', color:'#7f8c8d', label:'Grey'},
    {id:'p9', color:'#000000', label:'Black'},
];
const HATS = [
    {id:'none',     label:'None',     emoji:'🚫', css:'display:none'},
    {id:'cap',      label:'Cap',      emoji:'🧢', css:'background:#e74c3c;border-radius:8px 8px 0 0;'},
    {id:'tophat',   label:'Top Hat',  emoji:'🎩', css:'background:#1a1a1a;border-radius:4px 4px 0 0;height:130%;border:2px solid #333;'},
    {id:'wizard',   label:'Wizard',   emoji:'🧙', css:'background:linear-gradient(180deg,#9b59b6,#6c3483);clip-path:polygon(50% 0%,0% 100%,100% 100%);border-radius:0;'},
    {id:'cowboy',   label:'Cowboy',   emoji:'🤠', css:'background:#8B6914;border-radius:50%;width:140%;margin-left:-20%;'},
    {id:'crown',    label:'Crown',    emoji:'👑', css:'background:linear-gradient(180deg,#FFD700,#FFA500);clip-path:polygon(0% 100%,15% 30%,30% 100%,50% 15%,70% 100%,85% 30%,100% 100%);'},
    {id:'propeller',label:'Propeller',emoji:'🚁', css:'background:#3498db;border-radius:50%;border:3px solid #2980b9;'},
    {id:'santa',    label:'Santa',    emoji:'🎅', css:'background:#e74c3c;border-radius:8px 8px 0 0;border-bottom:4px solid white;'},
    {id:'party',    label:'Party',    emoji:'🎉', css:'background:linear-gradient(135deg,#ff6b6b,#feca57,#48dbfb,#ff9ff3);clip-path:polygon(50% 0%,0% 100%,100% 100%);'},
    {id:'hard',     label:'Hard Hat', emoji:'⛏️', css:'background:#f39c12;border-radius:50% 50% 0 0;border-bottom:4px solid #e67e22;'},
];
const CLOTHES = [
    {id:'tshirt', label:'T-Shirt', emoji:'👕', color:'#3498db'},
    {id:'hoodie', label:'Hoodie',  emoji:'🧥', color:'#2c3e50'},
    {id:'jersey', label:'Jersey',  emoji:'🏅', color:'#e74c3c'},
    {id:'suit',   label:'Suit',    emoji:'🤵', color:'#1a1a2e'},
    {id:'rainbow',label:'Rainbow', emoji:'🌈', color:'gradient'},
    {id:'camo',   label:'Camo',    emoji:'🎖️', color:'#556b2f'},
    {id:'space',  label:'Space',   emoji:'🚀', color:'#0a0a2e'},
    {id:'pink',   label:'Pink',    emoji:'🩷', color:'#ff69b4'},
    {id:'stripe', label:'Stripe',  emoji:'〽️', color:'stripe'},
];
const ACCESSORIES = [
    {id:'none',    label:'None',    emoji:'🚫', css:''},
    {id:'cape',    label:'Cape',    emoji:'🦸', css:'background:linear-gradient(180deg,#e74c3c,#c0392b);border-radius:0 0 50% 50%;position:absolute;top:0;left:-10px;right:-10px;height:120%;z-index:-1;'},
    {id:'wings',   label:'Wings',   emoji:'🦋', css:'background:linear-gradient(90deg,#f39c12,#e67e22);border-radius:50% 0 50% 0;position:absolute;top:5px;left:-30px;right:-30px;height:80%;z-index:-1;opacity:0.8;'},
    {id:'scarf',   label:'Scarf',   emoji:'🧣', css:'background:linear-gradient(90deg,#e74c3c,#fff,#e74c3c);height:12px;position:absolute;top:-2px;left:0;right:0;border-radius:4px;'},
    {id:'armor',   label:'Armor',   emoji:'⚔️', css:'background:linear-gradient(135deg,#95a5a6,#7f8c8d);border:2px solid #bdc3c7;position:absolute;inset:0;border-radius:4px;opacity:0.6;'},
    {id:'jetpack', label:'Jetpack', emoji:'🚀', css:'background:#e67e22;border-radius:4px;position:absolute;top:4px;left:-18px;width:14px;height:80%;'},
];
const FACES = [
    {id:'smile',    label:'Smile',    e:'😊'},
    {id:'cool',     label:'Cool',     e:'😎'},
    {id:'angry',    label:'Angry',    e:'😠'},
    {id:'wink',     label:'Wink',     e:'😉'},
    {id:'surprised',label:'Surprised',e:'😮'},
    {id:'lol',      label:'LOL',      e:'😂'},
    {id:'sleepy',   label:'Sleepy',   e:'😴'},
    {id:'star',     label:'Star',     e:'🤩'},
    {id:'devil',    label:'Devil',    e:'😈'},
    {id:'alien',    label:'Alien',    e:'👽'},
    {id:'robot',    label:'Robot',    e:'🤖'},
    {id:'clown',    label:'Clown',    e:'🤡'},
];

let currentAvatar = { skin:'#FFDBB4', pants:'#2c3e50', hat:'cap', clothes:'tshirt', accessory:'none', face:'smile' };

// ── Game Data ─────────────────────────────────
const BUILTIN_GAMES = [
    { id:1, name:'Obby Run',       emoji:'🧗', desc:'Parkour across epic obstacle courses!', color:'#e74c3c', builtin:true },
    { id:2, name:'Tycoon Empire',  emoji:'🏗️', desc:'Build and grow your business empire!',  color:'#f39c12', builtin:true },
    { id:3, name:'Adventure Quest',emoji:'⚔️', desc:'Explore dungeons and defeat enemies!',  color:'#27ae60', builtin:true },
    { id:4, name:'Racing Madness', emoji:'🏎️', desc:'Race against players at top speed!',    color:'#3498db', builtin:true },
    { id:5, name:'Mystery Manor',  emoji:'🏚️', desc:'Solve puzzles in a haunted manor!',     color:'#9b59b6', builtin:true },
    { id:6, name:'Survival Island',emoji:'🏝️', desc:'Gather resources and survive!',         color:'#1abc9c', builtin:true },
];
function getPlayerCount(id) {
    const base = { 1:42, 2:18, 3:67, 4:91, 5:29, 6:55 };
    return (base[id] || 10) + Math.floor(Math.random()*8);
}

// ── Studio Data ───────────────────────────────
const BLOCK_COLORS = [
    '#ffffff','#cccccc','#888888','#444444','#111111',
    '#e74c3c','#e67e22','#f1c40f','#2ecc71','#1abc9c',
    '#3498db','#9b59b6','#ff6b9d','#00cec9','#fdcb6e',
    '#a29bfe','#55efc4','#fd79a8','#636e72','#b2bec3',
];
const BLOCK_TYPES = ['Solid','Brick','Wood','Stone','Glass','Sand','Grass','Metal'];
let studioState = {
    tool: 'place',
    color: '#3498db',
    blockType: 'Solid',
    world: null,
    worlds: [],
    blocks: {},   // "x,y" -> { color, type }
    cameraX: 0, cameraY: 0,
    zoom: 1,
    dragging: false, dragStart: null, camStart: null,
    blockSize: 32,
    mouseDown: false, lastCell: null,
};

// ── Globals ───────────────────────────────────
const userManager = new UserManager();
const messaging   = new Messaging();
let gameEngine   = null;
let openMsgId    = null;
let currentFriendTab = 'friends';
let currentMsgTab    = 'inbox';
let studioCanvas = null, studioCtx = null;
let studioRAF    = null;

// ═════════════════════════════════════════════
// NAVIGATION
// ═════════════════════════════════════════════
function showSection(id) {
    const protected_ = ['profile','customize','messages','friends','studio'];
    if (protected_.includes(id) && !userManager.isLoggedIn()) {
        showToast('🔒 Sign in first!', 'error');
        showSection('login');
        return;
    }
    // Stop game if leaving gameView
    if (id !== 'gameView' && gameEngine) exitGame();
    // Stop studio if leaving
    if (id !== 'studio' && studioRAF) { cancelAnimationFrame(studioRAF); studioRAF = null; }

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(id);
    if (sec) sec.classList.add('active');

    // Section loaders
    if (id === 'games')    loadGames();
    else if (id === 'profile')  loadProfile();
    else if (id === 'customize') loadCustomize();
    else if (id === 'messages') loadMessages();
    else if (id === 'friends')  loadFriends();
    else if (id === 'studio')   initStudio();

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateNav() {
    const li = userManager.isLoggedIn();
    const els = {
        loginBtn:'block', registerBtn:'block', logoutBtn:'none',
        studioLink:'none', avatarLink:'none', friendsLink:'none', messagesLink:'none', profileLink:'none',
        mLogin:'block', mRegister:'block', mLogout:'none',
        mStudio:'none', mAvatar:'none', mFriends:'none', mMessages:'none', mProfile:'none',
    };
    if (li) {
        els.loginBtn='none'; els.registerBtn='none'; els.logoutBtn='block';
        els.studioLink='block'; els.avatarLink='block'; els.friendsLink='block';
        els.messagesLink='block'; els.profileLink='block';
        els.mLogin='none'; els.mRegister='none'; els.mLogout='block';
        els.mStudio='block'; els.mAvatar='block'; els.mFriends='block';
        els.mMessages='block'; els.mProfile='block';
    }
    Object.entries(els).forEach(([id, display]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = display;
    });
    // hero CTA
    const heroCta = document.getElementById('heroCta');
    const heroCtaLi = document.getElementById('heroCtaLoggedIn');
    if (heroCta) heroCta.style.display = li ? 'none' : 'flex';
    if (heroCtaLi) heroCtaLi.style.display = li ? 'flex' : 'none';

    if (li) { updateUnreadBadge(); updateFriendBadge(); }
}

function toggleMobileMenu() {
    document.getElementById('mobileMenu').classList.toggle('open');
}

// ── Auth ──────────────────────────────────────
async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm  = document.getElementById('regConfirmPassword').value;
    if (password !== confirm) { showToast('❌ Passwords do not match!', 'error'); return; }
    const r = await userManager.register(username, email, password);
    showToast(r.msg, r.ok ? 'success' : 'error');
    if (r.ok) {
        ['regUsername','regEmail','regPassword','regConfirmPassword'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        setTimeout(() => showSection('login'), 1200);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const r = await userManager.loginUser ? null : await userManager.login(username, password);
    const res = r || await userManager.login(username, password);
    showToast(res.msg, res.ok ? 'success' : 'error');
    if (res.ok) {
        ['loginUsername','loginPassword'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        updateNav();
        setTimeout(() => showSection('home'), 800);
    }
}

function handleLogout() {
    if (gameEngine) exitGame();
    userManager.logout();
    updateNav();
    showToast('👋 Signed out.', 'info');
    showSection('home');
}

// ═════════════════════════════════════════════
// GAMES
// ═════════════════════════════════════════════
function loadGames() {
    const grid = document.getElementById('gamesGrid');
    grid.innerHTML = '';

    if (!userManager.isLoggedIn()) {
        grid.innerHTML = '<p style="color:var(--text2);grid-column:1/-1;text-align:center;padding:3rem">🔒 Sign in to play games</p>';
        return;
    }

    // Load community games from studio
    const communityGames = loadCommunityGames();
    const allGames = [...BUILTIN_GAMES, ...communityGames];

    allGames.forEach(game => {
        const pc = getPlayerCount(game.id);
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <div class="game-thumb" style="background:linear-gradient(135deg,${game.color}cc,${game.color}44)">
                <span class="game-emoji">${game.emoji || '🎮'}</span>
                <span class="game-players-badge">👥 ${pc} online</span>
            </div>
            <div class="game-info">
                ${!game.builtin ? `<div class="community-badge">Community</div>` : ''}
                <h3>${game.name}</h3>
                <p>${game.desc || game.description || ''}</p>
                <button class="btn btn-primary btn-sm" onclick="playGame(${JSON.stringify(game).split('"').join("'")})">▶ Play</button>
            </div>
        `;
        grid.appendChild(card);
    });
}

function loadCommunityGames() {
    try {
        const all = JSON.parse(localStorage.getItem('pc_published_games') || '[]');
        return all.map((g, i) => ({
            ...g,
            id: 1000 + i,
            color: '#667eea',
            emoji: '🌐',
            builtin: false
        }));
    } catch { return []; }
}

function playGame(game) {
    if (typeof game === 'string') {
        try { game = JSON.parse(game.replace(/'/g, '"')); } catch { return; }
    }
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('gameView').classList.add('active');
    document.getElementById('gameTitle').textContent = `${game.emoji||'🎮'} ${game.name}`;
    document.getElementById('playerCount').textContent = `👥 ${getPlayerCount(game.id)+1} online`;
    document.getElementById('gameChatMessages').innerHTML = '';

    const canvas = document.getElementById('gameCanvas');
    setTimeout(() => {
        if (gameEngine) gameEngine.stop();
        gameEngine = new GameEngine(canvas, game);
        gameEngine.start();

        // bump play count
        const u = userManager.users.find(x => x.id === userManager.currentUser?.id);
        if (u) { u.gamesPlayed = (u.gamesPlayed||0)+1; userManager.saveUsers(); }

        // NPC chat
        const npcs = ['xXNoob123','CoolGamer99','LegendPRO','PixelFan88','StarPlayer'];
        const msgs = ['lets gooo 🔥','gg ez','who wants to team?','this level is insane','POGGG','any tips?','nice jump!','watch out!'];
        let npcInt = setInterval(() => {
            if (!gameEngine || !gameEngine.running) { clearInterval(npcInt); return; }
            const n = npcs[Math.floor(Math.random()*npcs.length)];
            const m = msgs[Math.floor(Math.random()*msgs.length)];
            gameEngine.addChat(n, m);
        }, 4000 + Math.random()*6000);
    }, 100);
}

function exitGame() {
    if (gameEngine) { gameEngine.stop(); gameEngine = null; }
    document.getElementById('gameChatMessages').innerHTML = '';
    showSection('games');
}

function sendGameChat() {
    const inp = document.getElementById('gameChatInput');
    const txt = inp.value.trim();
    if (!txt || !gameEngine) return;
    const u = userManager.getCurrentUser();
    gameEngine.addChat(u ? u.username : 'You', txt);
    inp.value = '';
}

// ═════════════════════════════════════════════
// 3D GAME ENGINE
// ═════════════════════════════════════════════
class GameEngine {
    constructor(canvas, game) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');
        this.game   = game;
        this.running = false;
        this.keys   = {};
        this.player = { x:120, y:300, vx:0, vy:0, onGround:false, dir:1 };
        this.fake   = this._fakes();
        this.platforms = this._platforms(game.id);
        this.particles = [];
        this.tick   = 0;
        this.raf    = null;
        this._resize();
        this._bindKeys();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.canvas.width  = Math.max(400, rect.width || 800);
        this.canvas.height = Math.max(300, rect.height || 500);
        this.W = this.canvas.width;
        this.H = this.canvas.height;
    }

    _bindKeys() {
        this._kd = (e) => {
            this.keys[e.key] = true;
            if (['Space',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key||e.code))
                e.preventDefault();
        };
        this._ku = (e) => { this.keys[e.key] = false; };
        document.addEventListener('keydown', this._kd);
        document.addEventListener('keyup',   this._ku);
    }

    _fakes() {
        const names = ['xXNoob123','CoolGamer99','LegendPRO','PixelFan','StarPlayerXD'];
        return Array.from({length:3}, (_,i) => ({
            name: names[i],
            x: 200 + i*160 + Math.random()*40,
            y: 200 + Math.random()*80,
            color: `hsl(${i*90+30},70%,55%)`,
            dx: (Math.random()-0.5)*1.8,
            dy: 0, vy: 0, onGround: false,
            face: ['😊','😎','🤩'][i % 3],
        }));
    }

    _platforms(id) {
        const H = this.H || 500;
        const ground = H - 40;
        const sets = {
            1: [
                {x:0,   y:ground, w:900, h:24, c:'#4a2c0d'},
                {x:60,  y:ground-80, w:130, h:20, c:'#e74c3c'},
                {x:260, y:ground-150,w:110, h:20, c:'#e67e22'},
                {x:430, y:ground-220,w:120, h:20, c:'#f1c40f'},
                {x:610, y:ground-290,w:110, h:20, c:'#2ecc71'},
                {x:770, y:ground-350,w:120, h:20, c:'#3498db'},
                {x:430, y:ground-80, w:100, h:20, c:'#9b59b6'},
            ],
            2: [
                {x:0,   y:ground, w:900, h:24, c:'#795548'},
                {x:80,  y:ground-100,w:200,h:20, c:'#607D8B'},
                {x:350, y:ground-160,w:180,h:20, c:'#455A64'},
                {x:580, y:ground-100,w:200,h:20, c:'#607D8B'},
                {x:220, y:ground-260,w:150,h:20, c:'#37474F'},
                {x:470, y:ground-280,w:150,h:20, c:'#37474F'},
            ],
            3: [
                {x:0,   y:ground, w:900, h:24, c:'#2d5a1b'},
                {x:70,  y:ground-120,w:100,h:20, c:'#4a7c2f'},
                {x:230, y:ground-200,w:90, h:20, c:'#5a8f3b'},
                {x:380, y:ground-270,w:100,h:20, c:'#6ba045'},
                {x:540, y:ground-200,w:90, h:20, c:'#5a8f3b'},
                {x:700, y:ground-280,w:120,h:20, c:'#4a7c2f'},
                {x:200, y:ground-360,w:100,h:20, c:'#3d6626'},
                {x:430, y:ground-380,w:120,h:20, c:'#3d6626'},
            ],
        };
        return sets[id] || [
            {x:0,  y:ground, w:900,h:24,c:'#444'},
            {x:80, y:ground-100,w:120,h:20,c:'#555'},
            {x:280,y:ground-180,w:120,h:20,c:'#555'},
            {x:480,y:ground-100,w:120,h:20,c:'#555'},
            {x:650,y:ground-200,w:140,h:20,c:'#555'},
        ];
    }

    start() {
        this.running = true;
        const loop = (ts) => {
            if (!this.running) return;
            this.tick++;
            this.update();
            this.draw(ts);
            this.raf = requestAnimationFrame(loop);
        };
        this.raf = requestAnimationFrame(loop);
    }

    stop() {
        this.running = false;
        if (this.raf) cancelAnimationFrame(this.raf);
        document.removeEventListener('keydown', this._kd);
        document.removeEventListener('keyup',   this._ku);
    }

    update() {
        const spd = 3.8, grav = 0.45, jump = -10;
        const p = this.player;

        if (this.keys['ArrowLeft']||this.keys['a']||this.keys['A']) { p.vx = -spd; p.dir = -1; }
        else if (this.keys['ArrowRight']||this.keys['d']||this.keys['D']) { p.vx = spd; p.dir = 1; }
        else p.vx *= 0.78;

        if ((this.keys[' ']||this.keys['ArrowUp']||this.keys['w']||this.keys['W']) && p.onGround) {
            p.vy = jump; p.onGround = false;
            this._spawnJumpParticles(p.x, p.y + 24);
        }

        p.vy += grav;
        p.x  += p.vx;
        p.y  += p.vy;

        p.onGround = false;
        for (const pl of this.platforms) {
            if (p.x+18 > pl.x && p.x-18 < pl.x+pl.w && p.y+24 > pl.y && p.y+24 < pl.y+pl.h+16 && p.vy >= 0) {
                p.y = pl.y - 24; p.vy = 0; p.onGround = true;
            }
        }

        if (p.x < 20) p.x = 20;
        if (p.x > this.W-20) p.x = this.W-20;
        if (p.y > this.H+100) { p.y = 200; p.vy = 0; p.x = 120; }

        // Fake players wander
        this.fake.forEach(fp => {
            fp.x += fp.dx;
            fp.vy = (fp.vy||0) + grav;
            fp.y  += fp.vy;
            fp.onGround = false;
            for (const pl of this.platforms) {
                if (fp.x+16 > pl.x && fp.x-16 < pl.x+pl.w && fp.y+24 > pl.y && fp.y+24 < pl.y+pl.h+16 && fp.vy >= 0) {
                    fp.y = pl.y - 24; fp.vy = 0; fp.onGround = true;
                    if (Math.random() < 0.015) fp.vy = jump * 0.8;
                }
            }
            if (fp.x < 40 || fp.x > this.W-40) fp.dx *= -1;
            if (fp.y > this.H+100) { fp.y = 200; fp.vy = 0; }
        });

        // Particles
        this.particles = this.particles.filter(p => p.life > 0);
        this.particles.forEach(p => { p.x+=p.vx; p.y+=p.vy; p.vy+=0.2; p.life--; p.alpha=p.life/p.maxLife; });
    }

    _spawnJumpParticles(x, y) {
        for (let i=0; i<8; i++) {
            this.particles.push({
                x, y, vx:(Math.random()-0.5)*4, vy:-(Math.random()*3+1),
                color:`hsl(${Math.random()*360},80%,60%)`, r:3+Math.random()*3,
                life:20, maxLife:20, alpha:1
            });
        }
    }

    draw(ts) {
        const ctx = this.ctx, W = this.W, H = this.H;

        // Sky gradient
        const skies = {
            1:['#87CEEB','#b0e0f8'], 2:['#1a1a2e','#16213e'],
            3:['#1B5E20','#33691E'], 4:['#0D47A1','#1565C0'],
            5:['#1a0033','#2d0052'], 6:['#006064','#004D40'],
        };
        const [c1,c2] = skies[this.game.id] || ['#1a1a2e','#16213e'];
        const g = ctx.createLinearGradient(0,0,0,H);
        g.addColorStop(0,c1); g.addColorStop(1,c2);
        ctx.fillStyle = g; ctx.fillRect(0,0,W,H);

        // Stars for dark skies
        if ([2,4,5].includes(this.game.id)) {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            for (let i=0;i<60;i++) {
                const sx=(i*137+ts*0.01)%W, sy=(i*89)%(H*0.6);
                const r=0.8+Math.sin(ts*0.002+i)*0.4;
                ctx.beginPath(); ctx.arc(sx,sy,r,0,Math.PI*2); ctx.fill();
            }
        }

        // Platforms
        for (const pl of this.platforms) {
            ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(pl.x+6,pl.y+6,pl.w,pl.h);
            ctx.fillStyle = pl.c; ctx.fillRect(pl.x,pl.y,pl.w,pl.h);
            ctx.fillStyle='rgba(255,255,255,0.2)'; ctx.fillRect(pl.x,pl.y,pl.w,5);
            // 3D side
            ctx.fillStyle = this._dark(pl.c,50);
            ctx.beginPath();
            ctx.moveTo(pl.x+pl.w,pl.y); ctx.lineTo(pl.x+pl.w+8,pl.y+8);
            ctx.lineTo(pl.x+pl.w+8,pl.y+pl.h+8); ctx.lineTo(pl.x+pl.w,pl.y+pl.h);
            ctx.fill();
            // Bottom
            ctx.beginPath();
            ctx.moveTo(pl.x,pl.y+pl.h); ctx.lineTo(pl.x+8,pl.y+pl.h+8);
            ctx.lineTo(pl.x+pl.w+8,pl.y+pl.h+8); ctx.lineTo(pl.x+pl.w,pl.y+pl.h);
            ctx.fillStyle = this._dark(pl.c,70); ctx.fill();
        }

        // Particles
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
            ctx.restore();
        });

        // Fake players
        this.fake.forEach(fp => this._drawChar(ctx, fp.x, fp.y, fp.color, fp.face, fp.name, false));

        // Main player
        const user = userManager.getCurrentUser();
        const av   = (user && user.avatar) ? user.avatar : currentAvatar;
        const face = FACES.find(f=>f.id===(av.face||'smile')) || FACES[0];
        const cloth= CLOTHES.find(c=>c.id===(av.clothes||'tshirt')) || CLOTHES[0];
        const clothColor = cloth.color === 'gradient' ? '#ff6b6b' : (cloth.color === 'stripe' ? '#4444cc' : cloth.color);
        this._drawChar(ctx, this.player.x, this.player.y, av.skin||'#FFDBB4', face.e, user?.username||'You', true, clothColor, av.pants||'#2c3e50');
    }

    _drawChar(ctx, x, y, skin, face, name, isPlayer, clothColor='#3498db', pantsColor='#2c3e50') {
        // Shadow
        ctx.fillStyle='rgba(0,0,0,0.18)';
        ctx.beginPath(); ctx.ellipse(x,y+26,18,5,0,0,Math.PI*2); ctx.fill();

        // Legs
        ctx.fillStyle = pantsColor;
        ctx.fillRect(x-12,y+10,10,18); ctx.fillRect(x+2,y+10,10,18);

        // Body
        ctx.fillStyle = clothColor;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x-16,y-8,32,22,3) : ctx.rect(x-16,y-8,32,22);
        ctx.fill();
        // body shading
        ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(x+4,y-8,8,22);

        // Head
        ctx.fillStyle = skin;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x-14,y-30,28,26,5);
        else ctx.rect(x-14,y-30,28,26);
        ctx.fill();
        // Head shading
        ctx.fillStyle='rgba(0,0,0,0.1)'; ctx.fillRect(x+4,y-30,8,26);

        // Face
        ctx.font='14px serif'; ctx.textAlign='center';
        ctx.fillText(face, x, y-12);

        // Player indicator
        if (isPlayer) {
            ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.font='bold 8px Space Mono,monospace';
            ctx.textAlign='center';
            ctx.fillText('YOU', x, y-34);
        }

        // Name tag
        ctx.font = isPlayer ? 'bold 10px Syne,sans-serif' : '9px Syne,sans-serif';
        const nw = ctx.measureText(name).width;
        ctx.fillStyle='rgba(0,0,0,0.55)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x-nw/2-5,y-50,nw+10,14,4);
        else ctx.rect(x-nw/2-5,y-50,nw+10,14);
        ctx.fill();
        ctx.fillStyle = isPlayer ? '#ffffff' : '#cccccc';
        ctx.fillText(name, x, y-40);
    }

    _dark(hex, amt) {
        try {
            const n=parseInt(hex.replace('#',''),16);
            const r=Math.max(0,(n>>16)-amt), g=Math.max(0,((n>>8)&0xFF)-amt), b=Math.max(0,(n&0xFF)-amt);
            return `rgb(${r},${g},${b})`;
        } catch { return '#222'; }
    }

    addChat(name, text) {
        const el = document.getElementById('gameChatMessages');
        if (!el) return;
        const div = document.createElement('div');
        div.className = 'game-chat-msg';
        div.innerHTML = `<strong>${name}:</strong> ${text}`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
        if (el.children.length > 40) el.removeChild(el.firstChild);
    }
}

// ═════════════════════════════════════════════
// STUDIO
// ═════════════════════════════════════════════
function initStudio() {
    studioCanvas = document.getElementById('studioCanvas');
    studioCtx    = studioCanvas.getContext('2d');
    studioState.worlds = loadStudioWorlds();

    if (!studioState.world) {
        if (studioState.worlds.length > 0) studioLoadWorld(studioState.worlds[0]);
        else studioNewGame();
    }

    renderStudioSidebar();
    studioResizeCanvas();
    studioBindEvents();
    studioLoop();
}

function studioResizeCanvas() {
    if (!studioCanvas) return;
    const wrap = studioCanvas.parentElement;
    const rect  = wrap.getBoundingClientRect();
    studioCanvas.width  = Math.max(400, rect.width);
    studioCanvas.height = Math.max(300, rect.height);
}

function studioLoop() {
    if (studioRAF) cancelAnimationFrame(studioRAF);
    const loop = () => {
        studioDraw();
        studioRAF = requestAnimationFrame(loop);
    };
    studioRAF = requestAnimationFrame(loop);
}

function studioDraw() {
    if (!studioCtx || !studioCanvas) return;
    const ctx = studioCtx;
    const W = studioCanvas.width, H = studioCanvas.height;
    const bs = studioState.blockSize * studioState.zoom;
    const ox = studioState.cameraX, oy = studioState.cameraY;

    // Background
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0,0,W,H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 0.5;
    const startX = Math.floor(-ox / bs) * bs + ox % bs;
    const startY = Math.floor(-oy / bs) * bs + oy % bs;
    for (let x = startX % bs; x < W; x += bs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = startY % bs; y < H; y += bs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

    // Blocks
    Object.entries(studioState.blocks).forEach(([key, block]) => {
        const [cx, cy] = key.split(',').map(Number);
        const px = cx * bs + ox, py = cy * bs + oy;
        if (px > -bs && px < W && py > -bs && py < H) {
            ctx.fillStyle = block.color;
            ctx.fillRect(px, py, bs-1, bs-1);
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(px, py, bs-1, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(px+bs-5, py, 4, bs-1);
            ctx.fillRect(px, py+bs-5, bs-1, 4);
            // Type label
            if (bs > 24 && block.type && block.type !== 'Solid') {
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.font = `${Math.max(8,bs*0.25)}px Space Mono,monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(block.type.slice(0,3).toUpperCase(), px+bs/2, py+bs/2+4);
            }
        }
    });

    // Hover highlight
    if (studioState.hoverCell) {
        const [hx,hy] = studioState.hoverCell;
        const px = hx*bs+ox, py = hy*bs+oy;
        ctx.strokeStyle = studioState.tool === 'erase' ? 'rgba(255,60,60,0.7)' : 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(px+1, py+1, bs-2, bs-2);
        if (studioState.tool === 'place') {
            ctx.fillStyle = studioState.color + '55';
            ctx.fillRect(px+1, py+1, bs-2, bs-2);
        }
    }

    // Block count
    const count = Object.keys(studioState.blocks).length;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(8,8,160,22);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px Space Mono,monospace'; ctx.textAlign = 'left';
    ctx.fillText(`${count} blocks  |  zoom ${Math.round(studioState.zoom*100)}%`, 14, 24);
}

function studioBindEvents() {
    if (!studioCanvas) return;
    studioCanvas.removeEventListener('mousedown', studioCanvas._md);
    studioCanvas.removeEventListener('mousemove', studioCanvas._mm);
    studioCanvas.removeEventListener('mouseup',   studioCanvas._mu);
    studioCanvas.removeEventListener('wheel',     studioCanvas._wh);
    studioCanvas.removeEventListener('contextmenu', e => e.preventDefault());

    studioCanvas._md = (e) => {
        e.preventDefault();
        if (e.button === 1 || e.button === 2) {
            studioState.dragging = true;
            studioState.dragStart = {x:e.clientX, y:e.clientY};
            studioState.camStart  = {x:studioState.cameraX, y:studioState.cameraY};
        } else {
            studioState.mouseDown = true;
            studioApplyTool(e);
        }
    };
    studioCanvas._mm = (e) => {
        const rect = studioCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const bs = studioState.blockSize * studioState.zoom;
        studioState.hoverCell = [
            Math.floor((mx - studioState.cameraX) / bs),
            Math.floor((my - studioState.cameraY) / bs)
        ];
        if (studioState.dragging) {
            studioState.cameraX = studioState.camStart.x + (e.clientX - studioState.dragStart.x);
            studioState.cameraY = studioState.camStart.y + (e.clientY - studioState.dragStart.y);
        }
        if (studioState.mouseDown) studioApplyTool(e);
    };
    studioCanvas._mu = (e) => {
        studioState.mouseDown = false;
        studioState.dragging  = false;
        studioState.lastCell  = null;
    };
    studioCanvas._wh = (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.88;
        studioState.zoom = Math.max(0.2, Math.min(5, studioState.zoom * factor));
    };

    studioCanvas.addEventListener('mousedown',   studioCanvas._md);
    studioCanvas.addEventListener('mousemove',   studioCanvas._mm);
    studioCanvas.addEventListener('mouseup',     studioCanvas._mu);
    studioCanvas.addEventListener('wheel',       studioCanvas._wh, {passive:false});
    studioCanvas.addEventListener('contextmenu', e => e.preventDefault());
}

function studioApplyTool(e) {
    if (!studioCanvas) return;
    const rect = studioCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const bs = studioState.blockSize * studioState.zoom;
    const cx = Math.floor((mx - studioState.cameraX) / bs);
    const cy = Math.floor((my - studioState.cameraY) / bs);
    const key = `${cx},${cy}`;
    if (studioState.lastCell === key) return;
    studioState.lastCell = key;

    if (studioState.tool === 'place') {
        studioState.blocks[key] = { color: studioState.color, type: studioState.blockType };
    } else if (studioState.tool === 'erase') {
        delete studioState.blocks[key];
    } else if (studioState.tool === 'paint') {
        if (studioState.blocks[key]) studioState.blocks[key].color = studioState.color;
    }
}

function setStudioTool(t) {
    studioState.tool = t;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('tool' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.add('active');
}

function renderStudioSidebar() {
    // Colors
    const colorEl = document.getElementById('studioColors');
    if (colorEl) {
        colorEl.innerHTML = '';
        BLOCK_COLORS.forEach(c => {
            const btn = document.createElement('button');
            btn.className = 'block-color-btn' + (studioState.color === c ? ' selected' : '');
            btn.style.background = c;
            btn.title = c;
            btn.onclick = () => {
                studioState.color = c;
                document.querySelectorAll('.block-color-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            };
            colorEl.appendChild(btn);
        });
    }

    // Block types
    const typesEl = document.getElementById('studioBlockTypes');
    if (typesEl) {
        typesEl.innerHTML = '';
        BLOCK_TYPES.forEach(t => {
            const btn = document.createElement('button');
            btn.className = 'block-type-btn' + (studioState.blockType === t ? ' selected' : '');
            btn.textContent = t;
            btn.onclick = () => {
                studioState.blockType = t;
                document.querySelectorAll('.block-type-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            };
            typesEl.appendChild(btn);
        });
    }

    refreshStudioGameList();
}

function refreshStudioGameList() {
    const el = document.getElementById('studioGameList');
    if (!el) return;
    el.innerHTML = '';
    studioState.worlds.forEach((w, i) => {
        const item = document.createElement('div');
        item.className = 'studio-game-item' + (studioState.world === w.id ? ' active-world' : '');
        item.textContent = w.name || `World ${i+1}`;
        item.onclick = () => studioLoadWorld(w);
        el.appendChild(item);
    });
}

function studioNewGame() {
    const id = 'world_' + Date.now();
    const name = `My World ${studioState.worlds.length + 1}`;
    studioState.blocks = {};
    studioState.world  = id;
    studioState.cameraX = 0; studioState.cameraY = 0;
    studioState.zoom = 1;
    const wn = document.getElementById('studioWorldName');
    if (wn) wn.value = name;
    refreshStudioGameList();
}

function studioLoadWorld(w) {
    studioState.world  = w.id;
    studioState.blocks = w.blocks ? JSON.parse(JSON.stringify(w.blocks)) : {};
    studioState.cameraX = 0; studioState.cameraY = 0; studioState.zoom = 1;
    const wn = document.getElementById('studioWorldName');
    if (wn) wn.value = w.name || '';
    refreshStudioGameList();
}

function studioSave() {
    if (!studioState.world) studioState.world = 'world_' + Date.now();
    const name = (document.getElementById('studioWorldName')?.value || '').trim() || `World ${studioState.worlds.length+1}`;
    const idx = studioState.worlds.findIndex(w => w.id === studioState.world);
    const entry = { id: studioState.world, name, blocks: JSON.parse(JSON.stringify(studioState.blocks)) };
    if (idx >= 0) studioState.worlds[idx] = entry;
    else studioState.worlds.push(entry);
    saveStudioWorlds(studioState.worlds);

    // bump count
    const user = userManager.users.find(u => u.id === userManager.currentUser?.id);
    if (user && idx < 0) { user.worldsBuilt = (user.worldsBuilt||0)+1; userManager.saveUsers(); }

    showToast('💾 World saved!', 'success');
    refreshStudioGameList();
}

function studioPublish() {
    studioSave();
    const name = (document.getElementById('studioWorldName')?.value || '').trim() || 'Untitled World';
    const user = userManager.getCurrentUser();
    const existing = JSON.parse(localStorage.getItem('pc_published_games') || '[]');
    const alreadyIdx = existing.findIndex(g => g.worldId === studioState.world);
    const entry = {
        worldId: studioState.world,
        name,
        desc: `Built by ${user?.username || 'Unknown'}`,
        author: user?.username,
        publishedAt: new Date().toISOString(),
        blocks: JSON.parse(JSON.stringify(studioState.blocks)),
    };
    if (alreadyIdx >= 0) existing[alreadyIdx] = entry;
    else existing.push(entry);
    localStorage.setItem('pc_published_games', JSON.stringify(existing));
    showToast('🚀 World published to Games!', 'success');
}

function loadStudioWorlds() {
    const userId = userManager.currentUser?.id;
    if (!userId) return [];
    try { return JSON.parse(localStorage.getItem(`pc_studio_${userId}`) || '[]'); }
    catch { return []; }
}

function saveStudioWorlds(worlds) {
    const userId = userManager.currentUser?.id;
    if (!userId) return;
    localStorage.setItem(`pc_studio_${userId}`, JSON.stringify(worlds));
}

// ═════════════════════════════════════════════
// AVATAR
// ═════════════════════════════════════════════
function loadCustomize() {
    const user = userManager.getCurrentUser();
    if (user?.avatar) currentAvatar = { ...currentAvatar, ...user.avatar };

    // Skin
    const skinEl = document.getElementById('skinColors');
    if (skinEl) {
        skinEl.innerHTML = '';
        SKIN_COLORS.forEach(sc => {
            const btn = document.createElement('button');
            btn.className = 'color-swatch' + (currentAvatar.skin === sc.color ? ' selected' : '');
            btn.style.background = sc.color; btn.title = sc.label;
            btn.onclick = () => { currentAvatar.skin = sc.color; document.querySelectorAll('#skinColors .color-swatch').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); updateAvPreview(); };
            skinEl.appendChild(btn);
        });
    }

    // Pants
    const pantsEl = document.getElementById('pantsColors');
    if (pantsEl) {
        pantsEl.innerHTML = '';
        PANTS_COLORS.forEach(pc2 => {
            const btn = document.createElement('button');
            btn.className = 'color-swatch' + (currentAvatar.pants === pc2.color ? ' selected' : '');
            btn.style.background = pc2.color; btn.title = pc2.label;
            btn.onclick = () => { currentAvatar.pants = pc2.color; document.querySelectorAll('#pantsColors .color-swatch').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); updateAvPreview(); };
            pantsEl.appendChild(btn);
        });
    }

    renderItemGrid2('hatsGrid',      HATS,        'hat');
    renderItemGrid2('clothesGrid',   CLOTHES,     'clothes');
    renderItemGrid2('accessoriesGrid',ACCESSORIES,'accessory');
    renderFacesGrid2();
    updateAvPreview();
}

function renderItemGrid2(containerId, items, prop) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'item-btn' + (currentAvatar[prop] === item.id ? ' selected' : '');
        btn.innerHTML = `<span>${item.emoji || item.e || ''}</span><small>${item.label}</small>`;
        btn.onclick = () => {
            currentAvatar[prop] = item.id;
            el.querySelectorAll('.item-btn').forEach(b=>b.classList.remove('selected'));
            btn.classList.add('selected');
            updateAvPreview();
        };
        el.appendChild(btn);
    });
}

function renderFacesGrid2() {
    const el = document.getElementById('facesGrid');
    if (!el) return;
    el.innerHTML = '';
    FACES.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'item-btn' + (currentAvatar.face === f.id ? ' selected' : '');
        btn.innerHTML = `<span style="font-size:1.5rem">${f.e}</span><small>${f.label}</small>`;
        btn.onclick = () => {
            currentAvatar.face = f.id;
            el.querySelectorAll('.item-btn').forEach(b=>b.classList.remove('selected'));
            btn.classList.add('selected');
            updateAvPreview();
        };
        el.appendChild(btn);
    });
}

function updateAvPreview() {
    const hat    = HATS.find(h => h.id === currentAvatar.hat)        || HATS[1];
    const clothes= CLOTHES.find(c => c.id === currentAvatar.clothes) || CLOTHES[0];
    const acc    = ACCESSORIES.find(a => a.id === currentAvatar.accessory) || ACCESSORIES[0];
    const face   = FACES.find(f => f.id === currentAvatar.face)      || FACES[0];

    const headEl = document.getElementById('avHead');
    if (headEl) headEl.style.background = currentAvatar.skin;
    const faceEl = document.getElementById('avFace');
    if (faceEl) faceEl.textContent = face.e;

    const hatEl = document.getElementById('avHat');
    if (hatEl) {
        hatEl.style.cssText = hat.css || '';
        hatEl.style.display = hat.id === 'none' ? 'none' : 'block';
        if (hat.id !== 'none') {
            hatEl.style.width  = hatEl.style.width  || '44px';
            hatEl.style.height = hatEl.style.height || '22px';
        }
    }

    const torsoEl = document.getElementById('avTorso');
    if (torsoEl) {
        if (clothes.color === 'gradient')
            torsoEl.style.background = 'linear-gradient(180deg,red,orange,yellow,green,blue,purple)';
        else if (clothes.color === 'stripe')
            torsoEl.style.background = 'repeating-linear-gradient(90deg,#222 0 8px,#4444cc 8px 16px)';
        else
            torsoEl.style.background = clothes.color;
    }

    const legEls = document.querySelectorAll('.av-leg');
    legEls.forEach(el => el.style.background = currentAvatar.pants || '#2c3e50');

    const accEl = document.getElementById('avAcc');
    if (accEl) {
        accEl.style.cssText = acc.css || '';
        accEl.style.display = acc.id === 'none' ? 'none' : 'block';
    }
}

function saveAvatar() {
    userManager.saveAvatar({ ...currentAvatar });
    showToast('🎨 Avatar saved!', 'success');
}

// ═════════════════════════════════════════════
// FRIENDS
// ═════════════════════════════════════════════
function loadFriends() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    renderFriendsTab('friends');
    renderFriendsTab('requests');
    renderFriendsTab('blocked');
    updateFriendBadge();
}

function switchFriendTab(tab, btn) {
    currentFriendTab = tab;
    document.querySelectorAll('.friends-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['friends','requests','blocked'].forEach(t => {
        const el = document.getElementById(t + 'Tab');
        if (el) el.style.display = t === tab ? 'flex' : 'none';
    });
}

function renderFriendsTab(tab) {
    const el   = document.getElementById(tab + 'Tab');
    if (!el) return;
    const user = userManager.getCurrentUser();
    const uid  = user?.id;
    el.style.flexDirection = 'column';

    if (tab === 'friends') {
        const ids = userManager.getFriends(uid);
        if (!ids.length) { el.innerHTML='<p class="empty-msg">No friends yet. Search for players!</p>'; return; }
        el.innerHTML = ids.map(fid => {
            const fu = userManager.users.find(u => u.id === fid);
            if (!fu) return '';
            const av = fu.avatar || {};
            const face = FACES.find(f => f.id === (av.face||'smile')) || FACES[0];
            return `
                <div class="friend-item">
                    <div class="friend-avatar-mini">${face.e}</div>
                    <div class="friend-info">
                        <div class="friend-name">${fu.username}</div>
                        <div class="friend-status online">● Online</div>
                    </div>
                    <div class="friend-actions">
                        <button class="btn btn-sm btn-outline" onclick="sendMsgToFriend('${fu.username}')">✉</button>
                        <button class="btn btn-sm btn-danger" onclick="removeFriend(${fid})">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    } else if (tab === 'requests') {
        const reqs = userManager.getRequests(uid);
        if (!reqs.length) { el.innerHTML='<p class="empty-msg">No pending requests.</p>'; return; }
        el.innerHTML = reqs.map(r => `
            <div class="friend-item">
                <div class="friend-avatar-mini">👤</div>
                <div class="friend-info">
                    <div class="friend-name">${r.fromName}</div>
                    <div class="friend-status">Wants to be friends</div>
                </div>
                <div class="friend-actions">
                    <button class="btn btn-sm btn-primary" onclick="acceptFriend(${r.from})">✓</button>
                    <button class="btn btn-sm btn-danger"  onclick="declineFriend(${r.from})">✕</button>
                </div>
            </div>
        `).join('');
    } else if (tab === 'blocked') {
        const ids = userManager.getBlocked(uid);
        if (!ids.length) { el.innerHTML='<p class="empty-msg">No blocked users.</p>'; return; }
        el.innerHTML = ids.map(bid => {
            const bu = userManager.users.find(u => u.id === bid);
            if (!bu) return '';
            return `
                <div class="friend-item">
                    <div class="friend-avatar-mini">🚫</div>
                    <div class="friend-info"><div class="friend-name">${bu.username}</div></div>
                    <div class="friend-actions">
                        <button class="btn btn-sm btn-outline" onclick="unblockUser(${bid})">Unblock</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

function searchPlayers() {
    const q = document.getElementById('friendSearchInput')?.value.trim().toLowerCase();
    const el = document.getElementById('playerSearchResults');
    if (!el) return;
    if (!q || q.length < 2) { el.innerHTML = ''; return; }
    const user = userManager.getCurrentUser();
    const results = userManager.users.filter(u =>
        u.username.toLowerCase().includes(q) && u.id !== user?.id
    ).slice(0, 8);
    if (!results.length) { el.innerHTML = '<p class="empty-msg">No players found.</p>'; return; }
    el.innerHTML = results.map(u => {
        const isFriend = (userManager.getFriends(user.id)||[]).includes(u.id);
        const isBlocked= (userManager.getBlocked(user.id)||[]).includes(u.id);
        return `
            <div class="player-result-item">
                <span class="player-result-name">👤 ${u.username}</span>
                ${isFriend
                    ? `<button class="btn btn-sm btn-danger" onclick="removeFriend(${u.id})">Remove</button>`
                    : isBlocked
                    ? `<button class="btn btn-sm btn-outline" onclick="unblockUser(${u.id})">Unblock</button>`
                    : `<button class="btn btn-sm btn-primary" onclick="addFriend('${u.username}')">+ Add</button>`
                }
            </div>
        `;
    }).join('');
}

function addFriend(username) {
    const user = userManager.getCurrentUser();
    const r = userManager.sendFriendRequest(user.id, username);
    showToast(r.msg, r.ok ? 'success' : 'error');
    searchPlayers();
}

function acceptFriend(fromId) {
    const user = userManager.getCurrentUser();
    userManager.acceptRequest(user.id, fromId);
    showToast('✅ Friend added!', 'success');
    loadFriends();
}

function declineFriend(fromId) {
    const user = userManager.getCurrentUser();
    userManager.declineRequest(user.id, fromId);
    showToast('Request declined.', 'info');
    loadFriends();
}

function removeFriend(friendId) {
    const user = userManager.getCurrentUser();
    userManager.removeFriend(user.id, friendId);
    showToast('Friend removed.', 'info');
    loadFriends();
}

function blockUser(targetId) {
    const user = userManager.getCurrentUser();
    userManager.blockUser(user.id, targetId);
    showToast('User blocked.', 'info');
    loadFriends();
}

function unblockUser(targetId) {
    const user = userManager.getCurrentUser();
    userManager.unblockUser(user.id, targetId);
    showToast('User unblocked.', 'success');
    loadFriends();
}

function sendMsgToFriend(username) {
    showSection('messages');
    const el = document.getElementById('msgTo');
    if (el) el.value = username;
}

function updateFriendBadge() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    const count = userManager.getRequests(user.id).length;
    const badge = document.getElementById('friendReqBadge');
    const req   = document.getElementById('reqCount');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
    if (req)   { req.textContent   = count; req.style.display   = count > 0 ? 'inline-flex' : 'none'; }
}

// ═════════════════════════════════════════════
// MESSAGES
// ═════════════════════════════════════════════
function loadMessages() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    renderInbox(user.username);
    renderSent(user.username);
    updateUnreadBadge();
}

function renderInbox(username) {
    const inbox = messaging.inbox(username);
    const el    = document.getElementById('inboxList');
    if (!el) return;
    if (!inbox.length) { el.innerHTML='<p class="empty-msg">📭 No messages yet.</p>'; return; }
    el.innerHTML = inbox.map(m => `
        <div class="msg-item ${m.read?'':'unread'}" onclick="openMsg(${m.id})">
            <div class="msg-from">From: <strong>${m.from}</strong> ${m.read?'':'<span class="new-badge">NEW</span>'}</div>
            <div class="msg-subject">${m.subject}</div>
            <div class="msg-preview">${m.body.substring(0,80)}${m.body.length>80?'…':''}</div>
            <div class="msg-time">${fmtDate(m.at)}</div>
        </div>
    `).join('');
}

function renderSent(username) {
    const sent = messaging.sent(username);
    const el   = document.getElementById('sentList');
    if (!el) return;
    if (!sent.length) { el.innerHTML='<p class="empty-msg">📭 No sent messages.</p>'; return; }
    el.innerHTML = sent.map(m => `
        <div class="msg-item" onclick="openMsg(${m.id})">
            <div class="msg-from">To: <strong>${m.to}</strong></div>
            <div class="msg-subject">${m.subject}</div>
            <div class="msg-preview">${m.body.substring(0,80)}${m.body.length>80?'…':''}</div>
            <div class="msg-time">${fmtDate(m.at)}</div>
        </div>
    `).join('');
}

function switchMsgTab(tab, btn) {
    currentMsgTab = tab;
    document.querySelectorAll('.inbox-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('inboxList').style.display = tab==='inbox' ? 'flex' : 'none';
    document.getElementById('sentList').style.display  = tab==='sent'  ? 'flex' : 'none';
}

function sendMessage() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    const to      = document.getElementById('msgTo')?.value  || '';
    const subject = document.getElementById('msgSubject')?.value || '';
    const body    = document.getElementById('msgBody')?.value || '';
    const r = messaging.send(user.username, to, subject, body);
    showToast(r.msg, r.ok ? 'success' : 'error');
    if (r.ok) {
        ['msgTo','msgSubject','msgBody'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        renderSent(user.username);
        updateUnreadBadge();
    }
}

function openMsg(id) {
    const msg = messaging.get(id);
    if (!msg) return;
    openMsgId = id;
    messaging.markRead(id);
    document.getElementById('modalFrom').textContent = `${msg.from} → ${msg.to}`;
    document.getElementById('modalDate').textContent = fmtDate(msg.at);
    document.getElementById('modalSubject').textContent = msg.subject;
    document.getElementById('modalBody').textContent    = msg.body;
    document.getElementById('messageModal').style.display = 'flex';
    updateUnreadBadge();
    const user = userManager.getCurrentUser();
    if (user) renderInbox(user.username);
}

function closeMessageModal() {
    document.getElementById('messageModal').style.display = 'none';
    openMsgId = null;
}

function replyToMessage() {
    const msg = messaging.get(openMsgId);
    if (!msg) return;
    closeMessageModal();
    const user = userManager.getCurrentUser();
    const replyTo = msg.from === user.username ? msg.to : msg.from;
    const toEl = document.getElementById('msgTo'); if (toEl) toEl.value = replyTo;
    const subEl = document.getElementById('msgSubject'); if (subEl) subEl.value = `Re: ${msg.subject}`;
    document.getElementById('msgBody')?.focus();
}

function updateUnreadBadge() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    const count = messaging.unread(user.username);
    const badge = document.getElementById('unreadBadge');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline-flex' : 'none'; }
}

function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

// ═════════════════════════════════════════════
// PROFILE
// ═════════════════════════════════════════════
function loadProfile() {
    const user = userManager.getCurrentUser();
    if (!user) { showSection('login'); return; }
    userManager.syncStats();

    document.getElementById('profileUsername').textContent = user.username;
    document.getElementById('pUsername').textContent = user.username;
    document.getElementById('pEmail').textContent    = user.email;
    document.getElementById('pJoined').textContent   = new Date(user.createdAt).toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'});

    const uid  = user.id;
    const fCount = userManager.getFriends(uid).length;
    const u    = userManager.users.find(x => x.id === uid);
    document.getElementById('pFriends').textContent    = fCount;
    document.getElementById('pGamesPlayed').textContent = u?.gamesPlayed || 0;
    document.getElementById('pWorldsBuilt').textContent = u?.worldsBuilt  || 0;

    // Avatar preview in profile
    const av   = user.avatar || currentAvatar;
    const face = FACES.find(f => f.id === (av.face||'smile')) || FACES[0];
    const cloth= CLOTHES.find(c => c.id === (av.clothes||'tshirt')) || CLOTHES[0];
    const clothColor = cloth.color === 'gradient' ? '#ff6b6b' : (cloth.color === 'stripe' ? '#4444cc' : cloth.color);

    const stage = document.getElementById('profileAvStage');
    if (stage) {
        stage.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;gap:0;animation:avBob 2s ease-in-out infinite">
                <div style="width:44px;height:22px;background:${(HATS.find(h=>h.id===(av.hat||'cap'))||HATS[1]).id==='none'?'transparent':'#e74c3c'};border-radius:8px 8px 0 0"></div>
                <div style="width:52px;height:52px;background:${av.skin||'#FFDBB4'};border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:1.5rem">${face.e}</div>
                <div style="width:64px;height:56px;background:${clothColor};border-radius:4px"></div>
                <div style="display:flex;gap:4px">
                    <div style="width:28px;height:48px;background:${av.pants||'#2c3e50'};border-radius:4px"></div>
                    <div style="width:28px;height:48px;background:${av.pants||'#2c3e50'};border-radius:4px"></div>
                </div>
            </div>
        `;
    }

    // Badges
    const badges = document.getElementById('profileBadges');
    if (badges) {
        const bs = [];
        if ((u?.gamesPlayed||0) >= 1)  bs.push('🎮 Player');
        if ((u?.gamesPlayed||0) >= 10) bs.push('🔥 Veteran');
        if ((u?.worldsBuilt||0) >= 1)  bs.push('🔨 Builder');
        if (fCount >= 1)               bs.push('👥 Social');
        if (!bs.length) bs.push('⭐ New Member');
        badges.innerHTML = bs.map(b => `<span class="profile-badge">${b}</span>`).join('');
    }
}

// ═════════════════════════════════════════════
// TOAST
// ═════════════════════════════════════════════
let toastTimer = null;
function showToast(text, type='info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.className = `toast show ${type}`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}

// ═════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    updateNav();
    showSection('home');

    // Modal background click
    const modal = document.getElementById('messageModal');
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeMessageModal(); });

    // Studio canvas resize
    window.addEventListener('resize', () => {
        studioResizeCanvas();
        if (gameEngine) gameEngine._resize();
    });

    // Periodically refresh badges
    setInterval(() => {
        if (userManager.isLoggedIn()) { updateUnreadBadge(); updateFriendBadge(); }
    }, 5000);
});
