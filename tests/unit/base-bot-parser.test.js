import { BaseBot } from '../../shared/base-bot.js';

describe('BaseBot parseAIResponse', () => {
  let bot;

  beforeEach(() => {
    // Create a minimal bot instance for testing
    bot = new BaseBot('test-bot', 'test.near', 'fake-private-key', 'ws://test');
  });

  describe('Valid JSON parsing', () => {
    test('should parse clean JSON object', () => {
      const response = '{"message": "hello", "value": 42}';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello",
        value: 42
      });
    });

    test('should parse JSON with whitespace', () => {
      const response = '  {"message": "hello"}  ';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello"
      });
    });
  });

  describe('Markdown JSON extraction', () => {
    test('should extract JSON from markdown code blocks', () => {
      const response = '```json\n{"message": "hello", "value": 42}\n```';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello",
        value: 42
      });
    });

    test('should extract JSON from markdown with extra whitespace', () => {
      const response = '```json   \n  {"message": "hello"}  \n  ```';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello"
      });
    });

    test('should extract from markdown without json label', () => {
      const response = '```\n{"message": "hello"}\n```';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello"
      });
    });

    test('should handle json prefix in markdown', () => {
      const response = '```\njson{"message": "hello"}\n```';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello"
      });
    });
  });

  describe('JSON extraction from mixed content', () => {
    test('should extract JSON from text with surrounding content', () => {
      const response = 'Here is the response: {"message": "hello"} and some more text';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello"
      });
    });

    test('should handle JSON with trailing semicolon', () => {
      const response = '{"message": "hello"};';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello"
      });
    });

    test('should handle json prefix before object', () => {
      const response = 'json{"message": "hello", "value": 42}';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello",
        value: 42
      });
    });

    test('should remove newlines from extracted JSON', () => {
      const response = `{
        "message": "hello",
        "value": 42
      }`;
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: "hello",
        value: 42
      });
    });
  });

  describe('Complex scenarios', () => {
    test('should handle DnD bot scenario with markdown JSON', () => {
      const response = `\`\`\`json
{
  "story": "As the Rogue, @mobeor.near, attempts to 'super pawn' the Barbarian, you quickly realize this involves selling him to a Guild of Mercenaries.",
  "updatedPlayers": {
    "mobeor.near": {
      "class": "Rogue",
      "hp": 10,
      "maxHp": 10,
      "gold": 150,
      "alive": true,
      "equipment": ["Twin Daggers", "Lockpicks", "Dark Cloak"],
      "joinedAt": 1758905612333
    }
  }
}
\`\`\``;

      const result = bot.parseAIResponse(response);

      expect(result).toHaveProperty('story');
      expect(result).toHaveProperty('updatedPlayers');
      expect(result.updatedPlayers['mobeor.near']).toEqual({
        class: "Rogue",
        hp: 10,
        maxHp: 10,
        gold: 150,
        alive: true,
        equipment: ["Twin Daggers", "Lockpicks", "Dark Cloak"],
        joinedAt: 1758905612333
      });
    });
  });

  describe('Error handling', () => {
    test('should return error object for invalid JSON', () => {
      const response = 'This is not JSON at all';
      const result = bot.parseAIResponse(response);

      expect(result).toHaveProperty('error');
      expect(result.error).toBe('Failed to parse AI response as JSON');
      expect(result).toHaveProperty('raw_response');
      expect(result.raw_response).toBe('This is not JSON at all');
    });

    test('should return error for malformed JSON in markdown', () => {
      const response = '```json\n{invalid json}\n```';
      const result = bot.parseAIResponse(response);

      expect(result).toHaveProperty('error');
      expect(result.raw_response).toBe('{invalid json}');
    });

    test('should handle empty response', () => {
      const response = '';
      const result = bot.parseAIResponse(response);

      expect(result).toHaveProperty('error');
      expect(result.raw_response).toBe('');
    });

    test('should handle null/undefined response', () => {
      const result1 = bot.parseAIResponse(null);
      const result2 = bot.parseAIResponse(undefined);

      expect(result1).toHaveProperty('error');
      expect(result2).toHaveProperty('error');
    });
  });

  describe('Edge cases', () => {
    test('should handle nested JSON objects', () => {
      const response = '{"outer": {"inner": {"value": 42}}}';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        outer: {
          inner: {
            value: 42
          }
        }
      });
    });

    test('should handle arrays in JSON', () => {
      const response = '{"items": ["sword", "shield"], "count": 2}';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        items: ["sword", "shield"],
        count: 2
      });
    });

    test('should handle escaped quotes in JSON', () => {
      const response = '{"message": "He said \\"hello\\" to me"}';
      const result = bot.parseAIResponse(response);

      expect(result).toEqual({
        message: 'He said "hello" to me'
      });
    });
  });
});