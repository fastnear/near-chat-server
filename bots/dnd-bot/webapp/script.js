class DNDApp {
    constructor() {
        this.gameData = null;
        this.selectedClass = null;
        this.currentAccountId = null;
        this.readySignalSent = false;
        this.joiningInProgress = false; // Prevent double joins
        console.log('🎲 D&D App: Initializing...');
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupMiniAppIntegration();
        this.loadGameData();
    }

    setupEventListeners() {
        // Control buttons
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log('🎲 D&D App: Refresh button clicked');
                this.requestDataRefresh();
            });
        }

        // Tab buttons
        const tabBtns = document.querySelectorAll('.tab-btn');
        tabBtns.forEach(button => {
            button.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                console.log(`🎲 D&D App: Tab button clicked: ${tabName}`);
                this.switchTab(tabName);
            });
        });

        // Character class dropdown selection
        const classDropdown = document.getElementById('class-dropdown');
        if (classDropdown) {
            classDropdown.addEventListener('change', (e) => {
                const className = e.target.value;
                this.selectClass(className);
            });
        }

        // Join button
        const joinBtn = document.getElementById('join-btn');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                this.joinAdventure();
            });
        }
    }

    setupMiniAppIntegration() {
        console.log('🎲 D&D App: Setting up MiniApp integration...');

        // Listen for MiniApp initialization
        window.addEventListener('miniapp-init', (event) => {
            console.log('🎲 D&D App: MiniApp initialized', event.detail);
            this.requestInitialData();
        });

        // Setup webapp update handler via MiniAppAPI
        if (window.MiniAppAPI && window.MiniAppAPI.onWebappUpdate) {
            console.log('🎲 D&D App: Setting up onWebappUpdate via API');
            const unsubscribe = window.MiniAppAPI.onWebappUpdate((updateData) => {
                console.log('🎲 D&D App: Received webapp update via API!', updateData);
                this.handleWebappUpdate(updateData);
            });
            this.unsubscribeWebappUpdate = unsubscribe;
        }

        // Also listen for direct events (backup method)
        window.addEventListener('webapp-update', (event) => {
            console.log('🎲 D&D App: Received webapp-update event!', event.detail);
            this.handleWebappUpdate(event.detail);
        });

        // Check for API availability with delay
        this.checkApiAvailability();
    }

    checkApiAvailability() {
        const maxAttempts = 10;
        let attempts = 0;

        const checkApi = () => {
            attempts++;
            console.log(`🎲 D&D App: Checking API availability (attempt ${attempts}/${maxAttempts})`);

            if (window.MiniAppAPI && window.miniAppConfig) {
                console.log('🎲 D&D App: API is available!');
                this.requestInitialData();
                return;
            }

            if (attempts < maxAttempts) {
                setTimeout(checkApi, 500);
            } else {
                console.warn('🎲 D&D App: API not available after max attempts');
            }
        };

        checkApi();
    }

    async requestInitialData() {
        console.log('🎲 D&D App: Requesting initial data...');

        // Try multiple methods to get account data
        try {
            if (window.MiniAppAPI && window.MiniAppAPI.getChatData) {
                this.currentAccountId = await window.MiniAppAPI.getChatData('current_account_id');
                console.log('🎲 D&D App: Got account ID via API:', this.currentAccountId);
            } else if (window.miniAppConfig && window.miniAppConfig.accountId) {
                this.currentAccountId = window.miniAppConfig.accountId;
                console.log('🎲 D&D App: Got account ID via config:', this.currentAccountId);
            } else {
                // Try waiting a bit more for the API to be available
                console.log('🎲 D&D App: Waiting for account ID...');
                setTimeout(async () => {
                    try {
                        if (window.MiniAppAPI && window.MiniAppAPI.getChatData) {
                            this.currentAccountId = await window.MiniAppAPI.getChatData('current_account_id');
                            console.log('🎲 D&D App: Got account ID (delayed):', this.currentAccountId);
                        }
                    } catch (err) {
                        console.error('🎲 D&D App: Still cannot get account ID:', err);
                    }
                }, 1000);
            }
        } catch (error) {
            console.error('🎲 D&D App: Error getting chat data:', error);
        }
    }

    async tryGetAccountId() {
        try {
            if (window.MiniAppAPI && window.MiniAppAPI.getChatData) {
                this.currentAccountId = await window.MiniAppAPI.getChatData('current_account_id');
                console.log('🎲 D&D App: Retrieved account ID:', this.currentAccountId);
                if (this.currentAccountId) {
                    this.updateJoinSection(); // Re-try updating join section
                }
            } else if (window.miniAppConfig && window.miniAppConfig.accountId) {
                this.currentAccountId = window.miniAppConfig.accountId;
                console.log('🎲 D&D App: Got account ID from config:', this.currentAccountId);
                if (this.currentAccountId) {
                    this.updateJoinSection(); // Re-try updating join section
                }
            } else {
                console.log('🎲 D&D App: No API or config available for account ID');
            }
        } catch (error) {
            console.error('🎲 D&D App: Error getting account ID:', error);
        }
    }   

    loadGameData() {
        // Send signal to bot about MiniApp loading
        if (window.parent && window.parent.postMessage && !this.readySignalSent) {
            console.log('🎲 D&D App: Sending miniapp_ready signal to parent...');
            window.parent.postMessage({
                type: 'MINIAPP_READY',
                payload: { ready: true }
            }, '*');
            this.readySignalSent = true;
        }

        console.log('🎲 D&D App: Waiting for initial webapp_update...');
    }

    requestDataRefresh() {
        console.log('🎲 D&D App: Requesting data refresh...');

        if (window.parent && window.parent.postMessage) {
            window.parent.postMessage({
                type: 'REQUEST_MINIAPP_DATA',
                payload: {
                    channelId: window.miniAppConfig?.channelId || 'dnd',
                    requestType: 'refresh_data',
                    timestamp: Date.now()
                }
            }, '*');
        }
    }

    switchTab(tabName) {
        // Remove active class from all tabs and panels
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));

        // Add active class to clicked tab and corresponding panel
        const tabBtn = document.querySelector(`[data-tab="${tabName}"]`);
        const tabPanel = document.getElementById(`${tabName}-content`);

        if (tabBtn && tabPanel) {
            tabBtn.classList.add('active');
            tabPanel.classList.add('active');

            // Load data based on tab
            if (tabName === 'players') {
                this.loadPlayers();
            } else if (tabName === 'fallen') {
                this.loadFallenPlayers();
            } else if (tabName === 'history') {
                this.loadHistory();
            }
        }
    }

    selectClass(className) {
        console.log(`🎲 D&D App: Class selected: ${className}`);

        if (!className) {
            // Hide details if no class selected
            const classDetails = document.getElementById('class-details');
            if (classDetails) {
                classDetails.style.display = 'none';
            }

            const joinBtn = document.getElementById('join-btn');
            if (joinBtn) {
                joinBtn.disabled = true;
                joinBtn.textContent = 'Select a class to join';
            }

            this.selectedClass = null;
            return;
        }

        // Class data with equipment
        const classData = {
            'Warrior': {
                hp: 12,
                gold: 50,
                description: 'Strong fighter with sword and shield',
                equipment: ['Iron Sword', 'Wooden Shield', 'Leather Armor']
            },
            'Mage': {
                hp: 8,
                gold: 80,
                description: 'Powerful spellcaster with magical abilities',
                equipment: ['Magic Staff', 'Spell Tome', 'Mage Robes']
            },
            'Rogue': {
                hp: 10,
                gold: 100,
                description: 'Stealthy assassin with daggers and cunning',
                equipment: ['Twin Daggers', 'Lockpicks', 'Dark Cloak']
            },
            'Ranger': {
                hp: 10,
                gold: 60,
                description: 'Forest guardian with bow and nature magic',
                equipment: ['Longbow', 'Quiver of Arrows', 'Forest Cloak']
            },
            'Cleric': {
                hp: 9,
                gold: 40,
                description: 'Holy healer with divine powers',
                equipment: ['Holy Mace', 'Healing Herbs', 'Blessed Robes']
            },
            'Barbarian': {
                hp: 14,
                gold: 30,
                description: 'Wild berserker with incredible strength',
                equipment: ['Battle Axe', 'Animal Pelts', 'Rage Totem']
            }
        };

        const data = classData[className];
        if (data) {
            this.selectedClass = className;

            // Show class details
            const classDetails = document.getElementById('class-details');
            const classHp = document.getElementById('class-hp');
            const classGold = document.getElementById('class-gold');
            const classDescription = document.getElementById('class-description');
            const classEquipment = document.getElementById('class-equipment');

            if (classDetails) classDetails.style.display = 'block';
            if (classHp) classHp.textContent = `${data.hp} HP`;
            if (classGold) classGold.textContent = `${data.gold} 💰`;
            if (classDescription) classDescription.textContent = data.description;
            if (classEquipment) classEquipment.textContent = `Equipment: ${data.equipment.join(', ')}`;

            // Enable join button
            const joinBtn = document.getElementById('join-btn');
            if (joinBtn) {
                joinBtn.disabled = false;
                joinBtn.textContent = `Join as ${className}`;
            }
        }
    }

    joinAdventure() {
        if (!this.selectedClass) {
            console.error('🎲 D&D App: Cannot join - missing class selection');
            return;
        }

        // Prevent double joins
        if (this.joiningInProgress) {
            console.log('🎲 D&D App: Join already in progress, ignoring click');
            return;
        }

        // Try to get account ID one more time if missing
        if (!this.currentAccountId) {
            console.log('🎲 D&D App: Trying to get account ID before joining...');

            // Try various methods to get the account ID
            if (window.MiniAppAPI && window.MiniAppAPI.getChatData) {
                window.MiniAppAPI.getChatData('current_account_id').then(accountId => {
                    if (accountId) {
                        this.currentAccountId = accountId;
                        console.log('🎲 D&D App: Got account ID just before join:', accountId);
                        this.performJoin();
                    } else {
                        console.error('🎲 D&D App: Still no account ID available');
                        alert('Unable to get your account ID. Please refresh and try again.');
                    }
                }).catch(err => {
                    console.error('🎲 D&D App: Error getting account ID before join:', err);
                    alert('Unable to get your account ID. Please refresh and try again.');
                });
                return;
            } else {
                console.error('🎲 D&D App: Cannot join - missing account ID and no API available');
                alert('Unable to get your account ID. Please refresh and try again.');
                return;
            }
        }

        this.performJoin();
    }

    clearPlayerStatus() {
        // Remove any displayed player status
        const joinSection = document.getElementById('join-section');
        if (joinSection) {
            // Restore original join form with proper CSS classes
            joinSection.innerHTML = `
                <div class="join-card">
                    <h3>⚔️ Join the Adventure!</h3>
                    <p>Choose your character class:</p>

                    <div class="class-selection">
                        <select id="class-dropdown" class="class-dropdown">
                            <option value="">Select a class...</option>
                            <option value="Warrior">⚔️ Warrior</option>
                            <option value="Mage">🧙 Mage</option>
                            <option value="Rogue">🗡️ Rogue</option>
                            <option value="Ranger">🏹 Ranger</option>
                            <option value="Cleric">⚕️ Cleric</option>
                            <option value="Barbarian">🪓 Barbarian</option>
                        </select>

                        <div id="class-details" class="class-details" style="display: none;">
                            <div class="class-info">
                                <div class="class-stats-line">
                                    <span id="class-hp">0 HP</span> •
                                    <span id="class-gold">0 💰</span>
                                </div>
                                <div id="class-description" class="class-description">Select a class to see details</div>
                                <div id="class-equipment" class="class-equipment">Equipment: None</div>
                            </div>
                        </div>
                    </div>

                    <button id="join-btn" class="join-btn" disabled>
                        Select a class to join
                    </button>
                </div>
            `;

            // Re-setup event listeners for new elements
            this.setupJoinSectionListeners();
        }
    }

    setupJoinSectionListeners() {
        // Character class dropdown selection
        const classDropdown = document.getElementById('class-dropdown');
        if (classDropdown) {
            classDropdown.addEventListener('change', (e) => {
                const className = e.target.value;
                this.selectClass(className);
            });
        }

        // Join button
        const joinBtn = document.getElementById('join-btn');
        if (joinBtn) {
            joinBtn.addEventListener('click', () => {
                console.log('🎲 D&D App: Join button clicked');
                // this.handleJoinClick();
                this.performJoin(); 
            });
        }
    }

    performJoin() {
        console.log(`🎲 D&D App: Joining adventure as ${this.selectedClass} with account ${this.currentAccountId}`);

        // Set joining in progress flag
        this.joiningInProgress = true;

        // Send join message to bot
        if (window.parent && window.parent.postMessage) {
            window.parent.postMessage({
                type: 'CUSTOM_MESSAGE',
                payload: {
                    type: 'join_adventure',
                    channelId: window.miniAppConfig?.channelId || 'dnd',
                    accountId: this.currentAccountId,
                    characterClass: this.selectedClass
                }
            }, '*');
        }

        // Disable join section temporarily
        const joinBtn = document.getElementById('join-btn');
        if (joinBtn) {
            joinBtn.disabled = true;
            joinBtn.textContent = 'Joining...';
        }

        // Reset joining flag after 3 seconds (in case of errors)
        setTimeout(() => {
            this.joiningInProgress = false;
            if (joinBtn && joinBtn.disabled && joinBtn.textContent === 'Joining...') {
                joinBtn.disabled = false;
                joinBtn.textContent = this.selectedClass ? `Join as ${this.selectedClass}` : 'Join';
            }
        }, 3000);
    }

    async loadGameData() {
        await this.loadCurrentStory();

        // Update game status
        this.updateGameStatus();

        // Load players tab by default
        this.switchTab('players');
        this.updateJoinSection();
    }

    updateGameStatus() {
        const gameStatus = document.getElementById('game-status');
        const turnCounter = document.getElementById('turn-counter');
        const dangerLevel = document.getElementById('danger-level');
        const playerCount = document.getElementById('player-count');

        if (!gameStatus) return;

        if (this.gameData && (this.gameData.gameActive || this.gameData.turnCount > 0)) {
            // Show game status if game is active or has started
            const turnCount = this.gameData.turnCount || 0;
            const dangerLevelNum = Math.min(Math.floor(turnCount / 4) + 1, 5);
            const activePlayers = this.gameData.players ? Object.keys(this.gameData.players).length : 0;

            if (turnCounter) turnCounter.textContent = `${turnCount}`;
            if (dangerLevel) {
                dangerLevel.textContent = `Level ${dangerLevelNum}`;
                // Change color based on danger level
                if (dangerLevelNum <= 2) {
                    dangerLevel.style.color = '#059669';
                } else if (dangerLevelNum <= 4) {
                    dangerLevel.style.color = '#d97706';
                } else {
                    dangerLevel.style.color = '#dc2626';
                }
            }
            if (playerCount) playerCount.textContent = activePlayers;

            gameStatus.style.display = 'flex';
        } else {
            gameStatus.style.display = 'none';
        }
    }

    updateJoinSection() {
        const joinSection = document.getElementById('join-section');
        if (!joinSection) return;

        console.log(`🎲 D&D App: Updating join section. Current user: ${this.currentAccountId}`);
        console.log('🎲 D&D App: Game data:', this.gameData);

        // If no account ID, try to get it again
        if (!this.currentAccountId) {
            console.log('🎲 D&D App: No account ID found, trying to fetch it...');
            this.tryGetAccountId();
            return;
        }

        // If no game data, request refresh
        if (!this.gameData) {
            console.log('🎲 D&D App: No game data, requesting refresh...');
            this.requestDataRefresh();
            // Show loading state
            joinSection.innerHTML = '<div class="loading">🔄 Loading game data...</div>';
            return;
        }

        // Check if current user is already in the game
        if (this.gameData && this.currentAccountId) {
            const isPlayer = this.gameData.players && this.gameData.players[this.currentAccountId];
            const isDead = this.gameData.deadPlayers && this.gameData.deadPlayers[this.currentAccountId];

            console.log(`🎲 D&D App: Player check - isPlayer: ${!!isPlayer}, isDead: ${!!isDead}`);
            console.log(`🎲 D&D App: Available players:`, Object.keys(this.gameData.players || {}));
            console.log(`🎲 D&D App: Dead players:`, Object.keys(this.gameData.deadPlayers || {}));

            if (isPlayer) {
                // Hide join section and show player status
                joinSection.style.display = 'none';
                this.showPlayerStatus(this.gameData.players[this.currentAccountId]);
            } else if (isDead) {
                // Hide join section and show death status
                joinSection.style.display = 'none';
                this.showDeathStatus(this.gameData.deadPlayers[this.currentAccountId]);
            } else {
                // Show join section if not playing
                joinSection.style.display = 'block';
                // Ensure join form is properly restored (in case it was replaced with player status)
                if (!document.getElementById('class-dropdown')) {
                    this.clearPlayerStatus();
                }
            }
        }
    }

    showPlayerStatus(playerData) {
        const joinSection = document.getElementById('join-section');
        if (joinSection) {
            joinSection.innerHTML = `
                <div class="join-card">
                    <h3>⚔️ Your Character</h3>
                    <div class="player-status">
                        <div class="status-line"><strong>Class:</strong> ${playerData.class}</div>
                        <div class="status-line"><strong>HP:</strong> ${playerData.hp}/${playerData.maxHp}</div>
                        <div class="status-line"><strong>Gold:</strong> ${playerData.gold} 💰</div>
                        <div class="status-line"><strong>Equipment:</strong> ${playerData.equipment ? playerData.equipment.join(', ') : 'None'}</div>
                    </div>
                    <p style="text-align: center; margin-top: 12px; color: #654321;">
                        Use <strong>@dnd-bot [action]</strong> to play!
                    </p>
                </div>
            `;
            joinSection.style.display = 'block';
        }
    }

    showDeathStatus(playerData) {
        const joinSection = document.getElementById('join-section');
        if (joinSection) {
            const deathTime = new Date(playerData.deathTime).toLocaleTimeString();
            joinSection.innerHTML = `
                <div class="join-card" style="background: linear-gradient(135deg, #2d1b1b 0%, #4a2c2c 100%); border-color: #666; color: #fff;">
                    <h3>💀 Your Character Has Fallen</h3>
                    <div class="player-status">
                        <div class="status-line"><strong>Class:</strong> ${playerData.class}</div>
                        <div class="status-line"><strong>Died at:</strong> ${deathTime}</div>
                        <div class="status-line"><strong>Lost Gold:</strong> ${playerData.gold} 💰</div>
                        <div class="status-line"><strong>Lost Equipment:</strong> ${playerData.equipment ? playerData.equipment.join(', ') : 'None'}</div>
                    </div>
                    <p style="text-align: center; margin-top: 12px;">
                        Your spirit watches the adventure continue...
                    </p>
                </div>
            `;
            joinSection.style.display = 'block';
        }
    }

    async loadCurrentStory() {
        console.log('🎲 D&D App: Loading current story...');
        const container = document.getElementById('current-story');
        if (!container) return;

        if (!this.gameData || !this.gameData.currentStory) {
            container.innerHTML = `
                <div class="no-story">
                    <p>🎲 Welcome, brave adventurer!</p>
                    <p>Join the adventure to begin your quest...</p>
                </div>
            `;
        } else {
            // Extract story text (handle both string and object formats)
            let storyText = this.gameData.currentStory;
            if (typeof this.gameData.currentStory === 'object' && this.gameData.currentStory.story) {
                storyText = this.gameData.currentStory.story;
            }

            container.innerHTML = `
                <div class="story-card">
                    <div class="story-text">${storyText}</div>
                    <div class="story-status">
                        ${this.gameData.gameActive ?
                            '🎲 Adventure in progress...' :
                            '⏸️ Waiting for adventurers...'}
                    </div>
                </div>
            `;
        }
    }

    async loadPlayers() {
        const container = document.getElementById('players-list');
        if (!container) return;

        if (!this.gameData || !this.gameData.players || Object.keys(this.gameData.players).length === 0) {
            container.innerHTML = '<div class="loading">No heroes in the adventure yet...</div>';
            return;
        }

        const playersHtml = Object.entries(this.gameData.players)
            .sort(([,a], [,b]) => (b.gold + b.hp) - (a.gold + a.hp)) // Sort by combined wealth and health
            .map(([accountId, player], index) => {
                const hpPercentage = (player.hp / player.maxHp) * 100;
                const hpClass = hpPercentage > 60 ? 'hp-high' :
                               hpPercentage > 30 ? 'hp-medium' : 'hp-low';

                return `
                    <div class="player-item ${player.alive ? '' : 'dead'}" onclick="togglePlayerDetails('${accountId}', 'player')" style="cursor: pointer;">
                        <div class="player-info">
                            <div class="player-name">${accountId} <span class="expand-hint">▼</span></div>
                            <div class="player-class">${this.getClassIcon(player.class)} ${player.class}</div>
                        </div>
                        <div class="player-stats">
                            <div class="player-hp">
                                <div class="hp-bar">
                                    <div class="hp-fill ${hpClass}" style="width: ${hpPercentage}%"></div>
                                </div>
                                <div class="hp-text">${player.hp}/${player.maxHp} HP</div>
                            </div>
                            <div class="player-gold">
                                <div class="gold-text">💰 ${player.gold}</div>
                            </div>
                        </div>
                        <div class="player-details" id="details-${accountId}-player" style="display: none;">
                            <div class="detail-line"><strong>Full HP:</strong> ${player.hp}/${player.maxHp}</div>
                            <div class="detail-line"><strong>Gold:</strong> ${player.gold} 💰</div>
                            <div class="detail-line"><strong>Equipment:</strong> ${player.equipment ? player.equipment.join(', ') : 'None'}</div>
                            <div class="detail-line"><strong>Status:</strong> ${player.alive ? '✅ Alive' : '💀 Dead'}</div>
                            <div class="detail-line"><strong>Joined:</strong> ${new Date(player.joinedAt).toLocaleTimeString()}</div>
                        </div>
                    </div>
                `;
            }).join('');

        container.innerHTML = playersHtml;
    }

    async loadFallenPlayers() {
        const container = document.getElementById('fallen-list');
        if (!container) return;

        if (!this.gameData || !this.gameData.deadPlayers || Object.keys(this.gameData.deadPlayers).length === 0) {
            container.innerHTML = '<div class="loading">No fallen heroes yet...</div>';
            return;
        }

        const fallenHtml = Object.entries(this.gameData.deadPlayers)
            .sort(([,a], [,b]) => b.deathTime - a.deathTime) // Sort by most recent death
            .map(([accountId, player]) => {
                const deathTime = new Date(player.deathTime).toLocaleTimeString();

                return `
                    <div class="player-item dead" onclick="togglePlayerDetails('${accountId}', 'fallen')" style="cursor: pointer;">
                        <div class="player-info">
                            <div class="player-name">💀 ${accountId} <span class="expand-hint">▼</span></div>
                            <div class="player-class">${this.getClassIcon(player.class)} ${player.class}</div>
                        </div>
                        <div class="player-death">
                            <div class="death-time">Fell at ${deathTime}</div>
                            <div class="death-stats">
                                <div class="death-hp">Max HP: ${player.maxHp}</div>
                                <div class="death-gold">💰 ${player.gold || 0} gold lost</div>
                            </div>
                        </div>
                        <div class="player-details" id="details-${accountId}-fallen" style="display: none;">
                            <div class="detail-line"><strong>Class:</strong> ${this.getClassIcon(player.class)} ${player.class}</div>
                            <div class="detail-line"><strong>Max HP:</strong> ${player.maxHp}</div>
                            <div class="detail-line"><strong>Gold Lost:</strong> ${player.gold || 0} 💰</div>
                            <div class="detail-line"><strong>Equipment Lost:</strong> ${player.equipment ? player.equipment.join(', ') : 'None'}</div>
                            <div class="detail-line"><strong>Death Time:</strong> ${new Date(player.deathTime).toLocaleString()}</div>
                            <div class="detail-line"><strong>Status:</strong> 💀 Fallen Hero</div>
                        </div>
                    </div>
                `;
            }).join('');

        container.innerHTML = fallenHtml;
    }

    loadHistory() {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;

        if (!this.gameData || !this.gameData.storyHistory || this.gameData.storyHistory.length === 0) {
            historyList.innerHTML = '<div class="loading">No adventure history yet...</div>';
            return;
        }

        let historyHtml = '<div class="history-entry turn-marker">🎲 Adventure Begins</div>';

        this.gameData.storyHistory.forEach((story, index) => {
            // Add turn markers for each story entry after the first
            if (index > 0) {
                historyHtml += `<div class="history-entry turn-marker">⚔️ Turn ${index}</div>`;
            }

            // Extract story text (handle both string and object formats)
            let storyText = story;
            if (typeof story === 'object' && story.story) {
                storyText = story.story;
            }

            historyHtml += `
                <div class="history-entry">
                    ${storyText}
                </div>
            `;
        });

        historyList.innerHTML = historyHtml;
        // Scroll to bottom to show latest entries
        historyList.scrollTop = historyList.scrollHeight;
    }

    getClassIcon(className) {
        const icons = {
            'Warrior': '⚔️',
            'Mage': '🧙',
            'Rogue': '🗡️',
            'Ranger': '🏹',
            'Cleric': '⚕️',
            'Barbarian': '🪓'
        };
        return icons[className] || '⚔️';
    }

    handleWebappUpdate(updateData) {
        console.log('🎲 D&D App: Processing webapp update:', updateData);

        // Extract account ID from updateData if not set
        if (!this.currentAccountId && updateData.accountId) {
            this.currentAccountId = updateData.accountId;
            console.log('🎲 D&D App: Got account ID from webapp update:', this.currentAccountId);
        }

        // Update game data
        this.gameData = updateData.data;

        console.log('🎲 D&D App: Updated game data:', {
            players: Object.keys(this.gameData.players || {}),
            deadPlayers: Object.keys(this.gameData.deadPlayers || {}),
            gameActive: this.gameData.gameActive,
            turnCount: this.gameData.turnCount,
            currentUser: this.currentAccountId
        });

        // Refresh displays
        this.loadCurrentStory();
        this.updateGameStatus();
        this.updateJoinSection();

        // Update active tab
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab) {
            const tabName = activeTab.dataset.tab;
            if (tabName === 'players') {
                this.loadPlayers();
            } else if (tabName === 'fallen') {
                this.loadFallenPlayers();
            } else if (tabName === 'history') {
                this.loadHistory();
            }
        }

        // Handle specific update types
        if (updateData.type === 'player_joined' || updateData.type === 'adventure_started') {
            // If this user joined, hide the join section and clear joining flag
            if (this.currentAccountId && this.gameData.players && this.gameData.players[this.currentAccountId]) {
                const joinSection = document.getElementById('join-section');
                if (joinSection) {
                    joinSection.style.display = 'none';
                }
                // Clear joining in progress flag since join was successful
                this.joiningInProgress = false;
            }
        }

        // Handle game reset
        if (updateData.type === 'game_reset') {
            console.log('🎲 D&D App: Game was reset, clearing all state');
            // Clear joining flag
            this.joiningInProgress = false;
            // Show join section for everyone
            const joinSection = document.getElementById('join-section');
            if (joinSection) {
                joinSection.style.display = 'block';
            }
            // Clear any cached player status
            this.clearPlayerStatus();
        }

        // Handle current state updates (when user joins channel)
        if (updateData.type === 'current_state') {
            console.log('🎲 D&D App: Received current game state update');
            // Update displays immediately for returning users
            if (this.gameData && this.gameData.gameActive) {
                // Show status for active games
                this.updateGameStatus();
            }
        }

        console.log('🎲 D&D App: Updated display with new data');
    }

    // Toggle player details expansion
    togglePlayerDetails(accountId, type) {
        const detailsId = `details-${accountId}-${type}`;
        const detailsElement = document.getElementById(detailsId);
        const playerItem = detailsElement.parentElement;
        const expandHint = playerItem.querySelector('.expand-hint');

        if (detailsElement.style.display === 'none') {
            // Show details
            detailsElement.style.display = 'block';
            expandHint.textContent = '▲';
            playerItem.classList.add('expanded');
        } else {
            // Hide details
            detailsElement.style.display = 'none';
            expandHint.textContent = '▼';
            playerItem.classList.remove('expanded');
        }
    }
}

// Make togglePlayerDetails available globally for onclick
window.dndApp = null;

// Expose toggle function globally for onclick handlers
window.togglePlayerDetails = function(accountId, type) {
    if (window.dndApp && window.dndApp.togglePlayerDetails) {
        window.dndApp.togglePlayerDetails(accountId, type);
    }
};

// Initialize the D&D App when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🎲 D&D App: DOM loaded, initializing...');
        window.dndApp = new DNDApp();
    });
} else {
    console.log('🎲 D&D App: DOM already loaded, initializing...');
    window.dndApp = new DNDApp();
}