// ============================================
// SECURITY: Password Hashing with SHA-256 + Salt
// ============================================
class PasswordManager {
    static generateSalt() {
        return Math.random().toString(36).substring(2, 15) +
               Math.random().toString(36).substring(2, 15);
    }

    static async hashPasswordWithSalt(password, salt) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password + salt);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

// ============================================
// USER MANAGER
// ============================================
class MultiUserManager {
    constructor() {
        this.users = this.loadUsers();
        this.currentUser = this.loadCurrentUser();
        this.lastAccountCreationTime = this.loadLastCreationTime();
    }

    loadUsers() {
        const stored = localStorage.getItem('robloxUsers');
        return stored ? JSON.parse(stored) : [];
    }

    saveUsers() {
        localStorage.setItem('robloxUsers', JSON.stringify(this.users));
    }

    loadCurrentUser() {
        const stored = localStorage.getItem('robloxCurrentUser');
        return stored ? JSON.parse(stored) : null;
    }

    saveCurrentUser() {
        if (this.currentUser) {
            localStorage.setItem('robloxCurrentUser', JSON.stringify(this.currentUser));
        } else {
            localStorage.removeItem('robloxCurrentUser');
        }
    }

    loadLastCreationTime() {
        const stored = localStorage.getItem('robloxLastCreationTime');
        return stored ? parseInt(stored) : 0;
    }

    saveLastCreationTime() {
        localStorage.setItem('robloxLastCreationTime', Date.now().toString());
    }

    canCreateAccount() {
        const now = Date.now();
        const cooldownMs = 2 * 60 * 1000;
        return (now - this.lastAccountCreationTime) >= cooldownMs;
    }

    getTimeUntilNextAccount() {
        const cooldownMs = 2 * 60 * 1000;
        return Math.ceil((cooldownMs - (Date.now() - this.lastAccountCreationTime)) / 1000);
    }

    async registerUser(username, email, password) {
        if (!this.canCreateAccount() && this.lastAccountCreationTime > 0) {
            const t = this.getTimeUntilNextAccount();
            return { success: false, message: `⏱️ Wait ${t} seconds before creating another account.` };
        }
        if (username.length < 3)
            return { success: false, message: '❌ Username must be at least 3 characters!' };
        if (this.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
            return { success: false, message: '❌ Username already taken!' };
        if (this.users.find(u => u.email.toLowerCase() === email.toLowerCase()))
            return { success: false, message: '❌ Email already registered!' };
        if (password.length < 8)
            return { success: false, message: '❌ Password must be at least 8 characters!' };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return { success: false, message: '❌ Please enter a valid email address!' };

        try {
            const salt = PasswordManager.generateSalt();
            const hashedPassword = await PasswordManager.hashPasswordWithSalt(password, salt);
            const newUser = {
                id: Date.now(),
                username, email,
                passwordHash: hashedPassword,
                salt,
                createdAt: new Date().toISOString(),
                lastLogin: null,
                loginAttempts: 0,
                locked: false,
                lockTime: null,
                avatar: null
            };
            this.users.push(newUser);
            this.saveUsers();
            this.saveLastCreationTime();
            return { success: true, message: '✅ Account created! Please log in.' };
        } catch {
            return { success: false, message: '❌ Error creating account. Please try again.' };
        }
    }

    async loginUser(username, password) {
        const user = this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        if (!user) return { success: false, message: '❌ No account found with that username!' };

        if (user.locked) {
            const lockDuration = 15 * 60 * 1000;
            const lockTime = new Date(user.lockTime);
            const now = new Date();
            if (now - lockTime < lockDuration) {
                const rem = Math.ceil((lockDuration - (now - lockTime)) / 60000);
                return { success: false, message: `🔒 Account locked. Try again in ${rem} minute(s).` };
            }
            user.locked = false;
            user.loginAttempts = 0;
            this.saveUsers();
        }

        try {
            const hashedInput = await PasswordManager.hashPasswordWithSalt(password, user.salt);
            if (hashedInput !== user.passwordHash) {
                user.loginAttempts = (user.loginAttempts || 0) + 1;
                if (user.loginAttempts >= 5) {
                    user.locked = true;
                    user.lockTime = new Date().toISOString();
                    this.saveUsers();
                    return { success: false, message: '🔒 Too many failed attempts. Account locked for 15 minutes.' };
                }
                this.saveUsers();
                return { success: false, message: `❌ Invalid password! (${5 - user.loginAttempts} attempts left)` };
            }

            user.loginAttempts = 0;
            user.lastLogin = new Date().toISOString();
            this.saveUsers();

            this.currentUser = {
                id: user.id,
                username: user.username,
                email: user.email,
                createdAt: user.createdAt,
                avatar: user.avatar
            };
            this.saveCurrentUser();
            return { success: true, message: '✅ Logged in successfully!' };
        } catch {
            return { success: false, message: '❌ Error during login. Please try again.' };
        }
    }

    logoutUser() {
        this.currentUser = null;
        this.saveCurrentUser();
    }

    getCurrentUser() { return this.currentUser; }
    isLoggedIn() { return this.currentUser !== null; }
    getUserByUsername(username) {
        return this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }

    saveAvatar(avatarData) {
        const user = this.users.find(u => u.id === this.currentUser.id);
        if (user) {
            user.avatar = avatarData;
            this.saveUsers();
            this.currentUser.avatar = avatarData;
            this.saveCurrentUser();
        }
    }
}

// ============================================
// MESSAGING SYSTEM
// ============================================
class MessagingSystem {
    loadMessages() {
        const stored = localStorage.getItem('robloxMessages');
        return stored ? JSON.parse(stored) : [];
    }

