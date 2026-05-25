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
// USER MANAGER: Single Account Only
// ============================================
class SingleUserManager {
    constructor() {
        this.user = this.loadUser();
        this.currentUser = this.loadCurrentUser();
    }

    loadUser() {
        const stored = localStorage.getItem('robloxUser');
        return stored ? JSON.parse(stored) : null;
    }

    saveUser() {
        if (this.user) {
            localStorage.setItem('robloxUser', JSON.stringify(this.user));
        }
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

    async registerUser(username, email, password) {
        // ONLY ONE ACCOUNT ALLOWED
        if (this.user) {
            return { 
                success: false, 
                message: '❌ An account already exists! Only one account per device is allowed.' 
            };
        }

        // Username validation
        if (username.length < 3) {
            return { 
                success: false, 
                message: '❌ Username must be at least 3 characters!' 
            };
        }

        // Password validation - 8 characters minimum for security
        if (password.length < 8) {
            return { 
                success: false, 
                message: '❌ Password must be at least 8 characters for security!' 
            };
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { 
                success: false, 
                message: '❌ Please enter a valid email address!' 
            };
        }

        try {
            // Generate salt and hash password
            const salt = PasswordManager.generateSalt();
            const hashedPassword = await PasswordManager.hashPasswordWithSalt(password, salt);

            // Create user object with security features
            this.user = {
                id: Date.now(),
                username,
                email,
                passwordHash: hashedPassword,
                salt: salt,
                createdAt: new Date().toISOString(),
                lastLogin: null,
                loginAttempts: 0,
                locked: false,
                lockTime: null
            };

            this.saveUser();
            return { 
                success: true, 
                message: '✅ Account created successfully! Please log in.' 
            };
        } catch (error) {
            return { 
                success: false, 
                message: '❌ Error creating account. Please try again.' 
            };
        }
    }

    async loginUser(username, password) {
        // Check if account exists
        if (!this.user) {
            return { 
                success: false, 
                message: '❌ No account found. Please create an account first.' 
            };
        }

        // BRUTE FORCE PROTECTION: Check if account is locked
        if (this.user.locked) {
            const lockTime = new Date(this.user.lockTime);
            const now = new Date();
            const lockDuration = 15 * 60 * 1000; // 15 minutes

            if (now - lockTime < lockDuration) {
                const remainingTime = Math.ceil((lockDuration - (now - lockTime)) / 1000 / 60);
                return { 
                    success: false, 
                    message: `🔒 Account locked. Try again in ${remainingTime} minute(s).` 
                };
            } else {
                // Unlock after 15 minutes
                this.user.locked = false;
                this.user.loginAttempts = 0;
                this.saveUser();
            }
        }

        // Check username
        if (this.user.username.toLowerCase() !== username.toLowerCase()) {
            this.user.loginAttempts = (this.user.loginAttempts || 0) + 1;
            
            if (this.user.loginAttempts >= 5) {
                this.user.locked = true;
                this.user.lockTime = new Date().toISOString();
                this.saveUser();
                return { 
                    success: false, 
                    message: '🔒 Too many failed attempts. Account locked for 15 minutes.' 
                };
            }

            this.saveUser();
            const attemptsLeft = 5 - this.user.loginAttempts;
            return { 
                success: false, 
                message: `❌ Invalid username or password! (${attemptsLeft} attempts left)` 
            };
        }

        // Verify password using hashed comparison
        try {
            const hashedInput = await PasswordManager.hashPasswordWithSalt(password, this.user.salt);
            
            if (hashedInput !== this.user.passwordHash) {
                this.user.loginAttempts = (this.user.loginAttempts || 0) + 1;
                
                if (this.user.loginAttempts >= 5) {
                    this.user.locked = true;
                    this.user.lockTime = new Date().toISOString();
                    this.saveUser();
                    return { 
                        success: false, 
                        message: '🔒 Too many failed attempts. Account locked for 15 minutes.' 
                    };
                }

                this.saveUser();
                const attemptsLeft = 5 - this.user.loginAttempts;
                return { 
                    success: false, 
                    message: `❌ Invalid username or password! (${attemptsLeft} attempts left)` 
                };
            }

            // Successful login - reset attempts and update last login
            this.user.loginAttempts = 0;
            this.user.lastLogin = new Date().toISOString();
            this.saveUser();

            // Create session
            this.currentUser = {
                username: this.user.username,
                email: this.user.email,
                createdAt: this.user.createdAt
            };

            this.saveCurrentUser();
            return { 
                success: true, 
                message: '✅ Logged in successfully!' 
            };
        } catch (error) {
            return { 
                success: false, 
                message: '❌ Error during login. Please try again.' 
            };
        }
    }

    logoutUser() {
        this.currentUser = null;
        this.saveCurrentUser();
    }

    getCurrentUser() {
        return this.currentUser;
    }

    isLoggedIn() {
        return this.currentUser !== null;
    }

    userExists() {
        return this.user !== null;
    }
}

// Initialize User Manager
const userManager = new SingleUserManager();

// Game data
const games = [
    { id: 1, name: 'Obby Simulator', emoji: '🧗', description: 'Complete obstacle courses!' },
    { id: 2, name: 'Tycoon Empire', emoji: '🏗️', description: 'Build your business empire!' },
    { id: 3, name: 'Adventure Quest', emoji: '⚔️', description: 'Epic adventure awaits!' },
    { id: 4, name: 'Racing Madness', emoji: '🏎️', description: 'Race against friends!' },
    { id: 5, name: 'Mystery Manor', emoji: '🏚️', description: 'Solve the mystery!' },
    { id: 6, name: 'Survival Island', emoji: '🏝️', description: 'Survive on an island!' }
];

// ============================================
// UI FUNCTIONS
// ============================================

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });

    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.add('active');
    }

    if (sectionId === 'games') {
        loadGames();
    } else if (sectionId === 'profile') {
        loadProfile();
    }

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
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card';
        gameCard.innerHTML = `
            <div class="game-thumbnail">${game.emoji}</div>
            <div class="game-info">
                <h3>${game.name}</h3>
                <p>${game.description}</p>
                <button class="btn btn-primary" onclick="playGame(${game.id})">Play Now</button>
            </div>
        `;
        gamesGrid.appendChild(gameCard);
    });
}

