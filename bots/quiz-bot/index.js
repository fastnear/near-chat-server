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
const BOT_ACCOUNT_ID = process.env.QUIZ_BOT_ACCOUNT_ID || "quiz.near";
const BOT_PRIVATE_KEY = process.env.QUIZ_BOT_PRIVATE_KEY;

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ENDPOINT = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/";
const MODEL_NAME = process.env.OPENAI_MODEL_NAME || "gpt-3.5-turbo";
const OPENAI_MAX_TOKENS = parseInt(process.env.OPENAI_MAX_TOKENS) || 1600;

class QuizBot extends BaseBot {
  constructor() {
    super("quiz-bot", BOT_ACCOUNT_ID, BOT_PRIVATE_KEY, WS_URL);

    // Quiz state
    this.quizState = new Map(); // channelId -> quiz state
    this.loadQuizState();
  }

  getBotInfo() {
    return {
      name: "Quiz Bot",
      description: "Interactive quiz bot with leaderboard",
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
    // Call parent method to handle webapp archive generation
    await super.handleMiniappRequest(message);
  }

  // Clean question data for webapp (remove sensitive info)
  cleanQuestionForWebapp(question) {
    if (!question) return null;

    return {
      question: question.question,
      startTime: question.startTime,
      answered: question.answered
      // Removed: correctAnswer, explanation (security)
    };
  }

  // Send webapp update to all channel participants
  async sendWebappUpdate(channelId, updateType, data) {
    try {
      // Clean sensitive data from currentQuestion
      const cleanData = { ...data };
      if (cleanData.currentQuestion) {
        cleanData.currentQuestion = this.cleanQuestionForWebapp(cleanData.currentQuestion);
      }

      await this.sendMessage('webapp_update', {
        channelId,
        updateData: {
          type: updateType,
          data: cleanData,
          timestamp: Date.now()
        }
      });

      console.log(`Quiz Bot: Sent webapp_update (${updateType}) to channel ${channelId}`);
    } catch (error) {
      console.error(`Quiz Bot: Error sending webapp_update:`, error);
    }
  }

  // Override handleChannelMessage to handle successful channel join
  handleChannelMessage(data) {
    const { action, channelId, clientIdentity } = data;

    // Call parent handler first
    super.handleChannelMessage(data);

    // Handle successful join
    if (action === "joined" && clientIdentity.accountId === this.botAccountId) {
      console.log(`Quiz Bot: Successfully joined channel ${channelId}, initializing...`);

      // Initialize channel after successful join
      setTimeout(async () => {
        await this.initializeChannel(channelId);
      }, 500); // Small delay to ensure everything is set up
    }
  }

  // Initialize channel after joining
  async initializeChannel(channelId) {
    try {
      const state = this.getChannelQuizState(channelId);
      console.log(`Quiz Bot: Channel ${channelId} current state:`, {
        hasQuestion: !!state.currentQuestion,
        leaderboardSize: Object.keys(state.leaderboard).length
      });

      // Send initial state to webapp
      console.log(`Quiz Bot: Sending initial webapp state to ${channelId}`);
      await this.sendWebappUpdate(channelId, 'initial_state', {
        currentQuestion: state.currentQuestion,
        leaderboard: state.leaderboard,
        answerHistory: state.answerHistory
      });

      // If there's already a current question, post it
      if (state.currentQuestion) {
        console.log(`Quiz Bot: Reposting existing question in ${channelId}: "${state.currentQuestion.question}"`);
        const questionText = `🧠 Quiz Question: ${state.currentQuestion.question}\n\nType your answer in the chat!`;
        await this.sendChannelMessage(channelId, questionText);
      } else {
        // Generate new question
        console.log(`Quiz Bot: No active question in ${channelId}, generating new one`);
        const questionText = await this.startNewQuiz(channelId);
        await this.sendChannelMessage(channelId, questionText);
      }
    } catch (error) {
      console.error(`Quiz Bot: Error initializing channel ${channelId}:`, error);
    }
  }

  // Load quiz state from file
  loadQuizState() {
    try {
      const statePath = join(__dirname, 'quiz-state.json');
      if (fs.existsSync(statePath)) {
        const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        this.quizState = new Map();

        // Convert loaded data and restore Set objects
        for (const [channelId, channelData] of Object.entries(data)) {
          const state = {
            currentQuestion: channelData.currentQuestion,
            leaderboard: channelData.leaderboard || {},
            questionHistory: channelData.questionHistory || [],
            answerHistory: channelData.answerHistory || []
          };

          // Restore answered Set if there's a current question
          if (state.currentQuestion && channelData.currentQuestion.answered) {
            state.currentQuestion.answered = new Set(channelData.currentQuestion.answered);
          }

          this.quizState.set(channelId, state);
        }

        console.log(`Quiz Bot: Loaded state for ${this.quizState.size} channels`);
      }
    } catch (error) {
      console.error('Quiz Bot: Error loading state:', error);
    }
  }

  // Save quiz state to file
  saveQuizState() {
    try {
      const statePath = join(__dirname, 'quiz-state.json');
      const data = {};

      // Convert Map and Set objects for JSON serialization
      for (const [channelId, channelData] of this.quizState.entries()) {
        data[channelId] = {
          currentQuestion: channelData.currentQuestion ? {
            ...channelData.currentQuestion,
            answered: Array.from(channelData.currentQuestion.answered) // Convert Set to Array
          } : null,
          leaderboard: channelData.leaderboard,
          questionHistory: channelData.questionHistory || [],
          answerHistory: channelData.answerHistory || []
        };
      }

      fs.writeFileSync(statePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Quiz Bot: Error saving state:', error);
    }
  }

  // Get or create quiz state for channel
  getChannelQuizState(channelId) {
    if (!this.quizState.has(channelId)) {
      this.quizState.set(channelId, {
        currentQuestion: null,
        leaderboard: {}, // accountId -> score
        questionHistory: [], // Array of previously asked questions (last 30)
        answerHistory: [] // Array of answered questions with answers and authors (last 5)
      });
    }
    return this.quizState.get(channelId);
  }

  // Generate quiz question using OpenAI
  async generateQuestion(channelId = null) {
    if (!OPENAI_API_KEY) {
      return {
        question: "What is the capital of the United States?",
        correctAnswer: "Washington",
        explanation: "Washington, D.C. is the capital city of the United States."
      };
    }

    try {
      // Get previous questions to avoid repeats
      const state = channelId ? this.getChannelQuizState(channelId) : null;
      const previousQuestions = state?.questionHistory || [];

      // Random topics to increase variety
      const topics = [
        "geography", "science", "technology", "history", "sports", "animals",
        "food", "movies", "music", "literature", "mathematics", "astronomy",
        "chemistry", "biology", "physics", "art", "culture", "languages",
        "cryptocurrency", "blockchain", "programming", "space", "nature"
      ];
      const randomTopic = topics[Math.floor(Math.random() * topics.length)];

      let prompt = `Generate a completely random and unique quiz question about ${randomTopic} that has a simple, factual answer.

      Format your response as JSON with this exact structure:
      {
        "question": "The question text (should be open-ended, not multiple choice)",
        "correctAnswer": "The correct answer (keep it simple, 1-3 words)",
        "explanation": "Brief explanation of why this is correct"
      }

      Examples:
      - "What is the capital of France?" -> "Paris"
      - "What cryptocurrency does Ethereum use?" -> "ETH"
      - "What year was Bitcoin created?" -> "2009"

      Make it factual and straightforward. Avoid complex answers.`;

      // Add previous questions to avoid repeats
      if (previousQuestions.length > 0) {
        const recentQuestions = previousQuestions.slice(-10); // Last 10 questions
        prompt += `\n\nIMPORTANT: DO NOT repeat these recent questions:\n${recentQuestions.map(q => `- "${q}"`).join('\n')}`;
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
              content: "You are a creative quiz generator. Always respond with valid JSON in the exact format requested. Generate unique and varied questions."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          max_tokens: OPENAI_MAX_TOKENS,
          temperature: 1.1, // Increased for more creativity
          frequency_penalty: 0.8, // Higher to avoid repetition
          presence_penalty: 0.6, // Higher to encourage new topics
          seed: Math.floor(Math.random() * 1000000) // Random seed for uniqueness
        }),
      });

      console.log("Quiz Bot: OpenAI prompt:", prompt);

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error("No content in OpenAI response");
      }