    saveMessages(messages) {
        localStorage.setItem('robloxMessages', JSON.stringify(messages));
    }

    sendMessage(fromUsername, toUsername, subject, body) {
        if (!toUsername.trim()) return { success: false, message: '❌ Please enter a recipient username.' };
        if (!subject.trim()) return { success: false, message: '❌ Please enter a subject.' };
        if (!body.trim()) return { success: false, message: '❌ Please write a message.' };

        const recipient = userManager.getUserByUsername(toUsername.trim());
        if (!recipient) return { success: false, message: `❌ User "${toUsername}" not found.` };
        if (recipient.username.toLowerCase() === fromUsername.toLowerCase())
            return { success: false, message: '❌ You cannot message yourself.' };

        const messages = this.loadMessages();
        const newMsg = {
            id: Date.now(),
            from: fromUsername,
            to: recipient.username,
            subject: subject.trim(),
            body: body.trim(),
            timestamp: new Date().toISOString(),
            read: false
        };
        messages.push(newMsg);
        this.saveMessages(messages);
        return { success: true, message: `✅ Message sent to ${recipient.username}!` };
    }

    getInbox(username) {
        return this.loadMessages()
            .filter(m => m.to.toLowerCase() === username.toLowerCase())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    getSent(username) {
        return this.loadMessages()
            .filter(m => m.from.toLowerCase() === username.toLowerCase())
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }

    getUnreadCount(username) {
        return this.loadMessages().filter(m => m.to.toLowerCase() === username.toLowerCase() && !m.read).length;
    }

    markAsRead(messageId) {
        const messages = this.loadMessages();
        const msg = messages.find(m => m.id === messageId);
        if (msg) { msg.read = true; this.saveMessages(messages); }
    }
}

// ============================================
// AVATAR CUSTOMISATION DATA
// ============================================
const SKIN_COLORS = [
    { id: 'skin1', color: '#FFDBB4', label: 'Light' },
    { id: 'skin2', color: '#F1C27D', label: 'Tan' },
    { id: 'skin3', color: '#E0AC69', label: 'Warm' },
    { id: 'skin4', color: '#C68642', label: 'Brown' },
    { id: 'skin5', color: '#8D5524', label: 'Dark' },
    { id: 'skin6', color: '#FF6B9D', label: 'Pink' },
    { id: 'skin7', color: '#6BCBFF', label: 'Blue' },
    { id: 'skin8', color: '#7FFF6B', label: 'Green' },
];

const HATS = [
    { id: 'none', label: 'None', emoji: '🚫', style: '' },
    { id: 'cap', label: 'Cap', emoji: '🧢', style: 'background:#e74c3c;border-radius:50% 50% 0 0;' },
    { id: 'tophat', label: 'Top Hat', emoji: '🎩', style: 'background:#2c3e50;border-radius:4px 4px 0 0;height:130%;' },
    { id: 'wizard', label: 'Wizard', emoji: '🧙', style: 'background:linear-gradient(180deg,#9b59b6,#6c3483);clip-path:polygon(50% 0%,0% 100%,100% 100%);border-radius:0;' },
    { id: 'cowboy', label: 'Cowboy', emoji: '🤠', style: 'background:#8B6914;border-radius:50%;width:140%;left:-20%;' },
    { id: 'crown', label: 'Crown', emoji: '👑', style: 'background:linear-gradient(180deg,#FFD700,#FFA500);clip-path:polygon(0% 100%,15% 30%,30% 100%,50% 20%,70% 100%,85% 30%,100% 100%);' },
    { id: 'propeller', label: 'Propeller', emoji: '🚁', style: 'background:#3498db;border-radius:50%;border:3px solid #2980b9;' },
    { id: 'santa', label: 'Santa', emoji: '🎅', style: 'background:#e74c3c;border-radius:50% 50% 0 0;border-bottom:4px solid white;' },
];

const CLOTHES = [
    { id: 'tshirt', label: 'T-Shirt', emoji: '👕', style: 'background:#3498db;' },
    { id: 'hoodie', label: 'Hoodie', emoji: '🧥', style: 'background:#2c3e50;' },
    { id: 'jersey', label: 'Jersey', emoji: '🏅', style: 'background:linear-gradient(180deg,#e74c3c 50%,#c0392b 50%);' },
    { id: 'suit', label: 'Suit', emoji: '🤵', style: 'background:#1a1a2e;border:2px solid #888;' },
    { id: 'tuxedo', label: 'Tuxedo', emoji: '🎭', style: 'background:linear-gradient(90deg,#000 40%,#fff 40%,#fff 60%,#000 60%);' },
    { id: 'rainbow', label: 'Rainbow', emoji: '🌈', style: 'background:linear-gradient(180deg,red,orange,yellow,green,blue,purple);' },
    { id: 'camo', label: 'Camo', emoji: '🎖️', style: 'background:#556b2f;' },
    { id: 'space', label: 'Space', emoji: '🚀', style: 'background:linear-gradient(135deg,#0a0a2e,#1a1a6e);border:2px solid #4444ff;' },
];

const ACCESSORIES = [
    { id: 'none', label: 'None', emoji: '🚫', style: '' },
    { id: 'cape', label: 'Cape', emoji: '🦸', style: 'background:linear-gradient(180deg,#e74c3c,#c0392b);border-radius:0 0 50% 50%;' },
    { id: 'wings', label: 'Wings', emoji: '🦋', style: 'background:linear-gradient(90deg,#f39c12,#e67e22);clip-path:ellipse(60% 80% at 50% 50%);' },
    { id: 'scarf', label: 'Scarf', emoji: '🧣', style: 'background:linear-gradient(90deg,#e74c3c,#fff,#e74c3c);height:20%;top:0;border-radius:4px;' },
    { id: 'armor', label: 'Armor', emoji: '⚔️', style: 'background:linear-gradient(135deg,#95a5a6,#7f8c8d);border:2px solid #bdc3c7;' },
    { id: 'jetpack', label: 'Jetpack', emoji: '🚀', style: 'background:#e67e22;border-radius:4px;width:60%;left:20%;' },
];

const FACES = [
    { id: 'smile', label: 'Smile', emoji: '😊', content: '😊' },
    { id: 'cool', label: 'Cool', emoji: '😎', content: '😎' },
    { id: 'angry', label: 'Angry', emoji: '😠', content: '😠' },
    { id: 'wink', label: 'Wink', emoji: '😉', content: '😉' },
    { id: 'surprised', label: 'Surprised', emoji: '😮', content: '😮' },
    { id: 'lol', label: 'LOL', emoji: '😂', content: '😂' },
    { id: 'sleepy', label: 'Sleepy', emoji: '😴', content: '😴' },
    { id: 'star', label: 'Star', emoji: '🤩', content: '🤩' },
];

// Current avatar state
let currentAvatar = {
    skin: '#FFDBB4',
    hat: 'cap',
    clothes: 'tshirt',
    accessory: 'none',
    face: 'smile'
};

// ============================================
// GAME DATA
// ============================================
const games = [
    { id: 1, name: 'Obby Simulator', emoji: '🧗', description: 'Complete obstacle courses!', color: '#e74c3c', players: Math.floor(Math.random()*50)+5 },
    { id: 2, name: 'Tycoon Empire', emoji: '🏗️', description: 'Build your business empire!', color: '#f39c12', players: Math.floor(Math.random()*50)+5 },
    { id: 3, name: 'Adventure Quest', emoji: '⚔️', description: 'Epic adventure awaits!', color: '#27ae60', players: Math.floor(Math.random()*50)+5 },
    { id: 4, name: 'Racing Madness', emoji: '🏎️', description: 'Race against friends!', color: '#3498db', players: Math.floor(Math.random()*50)+5 },
    { id: 5, name: 'Mystery Manor', emoji: '🏚️', description: 'Solve the mystery!', color: '#9b59b6', players: Math.floor(Math.random()*50)+5 },
    { id: 6, name: 'Survival Island', emoji: '🏝️', description: 'Survive on an island!', color: '#1abc9c', players: Math.floor(Math.random()*50)+5 },
];

// ============================================
// 3D GAME ENGINE (Canvas-based)
// ============================================
let gameEngine = null;

class GameEngine {
    constructor(canvas, gameData) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.game = gameData;
        this.running = false;
        this.keys = {};
        this.player = { x: 400, y: 300, z: 0, vx: 0, vy: 0, vz: 0, onGround: true };
        this.fakePlayers = this.generateFakePlayers();
        this.platforms = this.generatePlatforms(gameData.id);
        this.chatMessages = [];
        this.animFrame = null;
        this.resize();
        this.setupControls();
    }

