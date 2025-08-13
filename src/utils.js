import {
  binary_to_base58 as toBase58,
  base58_to_binary as fromBase58,
} from "base58-js";

import fs from "fs";

function saveJson(json, filename) {
  try {
    const data = JSON.stringify(json);
    fs.writeFileSync(filename, data);
  } catch (e) {
    console.error("Failed to save JSON:", filename, e);
  }
}

function loadJson(filename, ignore) {
  try {
    let rawData = fs.readFileSync(filename);
    return JSON.parse(rawData);
  } catch (e) {
    if (!ignore) {
      console.error("Failed to load JSON:", filename, e);
    }
  }
  return null;
}

function isString(value) {
  return typeof value === "string";
}

export { isString, saveJson, loadJson, toBase58, fromBase58 };
