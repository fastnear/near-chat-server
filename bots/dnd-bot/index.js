import * as dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load bot-specific .env file
dotenv.config({ path: join(__dirname, '.env') });
import { BaseBot } from "../../shared/base-bot.js";

const WS_URL = process.env.WS_URL || "ws://localhost:7071";
const BOT_ACCOUNT_ID = process.env.DND_BOT_ACCOUNT_ID || "dnd-master.near";
const BOT_PRIVATE_KEY = process.env.DND_BOT_PRIVATE_KEY;

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/";
const MODEL_NAME = process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
const OPENAI_MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS) || 1600;

// D&D Classes and their starting stats
const DND_CLASSES = {
  "Warrior": {
    hp: 12,
    gold: 50,
    description: "Strong fighter with sword and shield",
    equipment: ["Iron Sword", "Wooden Shield", "Leather Armor"]
  },
  "Mage": {
    hp: 8,
    gold: 80,
    description: "Powerful spellcaster with magical abilities",
    equipment: ["Magic Staff", "Spell Tome", "Mage Robes"]
  },
  "Rogue": {
    hp: 10,
    gold: 100,
    description: "Stealthy assassin with daggers and cunning",
    equipment: ["Twin Daggers", "Lockpicks", "Dark Cloak"]
  },
  "Ranger": {
    hp: 10,
    gold: 60,
    description: "Forest guardian with bow and nature magic",
    equipment: ["Longbow", "Quiver of Arrows", "Forest Cloak"]
  },
  "Cleric": {
    hp: 9,
    gold: 40,
    description: "Holy healer with divine powers",
    equipment: ["Holy Mace", "Healing Herbs", "Blessed Robes"]
  },
  "Barbarian": {
    hp: 14,
    gold: 30,
    description: "Wild berserker with incredible strength",
    equipment: ["Battle Axe", "Animal Pelts", "Rage Totem"]
  }
};

class DNDBot extends BaseBot {
  constructor() {
    super("dnd-bot", BOT_ACCOUNT_ID, BOT_PRIVATE_KEY, WS_URL);

    // Game state
    this.gameState = new Map(); // channelId -> game state
    this.loadGameState();
  }

  getBotInfo() {
    return {
      name: "D&D Master",
      description: "AI Dungeon Master for epic fantasy adventures",
    };
  }

  getWebappPath() {
    return join(__dirname, 'webapp');
  }

  getMiniappVersion() {
    return '1.0.0';
  }

  getMiniappPermissions() {
    return [];
  }

  // Handle miniapp requests
  async handleMiniappRequest(message) {
    await super.handleMiniappRequest(message);
  }

  // Send webapp update to all channel participants
  async sendWebappUpdate(channelId, updateType, data) {
    try {
      await this.sendMessage('webapp_update', {
        channelId,
        updateData: {
          type: updateType,
          data: data,
          timestamp: Date.now()
        }
      });

      console.log(`D&D Bot: Sent webapp_update (${updateType}) to channel ${channelId}`);
    } catch (error) {
      console.error(`D&D Bot: Error sending webapp_update:`, error);
    }
  }

  // Override handleChannelMessage to handle successful channel join
  handleChannelMessage(data) {
    const { action, channelId, clientIdentity } = data;

    // Call parent handler first
    super.handleChannelMessage(data);

    // Handle successful join
    if (action === "joined" && clientIdentity.accountId === this.botAccountId) {
      console.log(`D&D Bot: Successfully joined channel ${channelId}, initializing...`);

      // Initialize channel after successful join
      setTimeout(async () => {
        await this.initializeChannel(channelId);
      }, 500);
    }

    // Handle user joining - invite them to join the adventure
    if (action === "joined" && clientIdentity.accountId !== this.botAccountId) {
      console.log(`D&D Bot: User ${clientIdentity.accountId} joined channel ${channelId}`);
      setTimeout(async () => {
        await this.inviteUserToAdventure(channelId, clientIdentity.accountId);
      }, 1000);
    }
  }