    resize() {
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
        this.W = this.canvas.width;
        this.H = this.canvas.height;
    }

    generateFakePlayers() {
        const names = ['xXNoob123', 'CoolGamer99', 'LegendPRO', 'RobloxFan', 'StarPlayer', 'SpeedRun42'];
        return Array.from({ length: Math.floor(Math.random() * 3) + 2 }, (_, i) => ({
            name: names[i % names.length],
            x: 200 + i * 120 + Math.random() * 60,
            y: 200 + Math.random() * 100,
            color: `hsl(${i * 60}, 70%, 50%)`,
            dx: (Math.random() - 0.5) * 1.5,
            dy: (Math.random() - 0.5) * 0.5
        }));
    }

    generatePlatforms(gameId) {
        const sets = {
            1: [ // Obby
                { x: 50, y: 500, w: 150, h: 20, color: '#e74c3c' },
                { x: 250, y: 440, w: 100, h: 20, color: '#e67e22' },
                { x: 400, y: 380, w: 120, h: 20, color: '#f1c40f' },
                { x: 570, y: 320, w: 100, h: 20, color: '#2ecc71' },
                { x: 720, y: 260, w: 130, h: 20, color: '#3498db' },
                { x: 50, y: 560, w: 800, h: 20, color: '#8B4513' }, // ground
            ],
            2: [ // Tycoon
                { x: 50, y: 560, w: 800, h: 20, color: '#795548' },
                { x: 100, y: 460, w: 200, h: 20, color: '#607D8B' },
                { x: 350, y: 400, w: 180, h: 20, color: '#455A64' },
                { x: 580, y: 460, w: 200, h: 20, color: '#607D8B' },
            ],
            3: [ // Adventure
                { x: 50, y: 560, w: 800, h: 20, color: '#2d5a1b' },
                { x: 80, y: 480, w: 100, h: 20, color: '#4a7c2f' },
                { x: 240, y: 420, w: 80, h: 20, color: '#5a8f3b' },
                { x: 380, y: 360, w: 100, h: 20, color: '#6ba045' },
                { x: 530, y: 420, w: 80, h: 20, color: '#5a8f3b' },
                { x: 670, y: 360, w: 120, h: 20, color: '#4a7c2f' },
            ],
            default: [
                { x: 50, y: 560, w: 800, h: 20, color: '#555' },
                { x: 150, y: 460, w: 120, h: 20, color: '#666' },
                { x: 350, y: 400, w: 120, h: 20, color: '#666' },
                { x: 550, y: 460, w: 120, h: 20, color: '#666' },
            ]
        };
        return sets[gameId] || sets.default;
    }

