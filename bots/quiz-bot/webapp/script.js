class QuizApp {
    constructor() {
        this.currentTab = 'current';
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
        // Tab switching
        document.querySelectorAll('.tab-button').forEach(button => {
            button.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Control buttons
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadQuizData();
        });
    }

    setupMiniAppIntegration() {
        console.log('🧠 Quiz App: Setting up MiniApp integration...');

        // Listen for MiniApp initialization
        window.addEventListener('miniapp-init', (event) => {
            console.log('🧠 Quiz App: MiniApp initialized', event.detail);
            this.requestInitialData();
        });

        // ✅ ИСПРАВЛЕНИЕ: Добавляем обработчик webapp-update через MiniAppAPI
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

        // ✅ ИСПРАВЛЕНИЕ: Проверяем доступность API с задержкой
        this.checkApiAvailability();
    }

    checkApiAvailability() {
        const maxAttempts = 10;
        let attempts = 0;

        const checkApi = () => {
            attempts++;
            console.log(`🧠 Quiz App: Checking API availability (attempt ${attempts}/${maxAttempts})`);

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

        // ✅ ИСПРАВЛЕНИЕ: Пытаемся получить данные через getChatData
        try {
            if (window.MiniAppAPI && window.MiniAppAPI.getChatData) {
                const accountId = await window.MiniAppAPI.getChatData('current_account_id');
                console.log('🧠 Quiz App: Got account ID:', accountId);
            }
        } catch (error) {
            console.error('🧠 Quiz App: Error getting chat data:', error);
        }

        // ✅ ИСПРАВЛЕНИЕ: Отправляем сигнал боту о загрузке MiniApp (только один раз)
        if (window.parent && window.parent.postMessage && !this.readySignalSent) {
            console.log('🧠 Quiz App: Sending miniapp_ready signal to parent...');
            window.parent.postMessage({
                type: 'MINIAPP_READY',
                payload: { ready: true }
            }, '*');
            this.readySignalSent = true;
        }

        console.log('🧠 Quiz App: Waiting for initial webapp_update...');
        this.loadTabData(this.currentTab);
    }

    switchTab(tabName) {
        // Update active tab button
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update active tab pane
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');

        this.currentTab = tabName;

        // Load data for the current tab
        this.loadTabData(tabName);
    }

    async loadTabData(tabName) {
        switch (tabName) {
            case 'current':
                await this.loadCurrentQuestion();
                break;
            case 'leaderboard':
                await this.loadLeaderboard();
                break;
            case 'history':
                await this.loadHistory();
                break;
        }
    }

    async loadQuizData() {
        if (this.currentTab === 'current') {
            await this.loadCurrentQuestion();
        } else if (this.currentTab === 'leaderboard') {
            await this.loadLeaderboard();
        } else if (this.currentTab === 'history') {
            await this.loadHistory();
        }
    }

    async getQuizState() {
        // Return current quiz data from cache
        console.log('🧠 Quiz App: getQuizState returning:', this.quizData);
        return this.quizData || {
            currentQuestion: null,
            leaderboard: {}
        };
    }

    handleWebappUpdate(updateData) {
        console.log('🧠 Quiz App: handleWebappUpdate called with:', updateData);

        // ✅ ИСПРАВЛЕНИЕ: Улучшенная проверка структуры данных
        if (!updateData) {
            console.error('🧠 Quiz App: updateData is null/undefined');
            return;
        }

        // Проверяем разные возможные структуры данных
        let actualData = null;
        let updateType = null;

        if (updateData.data && updateData.type) {
            // Структура: { type: "...", data: {...}, timestamp: ... }
            actualData = updateData.data;
            updateType = updateData.type;
        } else if (updateData.currentQuestion || updateData.leaderboard) {
            // Данные напрямую в updateData (initial_state)
            actualData = updateData;
            updateType = 'initial_state';
        } else if (updateData.message) {
            // Сообщение типа new_question
            actualData = updateData;
            updateType = 'message_update';
        } else {
            console.error('🧠 Quiz App: Invalid webapp update structure', updateData);
            return;
        }

        console.log(`🧠 Quiz App: Processing ${updateType} update with data:`, actualData);

        // Handle different update types
        if (updateType === 'initial_state' || (updateType === 'new_question' && actualData.currentQuestion)) {
            // Full state with currentQuestion and leaderboard
            this.quizData = actualData;
            console.log('🧠 Quiz App: Updated local quizData cache:', this.quizData);
            // Refresh UI based on current tab
            this.loadTabData(this.currentTab);
        } else if (updateType === 'message_update' || (updateType === 'new_question' && actualData.message)) {
            // Message-only update, parse the question from the message
            console.log('🧠 Quiz App: Processing message update:', actualData.message);
            // Extract question from message format "🧠 **Quiz Question:**\n\nWhat is...?\n\nType your answer..."
            const messageText = actualData.message;
            const questionMatch = messageText.match(/\*\*Quiz Question:\*\*\s*\n\n(.+?)\n\n/);
            if (questionMatch) {
                const questionText = questionMatch[1];
                // Update quizData with the new question
                if (!this.quizData) this.quizData = {};
                this.quizData.currentQuestion = {
                    question: questionText,
                    correctAnswer: "Unknown", // We don't get this in message updates
                    startTime: actualData.timestamp || Date.now(),
                    answered: new Set()
                };
                console.log('🧠 Quiz App: Extracted question:', questionText);
                // Refresh current question tab if active
                if (this.currentTab === 'current') {
                    this.loadCurrentQuestion();
                }
            }
        } else {
            // Update local quiz data cache for other types
            this.quizData = actualData;
            console.log('🧠 Quiz App: Updated local quizData cache:', this.quizData);
            // Refresh UI based on current tab
            this.loadTabData(this.currentTab);
        }
    }

    async loadCurrentQuestion() {
        console.log('🧠 Quiz App: loadCurrentQuestion() called');
        const questionContainer = document.getElementById('current-question');

        try {
            const quizState = await this.getQuizState();
            console.log('🧠 Quiz App: Got quiz state:', quizState);

            if (!quizState || (!quizState.currentQuestion && !quizState.message)) {
                console.log('🧠 Quiz App: No current question, showing placeholder');
                questionContainer.innerHTML = `
                    <div class="no-question">
                        <p>No active quiz question</p>
                        <p>Send any message in chat to start the quiz!</p>
                    </div>
                `;
                return;
            }

            const question = quizState.currentQuestion;
            console.log('🧠 Quiz App: Displaying question:', question);

            if (!question || !question.question) {
                console.log('🧠 Quiz App: No valid question object, showing placeholder');
                questionContainer.innerHTML = `
                    <div class="no-question">
                        <p>No active quiz question</p>
                        <p>Send any message in chat to start the quiz!</p>
                    </div>
                `;
                return;
            }

            questionContainer.innerHTML = `
                <div class="question-card">
                    <div class="question-text">${question.question}</div>
                    <div class="question-info">
                        <p><strong>Instructions:</strong> Type your answer in the chat!</p>
                        <!-- <p><em>Current correct answer: ${question.correctAnswer || 'Unknown'}</em></p> -->
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Quiz App: Error loading current question:', error);
            questionContainer.innerHTML = `
                <div class="error">
                    Error loading question data. Please try refreshing.
                </div>
            `;
        }
    }

    async loadLeaderboard() {
        const leaderboardContainer = document.getElementById('leaderboard-list');

        try {
            const quizState = await this.getQuizState();

            if (!quizState || !quizState.leaderboard || Object.keys(quizState.leaderboard).length === 0) {
                leaderboardContainer.innerHTML = `
                    <div class="no-question">
                        <p>No scores yet!</p>
                        <p>Start answering quiz questions to see the leaderboard.</p>
                    </div>
                `;
                return;
            }

            const sortedLeaderboard = Object.entries(quizState.leaderboard)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10);

            const leaderboardHtml = sortedLeaderboard.map(([accountId, score], index) => {
                let rankClass = '';
                let rankEmoji = `${index + 1}`;

                if (index === 0) {
                    rankClass = 'first';
                    rankEmoji = '🏆';
                } else if (index === 1) {
                    rankClass = 'second';
                    rankEmoji = '🥈';
                } else if (index === 2) {
                    rankClass = 'third';
                    rankEmoji = '🥉';
                }

                return `
                    <div class="leaderboard-item">
                        <div class="rank ${rankClass}">${rankEmoji}</div>
                        <div class="account-id">${accountId}</div>
                        <div class="score">${score} point${score === 1 ? '' : 's'}</div>
                    </div>
                `;
            }).join('');

            leaderboardContainer.innerHTML = leaderboardHtml;
        } catch (error) {
            console.error('Quiz App: Error loading leaderboard:', error);
            leaderboardContainer.innerHTML = `
                <div class="error">
                    Error loading leaderboard data. Please try refreshing.
                </div>
            `;
        }
    }

    async loadHistory() {
        const historyContainer = document.getElementById('history-list');

        historyContainer.innerHTML = `
            <div class="no-question">
                <p>History not available</p>
                <p>Only current question and leaderboard are shown.</p>
            </div>
        `;
    }

    // ✅ ИСПРАВЛЕНИЕ: Добавляем cleanup
    destroy() {
        if (this.unsubscribeWebappUpdate) {
            this.unsubscribeWebappUpdate();
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🧠 Quiz App: DOM loaded, starting initialization...');
    console.log('🧠 Quiz App: Current URL:', window.location.href);
    console.log('🧠 Quiz App: Available window properties:', {
        MiniAppAPI: !!window.MiniAppAPI,
        miniAppConfig: !!window.miniAppConfig,
        parent: window.parent !== window
    });

    const app = new QuizApp();

    // Make app available globally for debugging
    window.QuizApp = app;
    console.log('🧠 Quiz App: App instance created and attached to window');
});