function playGame(gameId) {
    const game = games.find(g => g.id === gameId);
    if (game) {
        showMessage(`🎮 Loading ${game.name}...`, 'success');
    }
}

function loadProfile() {
    const user = userManager.getCurrentUser();
    if (!user) {
        showSection('login');
        return;
    }

    document.getElementById('profileUsername').textContent = user.username;
    document.getElementById('profileEmail').textContent = user.email;
    document.getElementById('profileCreated').textContent = new Date(user.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });
    document.getElementById('profileMemberSince').textContent = new Date(user.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long' 
    });
}

function showMessage(text, type) {
    const messageEl = document.getElementById('message');
    messageEl.textContent = text;
    messageEl.className = `message show ${type}`;
    setTimeout(() => {
        messageEl.classList.remove('show');
    }, 4000);
}

function updateNavigation() {
    const isLoggedIn = userManager.isLoggedIn();
    document.getElementById('loginBtn').style.display = isLoggedIn ? 'none' : 'block';
    document.getElementById('logoutBtn').style.display = isLoggedIn ? 'block' : 'none';
    document.getElementById('profileLink').style.display = isLoggedIn ? 'block' : 'none';
}

// ============================================
// FORM HANDLERS
// ============================================

async function handleRegister(event) {
    event.preventDefault();
    
    const username = document.getElementById('regUsername').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirmPassword = document.getElementById('regConfirmPassword').value;

    // Validate passwords match
    if (password !== confirmPassword) {
        showMessage('❌ Passwords do not match!', 'error');
        return;
    }

    // Register user
    const result = await userManager.registerUser(username, email, password);
    
    if (result.success) {
        showMessage(result.message, 'success');
        document.getElementById('regUsername').value = '';
        document.getElementById('regEmail').value = '';
        document.getElementById('regPassword').value = '';
        document.getElementById('regConfirmPassword').value = '';
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
    userManager.logoutUser();
    updateNavigation();
    showMessage('✅ Logged out successfully!', 'success');
    showSection('home');
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    updateNavigation();
    showSection('home');
});