    setupControls() {
        this._keydown = (e) => { this.keys[e.key] = true; if (e.key === ' ') e.preventDefault(); };
        this._keyup = (e) => { this.keys[e.key] = false; };
        document.addEventListener('keydown', this._keydown);
        document.addEventListener('keyup', this._keyup);
    }

    removeControls() {
        document.removeEventListener('keydown', this._keydown);
        document.removeEventListener('keyup', this._keyup);
    }

    start() {
        this.running = true;
        this.player.x = 100;
        this.player.y = 400;
        const loop = () => {
            if (!this.running) return;
            this.update();
            this.draw();
            this.animFrame = requestAnimationFrame(loop);
        };
        loop();
    }

    stop() {
        this.running = false;
        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        this.removeControls();
    }

    update() {
        const speed = 3.5;
        const gravity = 0.4;
        const jumpForce = -9;

        // Horizontal
        if (this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A']) this.player.vx = -speed;
        else if (this.keys['ArrowRight'] || this.keys['d'] || this.keys['D']) this.player.vx = speed;
        else this.player.vx *= 0.8;

        // Jump
        if ((this.keys[' '] || this.keys['ArrowUp'] || this.keys['w'] || this.keys['W']) && this.player.onGround) {
            this.player.vy = jumpForce;
            this.player.onGround = false;
        }

        // Gravity
        this.player.vy += gravity;
        this.player.x += this.player.vx;
        this.player.y += this.player.vy;

        // Platform collision
        this.player.onGround = false;
        for (const plat of this.platforms) {
            if (
                this.player.x + 18 > plat.x &&
                this.player.x - 18 < plat.x + plat.w &&
                this.player.y + 24 > plat.y &&
                this.player.y + 24 < plat.y + plat.h + 16 &&
                this.player.vy >= 0
            ) {
                this.player.y = plat.y - 24;
                this.player.vy = 0;
                this.player.onGround = true;
            }
        }

        // Bounds
        if (this.player.x < 20) this.player.x = 20;
        if (this.player.x > this.W - 20) this.player.x = this.W - 20;
        if (this.player.y > this.H) {
            this.player.y = 200;
            this.player.vy = 0;
        }

        // Move fake players
        this.fakePlayers.forEach(fp => {
            fp.x += fp.dx;
            fp.y += fp.dy * 0.3;
            if (fp.x < 80 || fp.x > this.W - 80) fp.dx *= -1;
            fp.y = Math.max(100, Math.min(540, fp.y));
        });
    }

    draw() {
        const ctx = this.ctx;
        const W = this.W, H = this.H;

        // Sky background based on game
        const skies = {
            1: ['#87CEEB', '#E0F7FA'],
            2: ['#37474F', '#263238'],
            3: ['#1B5E20', '#2E7D32'],
            4: ['#0D47A1', '#1565C0'],
            5: ['#4A148C', '#6A1B9A'],
            6: ['#006064', '#00838F'],
        };
        const sky = skies[this.game.id] || ['#1a1a2e', '#16213e'];
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, sky[0]);
        grad.addColorStop(1, sky[1]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // Stars for dark themes
        if (this.game.id === 2 || this.game.id === 5) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            for (let i = 0; i < 40; i++) {
                ctx.beginPath();
                ctx.arc((i * 137) % W, (i * 89) % (H / 2), 1.5, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Platforms with 3D effect
        for (const plat of this.platforms) {
            // Shadow
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.fillRect(plat.x + 5, plat.y + 5, plat.w, plat.h);
            // Platform face
            ctx.fillStyle = plat.color;
            ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
            // Top highlight
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(plat.x, plat.y, plat.w, 4);
            // 3D side
            ctx.fillStyle = this.darkenColor(plat.color, 40);
            ctx.beginPath();
            ctx.moveTo(plat.x + plat.w, plat.y);
            ctx.lineTo(plat.x + plat.w + 8, plat.y + 8);
            ctx.lineTo(plat.x + plat.w + 8, plat.y + plat.h + 8);
            ctx.lineTo(plat.x + plat.w, plat.y + plat.h);
            ctx.fill();
        }

        // Fake players
        this.fakePlayers.forEach(fp => {
            this.drawCharacter(ctx, fp.x, fp.y, fp.color, '😊', fp.name, false);
        });

        // Main player
        const user = userManager.getCurrentUser();
        const av = user && user.avatar ? user.avatar : currentAvatar;
        const skinColor = av.skin || '#FFDBB4';
        const face = FACES.find(f => f.id === (av.face || 'smile'));
        this.drawCharacter(ctx, this.player.x, this.player.y, skinColor, face ? face.content : '😊', user ? user.username : 'You', true);
    }

    drawCharacter(ctx, x, y, skinColor, face, name, isPlayer) {
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(x, y + 26, 18, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        ctx.fillStyle = isPlayer ? '#2c3e50' : '#555';
        ctx.fillRect(x - 12, y + 12, 10, 16);
        ctx.fillRect(x + 2, y + 12, 10, 16);

        // Body
        ctx.fillStyle = isPlayer ? (userManager.getCurrentUser()?.avatar?.clothesColor || '#3498db') : '#888';
        ctx.fillRect(x - 16, y - 6, 32, 20);

        // Head
        ctx.fillStyle = skinColor;
        ctx.beginPath();
        ctx.roundRect(x - 14, y - 28, 28, 28, 6);
        ctx.fill();

        // Face emoji
        ctx.font = '16px serif';
        ctx.textAlign = 'center';
        ctx.fillText(face, x, y - 8);

        // Name tag
        ctx.font = isPlayer ? 'bold 11px Nunito, sans-serif' : '10px Nunito, sans-serif';
        ctx.fillStyle = isPlayer ? '#FFD700' : 'white';
        ctx.textAlign = 'center';
        const nameWidth = ctx.measureText(name).width;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - nameWidth / 2 - 4, y - 46, nameWidth + 8, 14);
        ctx.fillStyle = isPlayer ? '#FFD700' : 'white';
        ctx.fillText(name, x, y - 35);
    }

    darkenColor(hex, amount) {
        try {
            const num = parseInt(hex.replace('#', ''), 16);
            const r = Math.max(0, (num >> 16) - amount);
            const g = Math.max(0, ((num >> 8) & 0xFF) - amount);
            const b = Math.max(0, (num & 0xFF) - amount);
            return `rgb(${r},${g},${b})`;
        } catch { return '#333'; }
    }

    addChatMessage(name, text) {
        this.chatMessages.push({ name, text, time: Date.now() });
        if (this.chatMessages.length > 20) this.chatMessages.shift();
        const el = document.getElementById('gameChatMessages');
        if (el) {
            const div = document.createElement('div');
            div.className = 'game-chat-msg';
            div.innerHTML = `<strong>${name}:</strong> ${text}`;
            el.appendChild(div);
            el.scrollTop = el.scrollHeight;
        }
    }
}

// ============================================
// GLOBALS
// ============================================
const userManager = new MultiUserManager();
const messaging = new MessagingSystem();
let currentTab = 'inbox';
let openMessageId = null;

// ============================================
// UI FUNCTIONS
// ============================================
function showSection(sectionId) {
    if ((sectionId === 'profile' || sectionId === 'customize' || sectionId === 'messages') && !userManager.isLoggedIn()) {
        showMessage('🔒 Please sign in first!', 'error');
        showSection('login');
        return;
    }
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(sectionId);
    if (section) section.classList.add('active');

    if (sectionId === 'games') loadGames();
    else if (sectionId === 'profile') loadProfile();
    else if (sectionId === 'customize') loadCustomize();
    else if (sectionId === 'messages') loadMessages();
    else if (sectionId !== 'gameView' && gameEngine) exitGame();

    window.scrollTo(0, 0);
}

function loadGames() {
    const gamesGrid = document.getElementById('gamesGrid');
    gamesGrid.innerHTML = '';
    if (!userManager.isLoggedIn()) {
        gamesGrid.innerHTML = '<p class="login-message">🔒 Please sign in to view games</p>';
        setTimeout(() => showSection('login'), 1500);
        return;
    }
    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.style.setProperty('--game-color', game.color);
        card.innerHTML = `
            <div class="game-thumbnail" style="background:linear-gradient(135deg,${game.color},${game.color}aa)">
                <span class="game-emoji">${game.emoji}</span>
                <span class="game-players-badge">👥 ${game.players}</span>
            </div>
            <div class="game-info">
                <h3>${game.name}</h3>
                <p>${game.description}</p>
                <button class="btn btn-primary" onclick="playGame(${game.id})">▶ Play Now</button>
            </div>
        `;
        gamesGrid.appendChild(card);
    });
}

function playGame(gameId) {
    const game = games.find(g => g.id === gameId);
    if (!game) return;

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById('gameView').classList.add('active');
    document.getElementById('gameTitle').textContent = `${game.emoji} ${game.name}`;
    document.getElementById('playerCount').textContent = `👥 ${game.players + 1} players online`;

    const canvas = document.getElementById('gameCanvas');
    setTimeout(() => {
        if (gameEngine) gameEngine.stop();
        gameEngine = new GameEngine(canvas, game);
        gameEngine.start();
        // Simulate NPC chat
        const npcs = ['xXNoob123', 'CoolGamer99', 'LegendPRO'];
        const msgs = ['lol nice jump', 'gg', 'who wants to team?', 'this level is hard', 'lets go!', 'anyone got tips?'];
        let npcInterval = setInterval(() => {
            if (!gameEngine || !gameEngine.running) { clearInterval(npcInterval); return; }
            const npc = npcs[Math.floor(Math.random() * npcs.length)];
            const msg = msgs[Math.floor(Math.random() * msgs.length)];
            gameEngine.addChatMessage(npc, msg);
        }, 4000 + Math.random() * 6000);
    }, 100);
}

function exitGame() {
    if (gameEngine) { gameEngine.stop(); gameEngine = null; }
    document.getElementById('gameChatMessages').innerHTML = '';
    showSection('games');
}

function sendGameChat() {
    const input = document.getElementById('gameChatInput');
    const text = input.value.trim();
    if (!text || !gameEngine) return;
    const user = userManager.getCurrentUser();
    gameEngine.addChatMessage(user ? user.username : 'You', text);
    input.value = '';
}

// ============================================
// AVATAR CUSTOMISATION
// ============================================
function loadCustomize() {
    const user = userManager.getCurrentUser();
    if (user && user.avatar) {
        currentAvatar = { ...currentAvatar, ...user.avatar };
    }

    // Skin colors
    const skinEl = document.getElementById('skinColors');
    skinEl.innerHTML = '';
    SKIN_COLORS.forEach(sc => {
        const btn = document.createElement('button');
        btn.className = 'color-swatch' + (currentAvatar.skin === sc.color ? ' selected' : '');
        btn.style.background = sc.color;
        btn.title = sc.label;
        btn.onclick = () => {
            currentAvatar.skin = sc.color;
            document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            updateAvatarPreview();
        };
        skinEl.appendChild(btn);
    });

    renderItemGrid('hatsGrid', HATS, 'hat');
    renderItemGrid('clothesGrid', CLOTHES, 'clothes');
    renderItemGrid('accessoriesGrid', ACCESSORIES, 'accessory');
    renderFacesGrid();
    updateAvatarPreview();
}

function renderItemGrid(containerId, items, prop) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'item-btn' + (currentAvatar[prop] === item.id ? ' selected' : '');
        btn.innerHTML = `<span>${item.emoji}</span><small>${item.label}</small>`;
        btn.onclick = () => {
            currentAvatar[prop] = item.id;
            document.querySelectorAll(`#${containerId} .item-btn`).forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            updateAvatarPreview();
        };
        container.appendChild(btn);
    });
}

