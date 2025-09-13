import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { getAllBotsConfig, getBotConfig } from "./bots-service.js";

class BotManager {
  constructor() {
    this.runningBots = new Map(); // botId -> process info
    this.botLogs = new Map(); // botId -> logs array
    this.maxLogLines = 100; // Keep last 100 log lines per bot
  }

  async startBot(botId) {
    // const botConfig = getAllBotsConfig()[botId];
    const botConfig = getBotConfig(botId);
    if (!botConfig || !botConfig.enabled) {
      console.log(`Bot ${botId} is not configured or disabled`);
      return false;
    }

    if (this.runningBots.has(botId)) {
      console.log(`Bot ${botId} is already running`);
      return true;
    }

    const botScriptPath = path.join(process.cwd(), "bots", `${botId}.js`);
    
    if (!fs.existsSync(botScriptPath)) {
      console.log(`Bot script not found: ${botScriptPath}`);
      return false;
    }

    console.log(`🤖 Starting bot: ${botConfig.name} (${botId})`);

    try {
      const botProcess = spawn("node", [botScriptPath], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env }
      });

      const botInfo = {
        process: botProcess,
        startTime: new Date(),
        restarts: 0,
        name: botConfig.name
      };

      this.runningBots.set(botId, botInfo);
      this.botLogs.set(botId, []);

      // Handle bot stdout
      botProcess.stdout.on("data", (data) => {
        const message = data.toString().trim();
        this.addBotLog(botId, `[OUT] ${message}`);
        console.log(`🤖 ${botConfig.name}: ${message}`);
      });

      // Handle bot stderr
      botProcess.stderr.on("data", (data) => {
        const message = data.toString().trim();
        this.addBotLog(botId, `[ERR] ${message}`);
        console.error(`🤖 ${botConfig.name} ERROR: ${message}`);
      });

      // Handle bot exit
      botProcess.on("exit", (code, signal) => {
        console.log(`🤖 ${botConfig.name} exited with code ${code}, signal ${signal}`);
        this.runningBots.delete(botId);
        
        // Auto-restart if not intentionally stopped
        if (code !== 0 && botInfo.restarts < 5) {
          console.log(`🔄 Restarting ${botConfig.name} (attempt ${botInfo.restarts + 1}/5)`);
          setTimeout(() => {
            if (botInfo.restarts < 5) {
              botInfo.restarts++;
              this.startBot(botId);
            }
          }, 5000);
        }
      });

      botProcess.on("error", (error) => {
        console.error(`🤖 ${botConfig.name} error:`, error);
        this.addBotLog(botId, `[ERROR] ${error.message}`);
      });

      this.addBotLog(botId, `[SYSTEM] Bot started at ${botInfo.startTime.toISOString()}`);
      console.log(`✅ Bot ${botConfig.name} started successfully`);
      return true;

    } catch (error) {
      console.error(`Failed to start bot ${botId}:`, error);
      return false;
    }
  }

  stopBot(botId) {
    const botInfo = this.runningBots.get(botId);
    if (!botInfo) {
      console.log(`Bot ${botId} is not running`);
      return false;
    }

    console.log(`🛑 Stopping bot: ${botInfo.name}`);
    botInfo.process.kill("SIGTERM");
    this.runningBots.delete(botId);
    this.addBotLog(botId, `[SYSTEM] Bot stopped at ${new Date().toISOString()}`);
    return true;
  }

  async startBotsForChannel(channelId) {
    const allBots = getAllBotsConfig();
    
    for (const [botId, botConfig] of Object.entries(allBots)) {
      if (botConfig.enabled && botConfig.channels.includes(channelId)) {
        console.log(`🚀 Starting ${botConfig.name} for channel: ${channelId}`);
        await this.startBot(botId);
        
        // Small delay between bot starts
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  async startAllBots() {
    const allBots = getAllBotsConfig();
    console.log(`🤖 Starting all enabled bots...`);
    
    for (const [botId, botConfig] of Object.entries(allBots)) {
      if (botConfig.enabled) {
        await this.startBot(botId);
        // Small delay between bot starts
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  stopAllBots() {
    console.log(`🛑 Stopping all bots...`);
    for (const botId of this.runningBots.keys()) {
      this.stopBot(botId);
    }
  }

  addBotLog(botId, message) {
    const logs = this.botLogs.get(botId) || [];
    const timestamp = new Date().toISOString();
    logs.push(`[${timestamp}] ${message}`);
    
    // Keep only last N lines
    if (logs.length > this.maxLogLines) {
      logs.shift();
    }
    
    this.botLogs.set(botId, logs);
  }

  getBotLogs(botId) {
    return this.botLogs.get(botId) || [];
  }

  getAllBotLogs() {
    const allLogs = {};
    for (const [botId, logs] of this.botLogs) {
      const botConfig = getAllBotsConfig()[botId];
      allLogs[botId] = {
        name: botConfig?.name || botId,
        running: this.runningBots.has(botId),
        logs: logs
      };
    }
    return allLogs;
  }

  getBotStatus() {
    const status = {};
    const allBots = getAllBotsConfig();
    
    for (const [botId, botConfig] of Object.entries(allBots)) {
      const botInfo = this.runningBots.get(botId);
      status[botId] = {
        name: botConfig.name,
        enabled: botConfig.enabled,
        running: !!botInfo,
        startTime: botInfo?.startTime,
        restarts: botInfo?.restarts || 0,
        channels: botConfig.channels
      };
    }
    
    return status;
  }
}

export default BotManager;