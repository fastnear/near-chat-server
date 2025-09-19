import { saveJson, loadJson, isString } from '../../shared/utils.js';
import fs from 'fs';
import path from 'path';

describe('Utils', () => {
  const testFile = 'test-utils.json';

  afterEach(() => {
    // Clean up test files
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  describe('isString', () => {
    test('should return true for strings', () => {
      expect(isString('hello')).toBe(true);
      expect(isString('')).toBe(true);
      expect(isString('123')).toBe(true);
    });

    test('should return false for non-strings', () => {
      expect(isString(123)).toBe(false);
      expect(isString(null)).toBe(false);
      expect(isString(undefined)).toBe(false);
      expect(isString({})).toBe(false);
      expect(isString([])).toBe(false);
      expect(isString(true)).toBe(false);
    });
  });

  describe('saveJson', () => {
    test('should save JSON data to file', () => {
      const testData = { name: 'test', value: 42 };

      saveJson(testData, testFile);

      expect(fs.existsSync(testFile)).toBe(true);
      const fileContent = fs.readFileSync(testFile, 'utf8');
      expect(JSON.parse(fileContent)).toEqual(testData);
    });

    test('should handle complex nested objects', () => {
      const testData = {
        users: ['alice', 'bob'],
        config: {
          port: 7071,
          enabled: true,
          nested: {
            value: 'test'
          }
        }
      };

      saveJson(testData, testFile);

      const fileContent = fs.readFileSync(testFile, 'utf8');
      expect(JSON.parse(fileContent)).toEqual(testData);
    });

    test('should create directory if it does not exist', () => {
      const dirPath = 'test-dir';
      const filePath = path.join(dirPath, 'test.json');
      const testData = { test: true };

      saveJson(testData, filePath);

      expect(fs.existsSync(filePath)).toBe(true);

      // Cleanup
      fs.unlinkSync(filePath);
      fs.rmdirSync(dirPath);
    });
  });

  describe('loadJson', () => {
    test('should load JSON data from file', () => {
      const testData = { name: 'test', value: 42 };
      fs.writeFileSync(testFile, JSON.stringify(testData));

      const loadedData = loadJson(testFile);

      expect(loadedData).toEqual(testData);
    });
  });
});