  // Initialize channel after bot joining
  async initializeChannel(channelId) {
    try {
      const state = this.getChannelGameState(channelId);
      console.log(`D&D Bot: Channel ${channelId} current state:`, {
        playersCount: Object.keys(state.players).length,
        currentStory: !!state.currentStory,
        gameActive: state.gameActive
      });

      // Send initial state to webapp
      await this.sendWebappUpdate(channelId, 'initial_state', {
        players: state.players,
        deadPlayers: state.deadPlayers,
        currentStory: state.currentStory,
        gameActive: state.gameActive,
        turnCount: state.turnCount || 0
      });

      // Welcome message
      if (!state.gameActive && Object.keys(state.players).length === 0) {
        const welcomeMsg = `🎲 Welcome to the D&D Adventure! 🎲

🗡️ I am your AI Dungeon Master, ready to guide you through epic fantasy quests!

How to join:
• Type /join in the chat to enter the game
• Choose your character class in the miniapp above
• Begin your journey!

Waiting for brave adventurers to join...`;

        await this.sendChannelMessage(channelId, welcomeMsg);
      } else if (state.gameActive) {
        // Continue existing adventure
        const storyText = typeof state.currentStory === 'object' ? state.currentStory.story : state.currentStory;
        await this.sendChannelMessage(channelId, `🎲 Adventure continues!\n\n${storyText}`);
      }
    } catch (error) {
      console.error(`D&D Bot: Error initializing channel ${channelId}:`, error);
    }
  }

  // Invite user to join the adventure
  async inviteUserToAdventure(channelId, accountId) {
    const state = this.getChannelGameState(channelId);

    // Always send current game state to user (whether new or returning)
    console.log(`D&D Bot: Sending current game state to ${accountId} in ${channelId}`);
    await this.sendWebappUpdate(channelId, 'current_state', {
      players: state.players,
      deadPlayers: state.deadPlayers,
      currentStory: state.currentStory,
      gameActive: state.gameActive,
      turnCount: state.turnCount || 0,
      targetUser: accountId
    });

    // Don't send invite message if user is already playing or dead
    if (state.players[accountId] || state.deadPlayers[accountId]) {
      console.log(`D&D Bot: User ${accountId} already in game, skipping invite`);
      return;
    }

    const inviteMsg = `🎲 Welcome, ${accountId}!

⚔️ Ready to join this epic D&D adventure?

Type /join in the chat to enter, then:
• Choose your character class in the miniapp above
• Get your starting health points and gold
• Begin your quest!

The realm awaits your courage...`;

    await this.sendChannelMessage(channelId, inviteMsg);
  }

  // Load game state from file
  loadGameState() {
    try {
      const statePath = join(__dirname, 'dnd-state.json');
      if (fs.existsSync(statePath)) {
        const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        this.gameState = new Map(Object.entries(data));
        console.log(`D&D Bot: Loaded state for ${this.gameState.size} channels`);
      }
    } catch (error) {
      console.error('D&D Bot: Error loading state:', error);
    }
  }