function renderFacesGrid() {
    const container = document.getElementById('facesGrid');
    container.innerHTML = '';
    FACES.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'item-btn' + (currentAvatar.face === f.id ? ' selected' : '');
        btn.innerHTML = `<span style="font-size:1.5rem">${f.content}</span><small>${f.label}</small>`;
        btn.onclick = () => {
            currentAvatar.face = f.id;
            document.querySelectorAll('#facesGrid .item-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            updateAvatarPreview();
        };
        container.appendChild(btn);
    });
}

function updateAvatarPreview() {
    const hat = HATS.find(h => h.id === currentAvatar.hat) || HATS[0];
    const clothes = CLOTHES.find(c => c.id === currentAvatar.clothes) || CLOTHES[0];
    const acc = ACCESSORIES.find(a => a.id === currentAvatar.accessory) || ACCESSORIES[0];
    const face = FACES.find(f => f.id === currentAvatar.face) || FACES[0];

    document.getElementById('avHead').style.background = currentAvatar.skin;
    document.getElementById('avFace').textContent = face.content;

    const hatEl = document.getElementById('avHat');
    hatEl.style.cssText = hat.style || '';
    hatEl.style.display = hat.id === 'none' ? 'none' : 'block';

    document.getElementById('avBody').style.cssText = clothes.style || '';

    const accEl = document.getElementById('avAccessory');
    accEl.style.cssText = acc.style || '';
    accEl.style.display = acc.id === 'none' ? 'none' : 'block';

    // Store clothes color for game rendering
    const clothesData = CLOTHES.find(c => c.id === currentAvatar.clothes);
    currentAvatar.clothesColor = clothesData ? extractFirstColor(clothesData.style) : '#3498db';
}

