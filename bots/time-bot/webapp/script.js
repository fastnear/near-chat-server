class TimeApp {
    constructor() {
        this.is24HourFormat = true;
        this.debugPanel = null;
        this.init();
    }

    init() {
        this.createDebugPanel();
        this.setupMiniAppIntegration();
        this.updateTime();
        this.setupEventListeners();

        // Update time every second
        setInterval(() => {
            this.updateTime();
        }, 1000);
    }

    setupEventListeners() {
        const refreshBtn = document.getElementById('refresh-btn');
        const formatBtn = document.getElementById('format-btn');

        refreshBtn.addEventListener('click', () => {
            this.logDebug('🔄 Refresh button clicked');
            this.updateTime();
            this.animateButton(refreshBtn);
        });

        formatBtn.addEventListener('click', () => {
            this.logDebug(`📅 Format toggle clicked (switching to ${this.is24HourFormat ? '12H' : '24H'})`);
            this.toggleTimeFormat();
            this.animateButton(formatBtn);
        });
    }

    updateTime() {
        const now = new Date();

        // Current local time
        this.updateLocalTime(now);

        // Time zones
        this.updateTimeZone(now, 'ny-time', 'America/New_York');
        this.updateTimeZone(now, 'london-time', 'Europe/London');
        this.updateTimeZone(now, 'tokyo-time', 'Asia/Tokyo');
        this.updateTimeZone(now, 'utc-time', 'UTC');

        // Log time update (only every 10 seconds to avoid spam)
        if (now.getSeconds() % 10 === 0) {
            this.logDebug(`Time updated: ${now.toLocaleTimeString()}`);
        }
    }

    updateLocalTime(date) {
        const timeElement = document.getElementById('current-time');
        const dateElement = document.getElementById('current-date');

        const timeOptions = {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: !this.is24HourFormat
        };

        const dateOptions = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };

        timeElement.textContent = date.toLocaleTimeString([], timeOptions);
        dateElement.textContent = date.toLocaleDateString([], dateOptions);
    }

    updateTimeZone(date, elementId, timeZone) {
        const element = document.getElementById(elementId);

        const options = {
            timeZone: timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: !this.is24HourFormat
        };

        element.textContent = date.toLocaleTimeString([], options);
    }

    toggleTimeFormat() {
        this.is24HourFormat = !this.is24HourFormat;
        this.updateTime();

        const formatBtn = document.getElementById('format-btn');
        formatBtn.textContent = this.is24HourFormat ? '🕐 12H Format' : '🕧 24H Format';
    }

    animateButton(button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = 'scale(1)';
        }, 150);
    }

    createDebugPanel() {
        this.debugPanel = document.createElement('div');
        this.debugPanel.id = 'debug-panel';
        this.debugPanel.innerHTML = `
            <div class="debug-header">
                <span>🐛 Debug Panel</span>
                <button id="debug-toggle">-</button>
            </div>
            <div class="debug-content">
                <div class="debug-section">
                    <h4>MiniApp Integration</h4>
                    <div id="debug-miniapp"></div>
                </div>
                <div class="debug-section">
                    <h4>User Authentication</h4>
                    <div id="debug-auth"></div>
                </div>
                <div class="debug-section">
                    <h4>Activity Log</h4>
                    <div id="debug-log"></div>
                </div>
            </div>
        `;
        document.body.appendChild(this.debugPanel);

        // Toggle functionality
        document.getElementById('debug-toggle').addEventListener('click', () => {
            const content = this.debugPanel.querySelector('.debug-content');
            const toggle = document.getElementById('debug-toggle');
            if (content.style.display === 'none') {
                content.style.display = 'block';
                toggle.textContent = '-';
            } else {
                content.style.display = 'none';
                toggle.textContent = '+';
            }
        });

        this.logDebug('TimeApp initialized');
    }

    setupMiniAppIntegration() {
        this.logDebug('Setting up MiniApp integration...');

        // Mini-app initialization listener
        window.addEventListener('miniapp-init', (event) => {
            this.logDebug('MiniApp init event received', event.detail);

            if (window.MiniAppAPI) {
                this.logDebug('MiniAppAPI detected');
                this.updateDebugSection('debug-miniapp', '✅ MiniAppAPI available');

                try {
                    const auth = window.MiniAppAPI.getUserAuth();
                    const config = window.MiniAppAPI.getConfig();
                    this.logDebug('User auth retrieved:', auth);
                    this.logDebug('Full config:', config);

                    if (window.MiniAppAPI.verifyUserAuth()) {
                        this.logDebug(`✅ User authenticated: ${auth.accountId}`);

                        // Get timestamp from the right place
                        const timestamp = auth.authData?.timestamp || auth.timestamp;
                        const timestampStr = timestamp ? new Date(timestamp).toLocaleString() : 'N/A';

                        this.updateDebugSection('debug-auth',
                            `✅ Authenticated as: <strong>${auth.accountId}</strong><br>
                             Public Key: ${auth.publicKey ? auth.publicKey.substring(0, 20) + '...' : 'N/A'}<br>
                             Timestamp: ${timestampStr}<br>
                             Channel: ${config.channelId || 'N/A'}`
                        );

                        // Bot can verify the signature server-side if needed
                        // The signed message proves the user owns this NEAR account
                        this.logDebug('User signature can be verified server-side for additional security');

                        // Request token balance after successful authentication
                        this.requestTokenBalance(auth.accountId);

                        // Display additional chat data
                        this.displayChatData();
                    } else {
                        this.logDebug('❌ User authentication failed');
                        this.logDebug('Auth verification details:', {
                            hasAuth: !!auth,
                            hasAccountId: !!auth?.accountId,
                            hasSignature: !!auth?.signature,
                            hasPublicKey: !!auth?.publicKey,
                            hasAuthData: !!auth?.authData,
                            hasTimestamp: !!(auth?.authData?.timestamp || auth?.timestamp)
                        });
                        this.updateDebugSection('debug-auth', '❌ Authentication failed - check console for details');
                    }
                } catch (error) {
                    this.logDebug('Error in auth verification:', error);
                    this.updateDebugSection('debug-auth', `❌ Error: ${error.message}`);
                }
            } else {
                this.logDebug('⚠️ MiniAppAPI not available - running in standalone mode');
                this.updateDebugSection('debug-miniapp', '⚠️ Standalone mode (no MiniAppAPI)');
                this.updateDebugSection('debug-auth', '⚠️ No authentication available');
            }
        });

        // Check if MiniAppAPI is already available AND configured
        if (window.MiniAppAPI) {
            this.logDebug('MiniAppAPI already available');

            // Only trigger init if we also have config data
            if (window.miniAppConfig) {
                this.logDebug('Config already available, triggering immediate init');
                window.dispatchEvent(new CustomEvent('miniapp-init', {
                    detail: { source: 'immediate' }
                }));
            } else {
                this.logDebug('Waiting for INIT message with config data...');
                this.updateDebugSection('debug-miniapp', '⏳ Waiting for config data...');
            }
        } else {
            this.logDebug('Waiting for MiniAppAPI...');
            this.updateDebugSection('debug-miniapp', '⏳ Waiting for MiniAppAPI...');
        }
    }

    logDebug(message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${message}`;

        console.log(logEntry, data || '');

        const debugLog = document.getElementById('debug-log');
        if (debugLog) {
            const entry = document.createElement('div');
            entry.className = 'debug-entry';
            entry.innerHTML = `<span class="debug-time">${timestamp}</span> ${message}`;
            debugLog.appendChild(entry);
            debugLog.scrollTop = debugLog.scrollHeight;

            // Keep only last 50 entries
            while (debugLog.children.length > 50) {
                debugLog.removeChild(debugLog.firstChild);
            }
        }
    }

    updateDebugSection(sectionId, content) {
        const section = document.getElementById(sectionId);
        if (section) {
            section.innerHTML = content;
        }
    }

    async requestTokenBalance(accountId) {
        this.logDebug(`🔍 Requesting HOT token balance for ${accountId}...`);

        try {
            if (!window.MiniAppAPI || !window.MiniAppAPI.readBlockchain) {
                throw new Error('MiniAppAPI.readBlockchain not available');
            }

            this.logDebug('📡 Calling ft_balance_of on game.hot.tg contract...');

            const result = await window.MiniAppAPI.readBlockchain('game.hot.tg', 'ft_balance_of', {
                account_id: accountId
            });

            this.logDebug('✅ Balance request successful', result);

            // ft_balance_of returns balance as string
            const balanceYocto = result || '0';
            const balanceHot = this.formatTokenBalance(balanceYocto, 6);

            this.logDebug(`💰 HOT Balance: ${balanceHot} HOT (raw: ${balanceYocto})`);

            // Update debug section with balance info
            this.updateDebugSection('debug-auth',
                document.getElementById('debug-auth').innerHTML +
                `<br>💰 HOT Balance: <strong>${balanceHot} HOT</strong>`
            );

        } catch (error) {
            this.logDebug(`❌ Failed to get HOT token balance: ${error.message}`, error);

            // Update debug section with error info
            this.updateDebugSection('debug-auth',
                document.getElementById('debug-auth').innerHTML +
                `<br>❌ HOT Balance: <span style="color: red;">Error - ${error.message}</span>`
            );
        }
    }

    formatTokenBalance(balanceYocto, decimals) {
        try {
            // Convert string to BigInt for large number handling
            const balance = BigInt(balanceYocto);
            const divisor = BigInt(10 ** decimals);

            // Get whole and fractional parts
            const wholePart = balance / divisor;
            const fractionalPart = balance % divisor;

            // Convert fractional part to string with leading zeros
            const fractionalStr = fractionalPart.toString().padStart(decimals, '0');

            // Remove trailing zeros from fractional part
            const trimmedFractional = fractionalStr.replace(/0+$/, '');

            // Return formatted balance
            if (trimmedFractional === '') {
                return wholePart.toString();
            } else {
                return `${wholePart.toString()}.${trimmedFractional}`;
            }
        } catch (error) {
            this.logDebug(`❌ Error formatting balance: ${error.message}`);
            return '0';
        }
    }

    async displayChatData() {
        this.logDebug('🔍 Fetching chat data...');

        try {
            // Wait for MiniApp to be fully initialized
            if (!window.miniAppConfig) {
                this.logDebug('⏳ Waiting for miniapp config...');
                return;
            }

            const accountId = await window.MiniAppAPI.getChatData('current_account_id');
            const walletType = await window.MiniAppAPI.getChatData('wallet_type');
            const channelId = await window.MiniAppAPI.getChatData('channel_id');

            this.logDebug('📋 Chat Data Retrieved:');
            this.logDebug(`Account ID: ${accountId}`);
            this.logDebug(`Wallet Type: ${walletType}`);
            this.logDebug(`Channel ID: ${channelId}`);

            // Update debug section with chat data
            this.updateDebugSection('debug-auth',
                document.getElementById('debug-auth').innerHTML +
                `<br><br><strong>Chat Data:</strong><br>
                 Account ID: ${accountId || 'N/A'}<br>
                 Wallet Type: ${walletType || 'N/A'}<br>
                 Channel ID: ${channelId || 'N/A'}`
            );

        } catch (error) {
            this.logDebug(`❌ Failed to get chat data: ${error.message}`, error);
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 TimeApp starting...');
    const app = new TimeApp();

    // Add a fun loading animation
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease-in';
        document.body.style.opacity = '1';
        app.logDebug('✨ UI animation completed');
    }, 100);
});

// Export for potential NEAR integration
window.TimeApp = TimeApp;