  // Save game state to file
  saveGameState() {
    try {
      const statePath = join(__dirname, 'dnd-state.json');
      const data = Object.fromEntries(this.gameState.entries());
      fs.writeFileSync(statePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('D&D Bot: Error saving state:', error);
    }
  }

  // Get or create game state for channel
  getChannelGameState(channelId) {
    if (!this.gameState.has(channelId)) {
      this.gameState.set(channelId, {
        players: {}, // accountId -> { class, hp, maxHp, gold, alive, equipment }
        deadPlayers: {}, // accountId -> { class, maxHp, gold, deathTime, equipment }
        currentStory: null,
        gameActive: false,
        storyHistory: [], // Keep last few story beats
        turnCount: 0 // Track game progression for escalating danger
      });
    }
    return this.gameState.get(channelId);
  }

  // Add player to the game
  addPlayerToGame(channelId, accountId, characterClass) {
    const state = this.getChannelGameState(channelId);
    const classInfo = DND_CLASSES[characterClass];

    if (!classInfo) {
      return { success: false, error: "Invalid character class" };
    }

    // Check if already playing
    if (state.players[accountId] || state.deadPlayers[accountId]) {
      return { success: false, error: "Already in this adventure" };
    }

    // Add player with starting equipment
    state.players[accountId] = {
      class: characterClass,
      hp: classInfo.hp,
      maxHp: classInfo.hp,
      gold: classInfo.gold,
      alive: true,
      equipment: [...classInfo.equipment], // Copy starting equipment
      joinedAt: Date.now()
    };

    this.saveGameState();

    // If this is the first player, start the adventure
    if (Object.keys(state.players).length === 1) {
      this.startNewAdventure(channelId);
    }

    return { success: true, player: state.players[accountId] };
  }

  // Start new adventure
  async startNewAdventure(channelId) {
    const state = this.getChannelGameState(channelId);
    state.gameActive = true;

    // Generate opening story
    const story = await this.generateStory(channelId, "start");
    state.currentStory = story;
    state.storyHistory = [story];

    this.saveGameState();

    // Announce adventure start
    const startMsg = `🎲 The Adventure Begins! 🎲

${story}

💡 How to play:
• Describe what your character wants to do
• I'll determine if your action succeeds based on your class and situation
• Be creative with your actions!
• Use gold wisely - I don't give discounts!

⚔️ Current Heroes:
${Object.entries(state.players).map(([id, p]) => `• ${id} (${p.class}) - ${p.hp}/${p.maxHp} HP, ${p.gold} gold`).join('\n')}`;

    await this.sendChannelMessage(channelId, startMsg);

    // Send webapp update
    await this.sendWebappUpdate(channelId, 'adventure_started', {
      players: state.players,
      deadPlayers: state.deadPlayers,
      currentStory: state.currentStory,
      gameActive: state.gameActive,
      turnCount: state.turnCount || 0
    });
  }

  // Start completely new adventure with fresh setting
  async startNewAdventure(channelId) {
    const state = this.getChannelGameState(channelId);

    // Clear everything and generate new setting
    state.players = {};
    state.deadPlayers = {};
    state.gameActive = false;
    state.turnCount = 0;
    state.storyHistory = [];
    state.currentStory = null;

    this.saveGameState();

    // Generate new bloodthirsty setting
    const newStory = await this.generateStory(channelId, "new_game_start");

    state.currentStory = newStory.story || newStory;
    state.storyHistory.push(state.currentStory);

    this.saveGameState();

    // Notify players
    await this.sendChannelMessage(channelId, `🩸 A NEW NIGHTMARE BEGINS! 🩸

${state.currentStory}

💀 Previous heroes have fallen, but death is just the beginning...
⚔️ Join this fresh hell - choose your doomed class and let's see how you die!`);

    // Send webapp update
    await this.sendWebappUpdate(channelId, 'game_reset', {
      players: {},
      deadPlayers: {},
      currentStory: state.currentStory,
      gameActive: false,
      turnCount: 0
    });
  }

  // Generate story using OpenAI
  async generateStory(channelId, type = "continue", action = null, playerClass = null) {
    if (!OPENAI_API_KEY) {
      // Fallback stories
      const fallbackStories = {
        start: "You find yourselves at the entrance of a mysterious dungeon. Dark stone walls stretch into shadows, and the air carries whispers of ancient magic. Strange glowing runes pulse on the walls, beckoning you deeper into the unknown depths.",
        continue: "The adventure continues as mysterious sounds echo from the darkness ahead. What will you do next?"
      };
      return fallbackStories[type] || fallbackStories.continue;
    }

    try {
      const state = this.getChannelGameState(channelId);
      const players = Object.entries(state.players).map(([id, p]) => `${id} (${p.class}, ${p.hp}/${p.maxHp} HP, ${p.gold} gold)`);

      let prompt = "";

      if (type === "start") {
        prompt = `You are a creative D&D Dungeon Master. Create an engaging opening scene for a fantasy adventure. The party consists of: ${players.join(', ')}.

Create a vivid, atmospheric opening that:
- Sets up an interesting location or situation
- Gives the players something to investigate or decide
- Is 2-3 sentences long
- Ends with a clear opportunity for player action
- Mentions potential treasures or rewards

Make it exciting and immersive!`;
      } else if (type === "new_game_start") {
        prompt = `You are a bloodthirsty, sarcastic D&D Dungeon Master with decades of experience crushing heroes' dreams. Create a BRUTAL, atmospheric opening scene for a fresh adventure.

Requirements:
- DANGEROUS, unforgiving setting (haunted graveyards, demon-infested ruins, cursed swamps, cannibal villages, etc.)
- Dark, foreboding atmosphere with immediate mortal peril
- 2-3 sentences maximum
- End with a choice that will likely kill someone
- Make it clear death is not just possible, but probable
- Be witty and slightly mocking in tone

Examples of the mood:
"The blood-soaked altar still drips from the last 'heroes' who thought they were clever..."
"You smell the rotting corpses of previous adventurers before you see them..."
"The locals warned you this place devours souls, but you're here anyway like the fools you are..."

Create a setting that promises swift, brutal death for overconfident adventurers!`;
      } else if (type === "action_result") {
        const turnCount = state.turnCount || 0;
        const dangerLevel = Math.min(Math.floor(turnCount / 4) + 1, 5); // 1-5 danger levels

        prompt = `You are a creative D&D Dungeon Master who adapts ANY player action into the fantasy world. NEVER refuse player actions - instead, find creative ways to make them work within the fantasy setting.

IMPORTANT: Players can only take actions by mentioning @dnd-bot. Regular chat messages are ignored. Tell them this rule if they seem confused.

Current party data (ALL PLAYERS IN THE SAME GROUP):
${JSON.stringify(state.players, null, 2)}

FULL ADVENTURE HISTORY (maintain complete context):
${state.storyHistory.join('\n\n--- Next Turn ---\n\n')}

Player: ${action.player} (${playerClass})
Action attempted: ${action.description}
Current Turn: ${turnCount}/20 (Danger Level: ${dangerLevel}/5)

CREATIVE ADAPTATION RULES:
- ALWAYS find a way to make the player's action work in the fantasy world
- If they mention modern things (NEAR tokens, crypto, etc.), translate them to fantasy equivalents:
  * "NEAR tokens" = "enchanted crystal shards" or "ancient runes of power"
  * "selling armor/weapons" = finding mysterious traders, ancient merchants, or magical exchanges
  * Modern concepts = fantasy world equivalents with similar value/function
- Be willing to take their gold in exchange for fantasy equivalents that make sense
- Create interesting fantasy solutions to their requests
- Award or deduct gold based on their creative actions (5-50 gold range)
- Make every action lead to adventure - even strange requests become plot hooks
- APPLY REAL CONSEQUENCES: If players make bad decisions, let them suffer the results
- DON'T BE FORGIVING: Stupid actions lead to stupid consequences (damage, gold loss, bad situations)
- If they want to hurt themselves or do something dangerous - LET THEM and describe the painful results
- EQUIPMENT SYSTEM: Players can lose, trade, steal, or find new equipment - track changes dynamically
- PLAYER INTERACTIONS: All players are in the SAME ADVENTURING PARTY. They can attack, heal, trade with each other. Update stats for ALL affected players.
- GROUP COMBAT: When fighting enemies or taking damage, enemies can retaliate against ANY player in the party, not just the one who acted.
- SHARED CONSEQUENCES: Actions by one player can affect the entire party (e.g., if someone alerts guards, ALL players are in danger).
- ESCALATING DANGER SYSTEM:
  * Turn 1-4 (Level 1): Mild dangers, 10% death chance per action
  * Turn 5-8 (Level 2): Moderate dangers, 20% death chance
  * Turn 9-12 (Level 3): High dangers, 30% death chance
  * Turn 13-16 (Level 4): Extreme dangers, 40% death chance
  * Turn 17-20 (Level 5): DEADLY encounters, 50% death chance
  * IMPORTANT: Players KNOW this is a game and WANT exciting deaths for good stories!

EXAMPLES:
- "I want NEAR tokens" → "You find a mysterious trader who offers glowing crystal shards of ancient power for 25 gold each"
- "I sell my armor" → "A shadowy merchant appears and buys your armor for 30 gold, leaving you exposed and vulnerable"
- "I shoot myself in the foot" → "Your arrow pierces your foot! You take 3 damage and move slowly. Blood pools beneath you."

Based on the player's class and creative action, make it work in the fantasy world with realistic consequences. Consider:
- Class abilities can enhance OR worsen the outcome
- Bad decisions should hurt (damage, gold loss, terrible situations)
- Spending gold gets fantasy equivalents, but foolish trades are allowed
- Dangerous actions cause real harm without mercy
- Every action has consequences - good or bad

RESPONSE FORMAT:
Return your response as JSON with exactly this structure:
{
  "story": "Your 2-3 sentence story response (no markdown formatting). ALWAYS reference the full adventure context, not just this single action.",
  "updatedPlayers": {
    // Complete updated player objects with any changes (hp, gold, equipment, alive status)
    // Include ALL players, even if unchanged
    // Remember: players are in a party together - one action can affect multiple players
  }
}

CONTEXT AWARENESS: You have access to the COMPLETE adventure history. Reference previous events, maintain story continuity, and remember character relationships and ongoing situations. This is a continuing story, not isolated actions.

Be dramatic, creative, and ruthlessly fair!`;
      }

      const response = await fetch(`${OPENAI_ENDPOINT}chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            {
              role: "system",
              content: "You are a legendary D&D Dungeon Master - a grizzled veteran with 40+ years of destroying player dreams with wit and wisdom. You're BRUTAL but fair, SARCASTIC but creative, and you've seen every stupid player trick in the book. You NEVER say 'no' to player actions - instead you say 'Sure, let's see how spectacularly this backfires...' You adapt everything into the fantasy world with REALISTIC (often painful) CONSEQUENCES. Modern concepts become fantasy equivalents. Stupid decisions get mocked AND punished. Smart decisions get grudging respect and rewards. You roast players with sharp wit while describing their inevitable doom. Always say 'yes, and here's your Darwin Award moment...' Write in plain text without any markdown formatting. Be memorable, quotable, and devastatingly funny."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: OPENAI_MAX_TOKENS,
          temperature: 0.9
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || "The story continues...";

      // Try to parse as JSON, fallback to plain text
      try {
        return JSON.parse(content);
      } catch (e) {
        return { story: content, updatedPlayers: null };
      }

    } catch (error) {
      console.error("D&D Bot: Error generating story:", error);
      return { story: "The adventure continues as fate takes an unexpected turn...", updatedPlayers: null };
    }
  }

  // Parse gold amounts from AI story response
  parseGoldFromStory(storyText, type) {
    try {
      // Look for patterns like "gains 15 gold", "finds 10 gold", "costs 25 gold", "spends 30 gold"
      const gainPatterns = [
        /(?:gains?|finds?|earns?|receives?)\s+(\d+)\s+gold/gi,
        /(\d+)\s+gold\s+(?:gained|found|earned|received)/gi
      ];

      const spentPatterns = [
        /(?:costs?|spends?|pays?|loses?)\s+(\d+)\s+gold/gi,
        /(\d+)\s+gold\s+(?:cost|spent|paid|lost)/gi
      ];

      const patterns = type === 'gained' ? gainPatterns : spentPatterns;
      let maxAmount = 0;

      for (const pattern of patterns) {
        const matches = [...storyText.matchAll(pattern)];
        for (const match of matches) {
          const amount = parseInt(match[1], 10);
          if (!isNaN(amount)) {
            maxAmount = Math.max(maxAmount, amount);
          }
        }
      }

      return maxAmount;
    } catch (error) {
      console.error('Error parsing gold from story:', error);
      return 0;
    }
  }


  // Process player action
  async processPlayerAction(channelId, accountId, action) {
    const state = this.getChannelGameState(channelId);
    const player = state.players[accountId];

    // Check if player is alive and in game
    if (!player || !player.alive) {
      return {
        success: false,
        message: state.deadPlayers[accountId] ?
          `💀 The spirit of ${accountId} whispers from beyond, but the living world cannot hear...` :
          "You're not part of this adventure yet! Join through the webapp."
      };
    }

    // Check if game is active
    if (!state.gameActive) {
      return {
        success: false,
        message: "No adventure is currently active. Wait for more players to join!"
      };
    }

    // Increment turn count for escalating danger
    state.turnCount++;
    console.log(`D&D Bot: Turn ${state.turnCount} in channel ${channelId}`);

    // Generate story result
    const aiResponse = await this.generateStory(channelId, "action_result", {
      player: accountId,
      description: action
    }, player.class);

    const storyText = aiResponse.story || "The adventure continues...";
    let statusUpdate = "";

    // Apply updated player data if provided by AI
    if (aiResponse.updatedPlayers) {
      for (const [playerId, updatedPlayer] of Object.entries(aiResponse.updatedPlayers)) {
        const currentPlayer = state.players[playerId];
        if (!currentPlayer) continue;

        // Compare and apply changes
        const changes = [];

        // HP changes
        if (updatedPlayer.hp !== currentPlayer.hp) {
          const hpDiff = updatedPlayer.hp - currentPlayer.hp;
          if (hpDiff > 0) {
            changes.push(`+${hpDiff} HP`);
          } else {
            changes.push(`${hpDiff} HP`);
          }
          currentPlayer.hp = Math.max(0, updatedPlayer.hp);
        }

        // Gold changes
        if (updatedPlayer.gold !== currentPlayer.gold) {
          const goldDiff = updatedPlayer.gold - currentPlayer.gold;
          if (goldDiff > 0) {
            changes.push(`+${goldDiff} gold`);
          } else {
            changes.push(`${goldDiff} gold`);
          }
          currentPlayer.gold = Math.max(0, updatedPlayer.gold);
        }

        // Equipment changes
        if (JSON.stringify(updatedPlayer.equipment) !== JSON.stringify(currentPlayer.equipment)) {
          currentPlayer.equipment = [...(updatedPlayer.equipment || [])];
          changes.push('equipment updated');
        }

        // Add status update for this player BEFORE potential deletion
        if (changes.length > 0) {
          statusUpdate += `\n\n📊 ${playerId}: ${changes.join(', ')} (${currentPlayer.hp}/${currentPlayer.maxHp} HP, ${currentPlayer.gold} gold)`;
        }

        // Death check (after status update)
        if (currentPlayer.hp <= 0 && currentPlayer.alive) {
          currentPlayer.alive = false;
          state.deadPlayers[playerId] = {
            class: currentPlayer.class,
            maxHp: currentPlayer.maxHp,
            gold: currentPlayer.gold,
            equipment: currentPlayer.equipment,
            deathTime: Date.now()
          };
          delete state.players[playerId];
        }
      }

      // Save state immediately after applying AI changes
      this.saveGameState();
    }

    // Check if all players are dead
    if (Object.keys(state.players).length === 0 && state.gameActive) {
      state.gameActive = false;
      statusUpdate += `\n\n🪦 All heroes have perished! The adventure ends in darkness...\nWaiting for new brave souls to begin a fresh quest...`;

      // Auto-restart the game after a brief delay
      setTimeout(async () => {
        await this.startNewAdventure(channelId);
      }, 3000); // 3 second delay
    }

    // Update story
    const fullStory = storyText + statusUpdate;
    state.currentStory = fullStory;
    state.storyHistory.push(fullStory);
    if (state.storyHistory.length > 5) {
      state.storyHistory = state.storyHistory.slice(-5);
    }

    this.saveGameState();

    // Send webapp update
    await this.sendWebappUpdate(channelId, 'action_result', {
      players: state.players,
      deadPlayers: state.deadPlayers,
      currentStory: state.currentStory,
      gameActive: state.gameActive,
      turnCount: state.turnCount
    });

    return {
      success: true,
      message: fullStory
    };
  }

  // Handle channel messages
  async onChannelMessage(channelId, message, sender, nonce, action) {
    if (action !== "message" || !message) return;

    const messageText = typeof message === 'string' ? message : message.text;
    if (!messageText) return;

    const trimmed = messageText.trim();

    // Only respond to messages that mention configured mentions or special commands
    console.log(`D&D Bot (${this.botAccountId}): Received message in ${channelId} from ${sender.accountId}: "${trimmed}"`);

    // Check for mentions from config
    let isDndBotMention = false;
    if (this.config && this.config.filters && this.config.filters.mentions) {
      console.log(`D&D Bot: Checking mentions:`, this.config.filters.mentions);
      isDndBotMention = this.config.filters.mentions.some(mention => {
        const matches = trimmed.toLowerCase().includes(mention.toLowerCase());
        console.log(`D&D Bot: "${mention}" in "${trimmed}"? ${matches}`);
        return matches;
      });
    }

    // Check for commands from config
    let isCommand = false;
    if (this.config && this.config.filters && this.config.filters.commands) {
      console.log(`D&D Bot: Checking commands:`, this.config.filters.commands);
      isCommand = this.config.filters.commands.some(command => {
        const matches = trimmed.toLowerCase().startsWith(command.toLowerCase());
        console.log(`D&D Bot: "${command}" starts "${trimmed}"? ${matches}`);
        return matches;
      });
    }

    if (!isDndBotMention && !isCommand) {
      return; // Ignore regular chat messages
    }

    console.log(`D&D Bot: Processing message in ${channelId} from ${sender.accountId}: "${trimmed}"`);

    const state = this.getChannelGameState(channelId);

    // Handle special commands
    if (trimmed.startsWith('/')) {
      if (trimmed === '/join') {
        await this.handleJoinCommand(channelId, sender.accountId, nonce);
        return;
      } else if (trimmed === '/reset') {
        await this.handleResetCommand(channelId, sender.accountId, nonce);
        return;
      }
      return;
    }

    // Extract action text (remove any bot mentions)
    let actionText = trimmed;
    for (const mention of this.config.filters.mentions) {
      actionText = actionText.replace(mention, '');
    }
    actionText = actionText.trim();
    if (!actionText) return;

    // Process as player action if game is active and player is alive
    if (state.gameActive && state.players[sender.accountId]?.alive) {
      console.log(`D&D Bot: Processing action from ${sender.accountId}: "${actionText}"`);

      // Send temporary "thinking" message
      const thinkingMessages = [
        "🎲 The GameMaster contemplates your move...",
        "⚡ Rolling the dice of fate...",
        "🧙‍♂️ The GameMaster calculates consequences...",
        "🎭 Weaving your action into the tale...",
        "⚔️ Determining if you live or die..."
      ];
      const randomThinking = thinkingMessages[Math.floor(Math.random() * thinkingMessages.length)];

      const thinkingNonce = await this.sendChannelMessage(channelId, randomThinking, nonce);

      try {
        const result = await this.processPlayerAction(channelId, sender.accountId, actionText);

        // Delete the thinking message
        this.deleteMessage(channelId, thinkingNonce);

        if (result.success) {
          await this.sendChannelMessage(channelId, result.message, nonce);
        } else {
          // Send temporary message for errors
          const errorNonce = await this.sendChannelMessage(channelId, result.message, nonce);
          if (result.message.includes('spirit') || result.message.includes('beyond')) {
            // Delete dead player messages after 3 seconds
            setTimeout(() => {
              this.deleteMessage(channelId, errorNonce);
            }, 3000);
          }
        }
      } catch (error) {
        // Delete thinking message even if there's an error
        this.deleteMessage(channelId, thinkingNonce);
        throw error; // Re-throw the error
      }
    } else if (state.deadPlayers[sender.accountId]) {
      // Dead player speaking
      const ghostMessage = `👻 The spirit of ${sender.accountId} whispers: "${actionText}"\nBut their voice echoes from beyond the veil, unable to affect the living world...`;
      const ghostNonce = await this.sendChannelMessage(channelId, ghostMessage, nonce);

      // Delete after 5 seconds
      setTimeout(() => {
        this.deleteMessage(channelId, ghostNonce);
      }, 5000);
    } else {
      // Player not in game but mentioned bot
      const helpMessage = `${sender.accountId}, you need to join the adventure first! Type /join and choose your character class in the miniapp above.`;
      await this.sendChannelMessage(channelId, helpMessage, nonce);
    }
  }

  // Handle custom message types from webapp
  handleCustomMessage(message) {
    switch (message.type) {
      case "join_adventure":
        this.handleJoinAdventure(message);
        break;
      default:
        console.log(`D&D Bot: Unknown custom message type: ${message.type}`);
    }
  }

  // Handle /join command
  async handleJoinCommand(channelId, accountId, nonce) {
    console.log(`D&D Bot: ${accountId} used /join command in ${channelId}`);

    const state = this.getChannelGameState(channelId);

    // Check if already in game
    if (state.players[accountId] || state.deadPlayers[accountId]) {
      const playerStatus = state.players[accountId] ?
        `You are already playing as a ${state.players[accountId].class} with ${state.players[accountId].hp}/${state.players[accountId].maxHp} HP!` :
        `Your spirit has already fallen in this adventure...`;
      await this.sendChannelMessage(channelId, `${accountId}, ${playerStatus}`);
      return;
    }

    const joinMsg = `Welcome, ${accountId}!

To join the adventure:
1. Choose your character class in the miniapp above
2. Click the "Join as [Class]" button
3. Begin your quest!

Available classes: Warrior, Mage, Rogue, Ranger, Cleric, Barbarian`;

    await this.sendChannelMessage(channelId, joinMsg);
  }

  // Handle /reset command
  async handleResetCommand(channelId, accountId, nonce) {
    console.log(`D&D Bot: ${accountId} used /reset command in ${channelId}`);

    // Reset game state for this channel
    this.gameState.set(channelId, {
      players: {},
      deadPlayers: {},
      currentStory: null,
      gameActive: false,
      storyHistory: [],
      turnCount: 0
    });

    this.saveGameState();

    const resetMsg = `The adventure has been reset!

All heroes have departed, and the realm awaits new champions.

Type /join to enter the game and choose your character class in the miniapp above.`;

    await this.sendChannelMessage(channelId, resetMsg);

    // Send webapp update
    await this.sendWebappUpdate(channelId, 'game_reset', {
      players: {},
      deadPlayers: {},
      currentStory: null,
      gameActive: false,
      turnCount: 0
    });
  }

  // Handle join adventure request from webapp
  async handleJoinAdventure(message) {
    const { channelId, accountId, characterClass } = message;

    // Check if already in game BEFORE logging to prevent spam
    const state = this.getChannelGameState(channelId);
    if (state.players[accountId] || state.deadPlayers[accountId]) {
      console.log(`D&D Bot: Ignoring duplicate join attempt from ${accountId} (already in game)`);
      return;
    }

    console.log(`D&D Bot: ${accountId} wants to join adventure in ${channelId} as ${characterClass}`);

    // Add small delay to prevent double-clicking issues
    await new Promise(resolve => setTimeout(resolve, 100));

    const result = this.addPlayerToGame(channelId, accountId, characterClass);

    if (result.success) {
      const joinMsg = `${accountId} joins as a ${characterClass}! (${result.player.hp} HP)

${DND_CLASSES[characterClass].description}

⚔️ Starting Equipment: ${result.player.equipment.join(', ')}
💰 Starting Gold: ${result.player.gold}

Welcome to the party, brave adventurer! Remember: use @dnd-bot to take actions!`;

      await this.sendChannelMessage(channelId, joinMsg);

      // Send webapp update
      const state = this.getChannelGameState(channelId);
      await this.sendWebappUpdate(channelId, 'player_joined', {
        players: state.players,
        deadPlayers: state.deadPlayers,
        currentStory: state.currentStory,
        gameActive: state.gameActive,
        turnCount: state.turnCount || 0
      });
    } else {
      // Only send error message if it's not the "already in adventure" error
      // This prevents spam when users double-click
      if (result.error !== "Already in this adventure") {
        await this.sendChannelMessage(channelId, `Error: ${result.error}`);
      } else {
        console.log(`D&D Bot: Ignoring duplicate join attempt from ${accountId}`);
      }
    }
  }

}

// Start the bot
const dndBot = new DNDBot();
await dndBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down D&D Bot...");
  dndBot.saveGameState();
  if (dndBot.ws) {
    dndBot.ws.close();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down D&D Bot...");
  dndBot.saveGameState();
  if (dndBot.ws) {
    dndBot.ws.close();
  }
  process.exit(0);
});