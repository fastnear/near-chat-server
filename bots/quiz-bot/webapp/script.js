class QuizApp {
    constructor() {
        this.quizData = null;
        this.readySignalSent = false; // Flag to prevent duplicate MINIAPP_READY
        console.log('🧠 Quiz App: Initializing...');
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupMiniAppIntegration();
        this.loadQuizData();
    }

    setupEventListeners() {
        // Control buttons
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                console.log('🧠 Quiz App: Refresh button clicked');
                this.requestDataRefresh();
            });
        } else {
            console.warn('🧠 Quiz App: refresh-btn not found');
        }

        // Tab buttons
        const tabBtns = document.querySelectorAll('.tab-btn');
        console.log(`🧠 Quiz App: Found ${tabBtns.length} tab buttons`);
        tabBtns.forEach(button => {
            button.addEventListener('click', (e) => {
                const tabName = e.target.dataset.tab;
                console.log(`🧠 Quiz App: Tab button clicked: ${tabName}`);
                this.switchTab(tabName);
            });
        });
    }

    setupMiniAppIntegration() {
        console.log('🧠 Quiz App: Setting up MiniApp integration...');

        // Listen for MiniApp initialization
        window.addEventListener('miniapp-init', (event) => {
            console.log('🧠 Quiz App: MiniApp initialized', event.detail);
            this.requestInitialData();
        });

        // Listen for MiniApp expansion
        window.addEventListener('message', (event) => {
            if (event.data.type === 'MINIAPP_EXPANDED') {
                console.log('🧠 Quiz App: Received expansion event');
                this.onMiniAppExpanded();
            }
        });

        // Setup webapp update handler via MiniAppAPI
        if (window.MiniAppAPI && window.MiniAppAPI.onWebappUpdate) {
            console.log('🧠 Quiz App: Setting up onWebappUpdate via API');
            const unsubscribe = window.MiniAppAPI.onWebappUpdate((updateData) => {
                console.log('🧠 Quiz App: Received webapp update via API!', updateData);
                this.handleWebappUpdate(updateData);
            });
            this.unsubscribeWebappUpdate = unsubscribe;
        }

        // Also listen for direct events (backup method)
        window.addEventListener('webapp-update', (event) => {
            console.log('🧠 Quiz App: Received webapp-update event!', event.detail);
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
            console.log(`🧠 Quiz App: Checking API availability (attempt ${attempts}/${maxAttempts})`);
            console.log('🧠 Quiz App: Current window state:', {
                MiniAppAPI: !!window.MiniAppAPI,
                miniAppConfig: window.miniAppConfig
            });

            if (window.MiniAppAPI && window.miniAppConfig) {
                console.log('🧠 Quiz App: API is available!', {
                    API: !!window.MiniAppAPI,
                    config: window.miniAppConfig,
                    methods: Object.keys(window.MiniAppAPI)
                });
                this.requestInitialData();
                return;
            }

            if (attempts < maxAttempts) {
                setTimeout(checkApi, 500);
            } else {
                console.warn('🧠 Quiz App: API not available after max attempts');
            }
        };

        checkApi();
    }

    async requestInitialData() {
        console.log('🧠 Quiz App: Requesting initial data...');

        // Try to get account data
        try {
            if (window.MiniAppAPI && window.MiniAppAPI.getChatData) {
                const accountId = await window.MiniAppAPI.getChatData('current_account_id');
                console.log('🧠 Quiz App: Got account ID:', accountId);
            }
        } catch (error) {
            console.error('🧠 Quiz App: Error getting chat data:', error);
        }

        // Send signal to bot about MiniApp loading (only once)
        if (window.parent && window.parent.postMessage && !this.readySignalSent) {
            console.log('🧠 Quiz App: Sending miniapp_ready signal to parent...');
            window.parent.postMessage({
                type: 'MINIAPP_READY',
                payload: { ready: true }
            }, '*');
            this.readySignalSent = true;
        }

        console.log('🧠 Quiz App: Waiting for initial webapp_update...');
    }

    onMiniAppExpanded() {
        console.log('🧠 Quiz App: MiniApp expanded, requesting fresh data...');
        // Only request refresh if we haven't sent ready signal yet (to avoid redundant requests)
        if (!this.readySignalSent) {
            this.requestDataRefresh();
        } else {
            console.log('🧠 Quiz App: Ready signal sent - waiting for webapp_update...');
        }
    }

    requestDataRefresh() {
        console.log('🧠 Quiz App: Requesting data refresh...');

        // Send refresh request to parent (which will send request_data)
        if (window.parent && window.parent.postMessage) {
            window.parent.postMessage({
                type: 'REQUEST_MINIAPP_DATA',
                payload: {
                    channelId: window.miniAppConfig?.channelId || 'quizapp',
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

            // Load data if switching to leaderboard
            if (tabName === 'leaderboard') {
                this.loadLeaderboard();
            }
        }
    }

    async loadQuizData() {
        await this.loadCurrentQuestion();

        // Open leaderboard tab by default
        this.switchTab('leaderboard');
    }

    async loadCurrentQuestion() {
        console.log('🧠 Quiz App: Loading current question...');
        const container = document.getElementById('current-question');
        if (!container) {
            console.warn('🧠 Quiz App: current-question container not found');
            return;
        }

        console.log('🧠 Quiz App: Quiz data:', this.quizData);
        console.log('🧠 Quiz App: Current question:', this.quizData?.currentQuestion);

        if (!this.quizData || !this.quizData.currentQuestion) {
            console.log('🧠 Quiz App: No question data, showing placeholder');
            container.innerHTML = `
                <div class="no-question">
                    <p>No active quiz question</p>
                    <p>Send any message in chat to start!</p>
                </div>
            `;
        } else {
            const question = this.quizData.currentQuestion;
            const answerHistory = this.quizData.answerHistory || [];
            console.log('🧠 Quiz App: Displaying question:', question.question);

            let historyHtml = '';
            if (answerHistory.length > 0) {
                historyHtml = `
                    <div class="answer-history">
                        ${answerHistory.map(item => `
                            <div class="history-item">
                                <div class="history-question">${item.question}</div>
                                <div class="history-answer">
                                    <span class="answer-text">Answer: <strong>${item.answer}</strong></span>
                                    <span class="answerer">by ${item.answeredBy}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            container.innerHTML = `
                <div class="question-card">
                    <div class="question-text">${question.question}</div>
                </div>
                ${historyHtml}
            `;
        }
    }

    async loadLeaderboard() {
        const container = document.getElementById('leaderboard-list');
        if (!container) return;

        if (!this.quizData || !this.quizData.leaderboard) {
            container.innerHTML = '<div class="loading">Loading leaderboard...</div>';
            return;
        }

        const leaderboard = this.quizData.leaderboard;
        const sortedEntries = Object.entries(leaderboard)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10); // Top 10

        if (sortedEntries.length === 0) {
            container.innerHTML = '<div class="loading">No scores yet!</div>';
            return;
        }

        const leaderboardHtml = sortedEntries.map(([accountId, score], index) => {
            let rankClass = '';
            if (index === 0) rankClass = 'first';
            else if (index === 1) rankClass = 'second';
            else if (index === 2) rankClass = 'third';

            return `
                <div class="leaderboard-item">
                    <div class="rank ${rankClass}">${index + 1}</div>
                    <div class="account-id">${accountId}</div>
                    <div class="score">${score}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = leaderboardHtml;
    }


    handleWebappUpdate(updateData) {
        console.log('🧠 Quiz App: Processing webapp update:', updateData);

        if (updateData.type === 'initial_state' || updateData.type === 'new_question' || updateData.type === 'leaderboard_update') {
            this.quizData = updateData.data;
            console.log('🧠 Quiz App: Updated quiz data:', this.quizData);
            this.loadCurrentQuestion();

            // Update leaderboard if tab is active
            const leaderboardPanel = document.getElementById('leaderboard-content');
            if (leaderboardPanel && leaderboardPanel.classList.contains('active')) {
                this.loadLeaderboard();
            }
        } else if (updateData.type === 'correct_answer') {
            // Handle correct answer - just update data and reload
            this.quizData = updateData.data;
            this.loadCurrentQuestion();

            // Update leaderboard
            const leaderboardPanel = document.getElementById('leaderboard-content');
            if (leaderboardPanel && leaderboardPanel.classList.contains('active')) {
                this.loadLeaderboard();
            }
        } else {
            console.warn('🧠 Quiz App: Unknown update type:', updateData.type);
        }
    }
}

// Initialize the Quiz App when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🧠 Quiz App: DOM loaded, initializing...');
        new QuizApp();
    });
} else {
    console.log('🧠 Quiz App: DOM already loaded, initializing...');
    new QuizApp();
}