function extractFirstColor(style) {
    const match = style && style.match(/#[0-9a-fA-F]{6}/);
    return match ? match[0] : '#3498db';
}

function saveAvatar() {
    userManager.saveAvatar({ ...currentAvatar });
    showMessage('🎨 Avatar saved!', 'success');
}

// ============================================
// MESSAGING
// ============================================
function loadMessages() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    renderInbox(user.username);
    renderSent(user.username);
    updateUnreadBadge();
}

function renderInbox(username) {
    const inbox = messaging.getInbox(username);
    const el = document.getElementById('inboxList');
    if (inbox.length === 0) {
        el.innerHTML = '<p class="empty-msg">📭 No messages yet</p>';
        return;
    }
    el.innerHTML = inbox.map(m => `
        <div class="msg-item ${m.read ? '' : 'unread'}" onclick="openMessage(${m.id})">
            <div class="msg-from">From: <strong>${m.from}</strong> ${m.read ? '' : '<span class="new-badge">NEW</span>'}</div>
            <div class="msg-subject">${m.subject}</div>
            <div class="msg-preview">${m.body.substring(0, 60)}${m.body.length > 60 ? '...' : ''}</div>
            <div class="msg-time">${formatDate(m.timestamp)}</div>
        </div>
    `).join('');
}