      console.log("Quiz Bot: OpenAI response content:", content);

      return JSON.parse(content);
    } catch (error) {
      console.error("Quiz Bot: Error generating question:", error);
      // Fallback question
      return {
        question: "What is the native token of NEAR Protocol?",
        correctAnswer: "NEAR",
        explanation: "NEAR is the native cryptocurrency token of NEAR Protocol."
      };
    }
  }

  // Start new quiz
  async startNewQuiz(channelId) {
    console.log(`Quiz Bot: Generating new question for ${channelId}`);
    const question = await this.generateQuestion(channelId);
    console.log(`Quiz Bot: Generated question: "${question.question}" (answer: "${question.correctAnswer}")`);

    const state = this.getChannelQuizState(channelId);

    state.currentQuestion = {
      question: question.question,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      startTime: Date.now(),
      answered: new Set()
    };

    // Add question to history (keep last 30)
    state.questionHistory.push(question.question);
    if (state.questionHistory.length > 30) {
      state.questionHistory = state.questionHistory.slice(-30);
    }

    this.saveQuizState();
    console.log(`Quiz Bot: Saved new question state for ${channelId} (history: ${state.questionHistory.length} questions)`);

    // Send webapp update for new question
    await this.sendWebappUpdate(channelId, 'new_question', {
      currentQuestion: state.currentQuestion,
      leaderboard: state.leaderboard,
      answerHistory: state.answerHistory
    });

    return `🧠 Quiz Question: ${question.question}\n\nType your answer in the chat!`;
  }

  // Check if answer is correct
  checkAnswer(channelId, userAnswer, accountId) {
    const state = this.getChannelQuizState(channelId);
    const currentQ = state.currentQuestion;

    if (!currentQ) {
      return null; // No active question
    }

    // Normalize answer and check if it matches
    const normalizedAnswer = userAnswer.trim().toLowerCase();
    const correctAnswer = currentQ.correctAnswer.toLowerCase();

    const isCorrect = normalizedAnswer === correctAnswer;

    if (isCorrect) {
      // Award point
      if (!state.leaderboard[accountId]) {
        state.leaderboard[accountId] = 0;
      }
      state.leaderboard[accountId]++;
      this.saveQuizState();

      // Set last answer (only keep 1)
      state.answerHistory = [{
        question: currentQ.question,
        answer: currentQ.correctAnswer,
        explanation: currentQ.explanation,
        answeredBy: accountId,
        timestamp: Date.now()
      }];

      // Send webapp update for correct answer
      this.sendWebappUpdate(channelId, 'correct_answer', {
        currentQuestion: state.currentQuestion,
        leaderboard: state.leaderboard,
        answerHistory: state.answerHistory,
        correctAnswer: currentQ.correctAnswer,
        explanation: currentQ.explanation,
        answeredBy: accountId,
        newScore: state.leaderboard[accountId]
      });

      return {
        correct: true,
        explanation: currentQ.explanation,
        newScore: state.leaderboard[accountId],
        shouldStartNew: true // Generate new question immediately after correct answer
      };
    }

    return { correct: false, explanation: currentQ.explanation };
  }

  // Get leaderboard for channel
  getLeaderboard(channelId) {
    const state = this.getChannelQuizState(channelId);
    const sorted = Object.entries(state.leaderboard)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10); // Top 10

    if (sorted.length === 0) {
      return "📊 **Leaderboard**\n\nNo scores yet! Answer questions to begin.";
    }

    const leaderboardText = sorted.map(([accountId, score], index) => {
      const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '  ';
      return `${medal} ${index + 1}. ${accountId}: ${score} point${score === 1 ? '' : 's'}`;
    }).join('\n');

    return `📊 **Leaderboard for ${channelId}**\n\n${leaderboardText}`;
  }

  // Add reaction to a message
  async addReaction(channelId, messageNonce, emoji) {
    try {
      await this.sendMessage('reaction', {
        channelId,
        messageNonce,
        emoji,
        reactionAction: 'add'
      });
      console.log(`Quiz Bot: Added reaction ${emoji} to message ${messageNonce} in ${channelId}`);
    } catch (error) {
      console.error(`Quiz Bot: Error adding reaction:`, error);
    }
  }

  // Handle channel messages
  async onChannelMessage(channelId, message, sender, nonce, action) {
    if (action !== "message" || !message) return;

    const messageText = typeof message === 'string' ? message : message.text;
    if (!messageText) return;

    const trimmed = messageText.trim();
    console.log(`Quiz Bot: Message in ${channelId} from ${sender.accountId}: "${trimmed}"`);

    // Check if we need to start a new quiz (no active question)
    const state = this.getChannelQuizState(channelId);
    if (!state.currentQuestion) {
      console.log(`Quiz Bot: No active question in ${channelId}, creating new one due to user message`);
      const questionText = await this.startNewQuiz(channelId);
      await this.sendChannelMessage(channelId, questionText);
    }

    // Check if it's a quiz answer
    const result = this.checkAnswer(channelId, trimmed, sender.accountId);

    if (result) {
      if (result.correct) {
        console.log(`Quiz Bot: ✅ Correct answer from ${sender.accountId}! New score: ${result.newScore}`);

        // Add thumbs up reaction to correct answer
        await this.addReaction(channelId, nonce, '👍');

        // Send reply message for correct answer
        const responseText = `🎉 Correct, ${sender.accountId}! ${result.explanation}\n\n💯 Your score: ${result.newScore} point${result.newScore === 1 ? '' : 's'}`;
        await this.sendChannelMessage(channelId, responseText, nonce);

        // Generate new question immediately after correct answer
        if (result.shouldStartNew) {
          console.log(`Quiz Bot: Generating new question after correct answer from ${sender.accountId}`);
          setTimeout(async () => {
            const newQuestionText = await this.startNewQuiz(channelId);
            await this.sendChannelMessage(channelId, newQuestionText);
          }, 2000); // 2 second delay
        }
      } else {
        console.log(`Quiz Bot: ❌ Wrong answer from ${sender.accountId}: "${trimmed}" (correct: "${state.currentQuestion.correctAnswer}")`);

        // Add crying reaction for wrong answers
        await this.addReaction(channelId, nonce, '😢');

        // Send temporary message that will be deleted after 5 seconds
        const responseText = `❌ Incorrect, ${sender.accountId}. Try again!`;
        const tempMessagePromise = this.sendChannelMessage(channelId, responseText, nonce);

        // Delete the temporary message after 5 seconds
        tempMessagePromise.then((messageData) => {
          setTimeout(() => {
            this.deleteMessage(channelId, messageData.nonce);
            console.log(`Quiz Bot: Deleted temporary wrong answer message ${messageData.nonce} in ${channelId}`);
          }, 5000);
        });
      }
    } else {
      console.log(`Quiz Bot: Message "${trimmed}" from ${sender.accountId} not processed as quiz answer`);
    }
  }

  // Handle custom message types from server
  handleCustomMessage(message) {
    switch (message.type) {
      case "user_joined":
        this.handleUserJoined(message);
        break;
      case "user_active":
        this.handleUserActive(message);
        break;
      default:
        console.log(`Quiz Bot: Unknown custom message type: ${message.type}`);
    }
  }

  // Handle user joining channel - send initial state
  async handleUserJoined(message) {
    const { channelId, accountId } = message;
    console.log(`Quiz Bot: User ${accountId} joined channel ${channelId}, sending initial state immediately`);

    const state = this.getChannelQuizState(channelId);

    // Send current state immediately (no delay)
    await this.sendWebappUpdate(channelId, "initial_state", {
      currentQuestion: state.currentQuestion,
      leaderboard: state.leaderboard,
      answerHistory: state.answerHistory
    });
    console.log(`Quiz Bot: Sent immediate webapp_update for user ${accountId} in ${channelId}`);

    // If no current question, generate one (same logic as initializeChannel)
    if (!state.currentQuestion) {
      console.log(`Quiz Bot: No active question in ${channelId}, generating new one for user ${accountId}`);

      // Small delay before generating question to avoid race condition with miniapp loading
      setTimeout(async () => {
        const questionText = await this.startNewQuiz(channelId);
        await this.sendChannelMessage(channelId, questionText);
        console.log(`Quiz Bot: Generated and sent new question for ${channelId}`);
      }, 100); // Very short delay just for question generation
    }
  }

  // Handle user becoming active (page refresh/reload) - send current state
  async handleUserActive(message) {
    const { channelId, accountId } = message;
    console.log(`Quiz Bot: User ${accountId} became active in channel ${channelId}, sending current state`);

    const state = this.getChannelQuizState(channelId);

    // Send current state to refresh the miniapp
    await this.sendWebappUpdate(channelId, "initial_state", {
      currentQuestion: state.currentQuestion,
      leaderboard: state.leaderboard,
      answerHistory: state.answerHistory
    });
    console.log(`Quiz Bot: Sent webapp_update for active user ${accountId} in ${channelId}`);
  }

}

// Start the bot
const quizBot = new QuizBot();
await quizBot.connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("Shutting down Quiz Bot...");
  quizBot.saveQuizState();
  if (quizBot.ws) {
    quizBot.ws.close();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down Quiz Bot...");
  quizBot.saveQuizState();
  if (quizBot.ws) {
    quizBot.ws.close();
  }
  process.exit(0);
});