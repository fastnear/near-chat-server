import { fromBase58, toBase58, isString } from "./utils.js";
import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha2";
import { hexToBytes } from "@noble/hashes/utils";

const MIN_ACCOUNT_ID_LEN = 2;
const MAX_ACCOUNT_ID_LEN = 64;
const VALID_ACCOUNT_ID_RE =
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT_ACCOUNT_ID_RE = /^[a-f0-9]{64}$/;
const ED25519_PUBLIC_KEY_LENGTH = 32;
const ED25519_SIGNATURE_LENGTH = 64;
const CACHE_ACCESS_KEY_TTL_MS =
  parseFloat(process.env.CACHE_ACCESS_KEY_TTL_MS) || 60000; // 1 minute
const MAX_FETCH_ACCESS_KEY_ATTEMPTS = 5; // Number of attempts to fetch access key
const FETCH_ACCESS_KEY_INITIAL_RETRY_DELAY_MS = 500;
const FETCH_ACCESS_KEY_MAX_RETRY_DELAY_MS = 5000; // Max delay between retries
const NODE_URL = process.env.NODE_URL || "https://rpc.mainnet.fastnear.com";
const NEAR_FINALITY = "optimistic"; // Finality level for NEAR queries
const SKIP_SIGNATURE_VERIFICATION =
  process.env.SKIP_SIGNATURE_VERIFICATION === "true";

const isValidAccountId = (accountId) =>
  accountId &&
  isString(accountId) &&
  accountId.length >= MIN_ACCOUNT_ID_LEN &&
  accountId.length <= MAX_ACCOUNT_ID_LEN &&
  accountId.match(VALID_ACCOUNT_ID_RE);

const keyFromString = (key) =>
  fromBase58(
    key.includes(":")
      ? (() => {
          const [curve, keyPart] = key.split(":");
          if (curve !== "ed25519") {
            throw new Error(`Unsupported curve: ${curve}`);
          }
          return keyPart;
        })()
      : key,
  );

const keyToString = (key) => `ed25519:${toBase58(key)}`;

/// Assumes the accountId is valid
const isImplicitNearAccount = (accountId) =>
  accountId.match(IMPLICIT_ACCOUNT_ID_RE);

const verifySignature = (publicKey, signature, signedData) => {
  if (!signedData || !isString(signedData)) {
    throw new Error("Invalid signedData");
  }
  if (!publicKey || !isString(publicKey)) {
    throw new Error("Invalid publicKey");
  }
  const parsedPublicKey = keyFromString(publicKey);
  if (parsedPublicKey.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new Error("Invalid public key length");
  }
  if (!ed25519.utils.isValidPublicKey(parsedPublicKey)) {
    throw new Error("Invalid public key");
  }
  const parsedSignature = keyFromString(signature);
  if (parsedSignature.length !== ED25519_SIGNATURE_LENGTH) {
    throw new Error("Invalid signature length");
  }
  const binarySignedData = new TextEncoder().encode(signedData);
  const dataHash = sha256(binarySignedData);
  if (!ed25519.verify(parsedSignature, dataHash, parsedPublicKey)) {
    if (!SKIP_SIGNATURE_VERIFICATION) {
      throw new Error("Invalid signature");
    }
  }
};

// Assumes the account ID is valid and implicit.
const derivePublicKeyFromImplicitAccountId = (accountId) => {
  const binaryPublicKey = hexToBytes(accountId);
  if (binaryPublicKey.length !== ED25519_PUBLIC_KEY_LENGTH) {
    throw new Error("internal error: Invalid derived public key length");
  }
  if (!ed25519.utils.isValidPublicKey(binaryPublicKey)) {
    throw new Error("Invalid derived public key");
  }
  return keyToString(binaryPublicKey);
};

const fetchAccessKey = async (accountId, publicKey) => {
  const response = await fetch(NODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `near-chat-${Date.now()}`,
      method: "query",
      params: {
        request_type: "view_access_key",
        account_id: accountId,
        public_key: publicKey,
        finality: NEAR_FINALITY,
      },
    }),
  });
  const result = await response.json();
  if (result.error) {
    throw new Error(JSON.stringify(result.error));
  }
  return result.result;
};

const fetchAndCacheAccessKey = async (accessKeyCache, accountId, publicKey) => {
  const currentTimestampMs = Date.now();
  const cacheKey = `${accountId}:${publicKey}`;
  const cachedKey = accessKeyCache.get(cacheKey);
  if (
    cachedKey &&
    cachedKey.timestampMs > currentTimestampMs - CACHE_ACCESS_KEY_TTL_MS
  ) {
    return cachedKey;
  }
  let retryDelayMs = FETCH_ACCESS_KEY_INITIAL_RETRY_DELAY_MS;
  for (let attempt = 0; attempt < MAX_FETCH_ACCESS_KEY_ATTEMPTS; attempt++) {
    try {
      const accessKey = await fetchAccessKey(accountId, publicKey);
      if (accessKey) {
        accessKey.timestampMs = currentTimestampMs;
        accessKeyCache.set(cacheKey, accessKey);
        return accessKey;
      }
    } catch (error) {
      console.error(`Failed to fetch access key for ${cacheKey}`, error);
      // Sleep for a short time before retrying
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      retryDelayMs = Math.min(
        retryDelayMs * 2,
        FETCH_ACCESS_KEY_MAX_RETRY_DELAY_MS,
      ); // Exponential backoff
    }
  }
  return null;
};

export {
  isValidAccountId,
  keyToString,
  keyFromString,
  isImplicitNearAccount,
  verifySignature,
  derivePublicKeyFromImplicitAccountId,
  fetchAndCacheAccessKey,
};