function renderSent(username) {
    const sent = messaging.getSent(username);
    const el = document.getElementById('sentList');
    if (sent.length === 0) {
        el.innerHTML = '<p class="empty-msg">📭 No sent messages</p>';
        return;
    }
    el.innerHTML = sent.map(m => `
        <div class="msg-item" onclick="openMessage(${m.id})">
            <div class="msg-from">To: <strong>${m.to}</strong></div>
            <div class="msg-subject">${m.subject}</div>
            <div class="msg-preview">${m.body.substring(0, 60)}${m.body.length > 60 ? '...' : ''}</div>
            <div class="msg-time">${formatDate(m.timestamp)}</div>
        </div>
    `).join('');
}

function switchTab(tab, btn) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('inboxList').style.display = tab === 'inbox' ? 'block' : 'none';
    document.getElementById('sentList').style.display = tab === 'sent' ? 'block' : 'none';
}

function sendMessage() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    const to = document.getElementById('msgTo').value;
    const subject = document.getElementById('msgSubject').value;
    const body = document.getElementById('msgBody').value;
    const result = messaging.sendMessage(user.username, to, subject, body);
    showMessage(result.message, result.success ? 'success' : 'error');
    if (result.success) {
        document.getElementById('msgTo').value = '';
        document.getElementById('msgSubject').value = '';
        document.getElementById('msgBody').value = '';
        renderSent(user.username);
        updateUnreadBadge();
    }
}

