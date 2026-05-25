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
// USER MANAGER: Multiple Accounts (2 min cooldown per device)
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
        const cooldownMs = 2 * 60 * 1000; // 2 minutes
        const timeSinceLastCreation = now - this.lastAccountCreationTime;
        return timeSinceLastCreation >= cooldownMs;
    }

    getTimeUntilNextAccount() {
        const now = Date.now();
        const cooldownMs = 2 * 60 * 1000; // 2 minutes
        const timeSinceLastCreation = now - this.lastAccountCreationTime;
        const timeRemaining = cooldownMs - timeSinceLastCreation;
        return Math.ceil(timeRemaining / 1000); // Return in seconds
    }

    async registerUser(username, email, password) {
        // Check if enough time has passed since last account creation
        if (!this.canCreateAccount() && this.lastAccountCreationTime > 0) {
            const timeLeft = this.getTimeUntilNextAccount();
            return { 
                success: false, 
                message: `⏱️ You can create a new account in ${timeLeft} seconds. (2 minute cooldown per device)` 
            };
        }

        // Username validation
        if (username.length < 3) {
            return { 
                success: false, 
                message: '❌ Username must be at least 3 characters!' 
            };
        }

        // Check if username already exists
        if (this.users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
            return { 
                success: false, 
                message: '❌ Username already taken! Choose a different one.' 
            };
        }

        // Check if email already exists
        if (this.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
            return { 
                success: false, 
                message: '❌ Email already registered! Use a different email.' 
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
            const newUser = {
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

            this.users.push(newUser);
            this.saveUsers();
            this.saveLastCreationTime();

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
        // Find user
        const user = this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
        
        if (!user) {
            return { 
                success: false, 
                message: '❌ No account found with that username!' 
            };
        }

        // BRUTE FORCE PROTECTION: Check if account is locked
        if (user.locked) {
            const lockTime = new Date(user.lockTime);
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
                user.locked = false;
                user.loginAttempts = 0;
                this.saveUsers();
            }
        }

        // Verify password using hashed comparison
        try {
            const hashedInput = await PasswordManager.hashPasswordWithSalt(password, user.salt);
            
            if (hashedInput !== user.passwordHash) {
                user.loginAttempts = (user.loginAttempts || 0) + 1;
                
                if (user.loginAttempts >= 5) {
                    user.locked = true;
                    user.lockTime = new Date().toISOString();
                    this.saveUsers();
                    return { 
                        success: false, 
                        message: '🔒 Too many failed attempts. Account locked for 15 minutes.' 
                    };
                }

                this.saveUsers();
                const attemptsLeft = 5 - user.loginAttempts;
                return { 
                    success: false, 
                    message: `❌ Invalid password! (${attemptsLeft} attempts left)` 
                };
            }

            // Successful login - reset attempts and update last login
            user.loginAttempts = 0;
            user.lastLogin = new Date().toISOString();
            this.saveUsers();

            // Create session
            this.currentUser = {
                id: user.id,
                username: user.username,
                email: user.email,
                createdAt: user.createdAt
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

    getUserByUsername(username) {
        return this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }
}

// Initialize User Manager
const userManager = new MultiUserManager();

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