function openMessage(id) {
    const messages = messaging.loadMessages();
    const msg = messages.find(m => m.id === id);
    if (!msg) return;
    openMessageId = id;
    messaging.markAsRead(id);
    document.getElementById('modalFrom').textContent = `From: ${msg.from} → ${msg.to}`;
    document.getElementById('modalDate').textContent = formatDate(msg.timestamp);
    document.getElementById('modalSubject').textContent = msg.subject;
    document.getElementById('modalBody').textContent = msg.body;
    document.getElementById('messageModal').style.display = 'flex';
    updateUnreadBadge();
    const user = userManager.getCurrentUser();
    if (user) renderInbox(user.username);
}

function closeMessageModal() {
    document.getElementById('messageModal').style.display = 'none';
    openMessageId = null;
}

function replyToMessage() {
    const messages = messaging.loadMessages();
    const msg = messages.find(m => m.id === openMessageId);
    if (!msg) return;
    closeMessageModal();
    const user = userManager.getCurrentUser();
    const replyTo = msg.from === user.username ? msg.to : msg.from;
    document.getElementById('msgTo').value = replyTo;
    document.getElementById('msgSubject').value = `Re: ${msg.subject}`;
    document.getElementById('msgBody').focus();
}

function updateUnreadBadge() {
    const user = userManager.getCurrentUser();
    if (!user) return;
    const count = messaging.getUnreadCount(user.username);
    const badge = document.getElementById('unreadBadge');
    if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ============================================
// PROFILE
// ============================================
function loadProfile() {
    const user = userManager.getCurrentUser();
    if (!user) { showSection('login'); return; }
    document.getElementById('profileUsername').textContent = user.username;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileCreated').textContent = new Date(user.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('profileMemberSince').textContent = new Date(user.createdAt).toLocaleDateString('en-GB', { year: 'numeric', month: 'long' });

    // Mini avatar in profile
    const preview = document.getElementById('profileAvatarPreview');
    const av = user.avatar || currentAvatar;
    const face = FACES.find(f => f.id === (av.face || 'smile'));
    preview.innerHTML = `
        <div style="font-size:2.5rem;line-height:1">${face ? face.content : '😊'}</div>
        <div style="font-size:0.8rem;margin-top:0.3rem;color:#667eea;">Skin: <span style="display:inline-block;width:14px;height:14px;background:${av.skin || '#FFDBB4'};border-radius:50%;vertical-align:middle;border:1px solid #ccc;"></span></div>
    `;
}

// ============================================
// NAVIGATION & AUTH
// ============================================
function updateNavigation() {
    const loggedIn = userManager.isLoggedIn();
    document.getElementById('loginBtn').style.display = loggedIn ? 'none' : 'block';
    document.getElementById('logoutBtn').style.display = loggedIn ? 'block' : 'none';
    document.getElementById('profileLink').style.display = loggedIn ? 'block' : 'none';
    document.getElementById('customizeLink').style.display = loggedIn ? 'block' : 'none';
    document.getElementById('messagesLink').style.display = loggedIn ? 'block' : 'none';
    if (loggedIn) updateUnreadBadge();
}

function showMessage(text, type) {
    const el = document.getElementById('message');
    el.textContent = text;
    el.className = `message show ${type}`;
    setTimeout(() => el.classList.remove('show'), 4000);
}

async function handleRegister(event) {
    event.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;
    if (password !== confirmPassword) { showMessage('❌ Passwords do not match!', 'error'); return; }
    const result = await userManager.registerUser(username, email, password);
    if (result.success) {
        showMessage(result.message, 'success');
        ['regUsername','regEmail','regPassword','regConfirmPassword'].forEach(id => document.getElementById(id).value = '');
        setTimeout(() => showSection('login'), 1500);
    } else {
        showMessage(result.message, 'error');
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const result = await userManager.loginUser(username, password);
    if (result.success) {
        showMessage(result.message, 'success');
        document.getElementById('loginUsername').value = '';
        document.getElementById('loginPassword').value = '';
        updateNavigation();
        setTimeout(() => showSection('home'), 1500);
    } else {
        showMessage(result.message, 'error');
    }
}

function handleLogout() {
    if (gameEngine) exitGame();
    userManager.logoutUser();
    updateNavigation();
    showMessage('✅ Logged out successfully!', 'success');
    showSection('home');
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    updateNavigation();
    showSection('home');
    // Close modal on background click
    document.getElementById('messageModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('messageModal')) closeMessageModal();
    });
});
