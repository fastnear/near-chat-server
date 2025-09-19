import { isValidAccountId } from "../shared/near.js";

const NODE_URL = process.env.NODE_URL || "https://rpc.mainnet.near.org";

const fetchNearRpc = async (method, params) => {
  const response = await fetch(NODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "dontcare",
      method,
      params,
    }),
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`NEAR RPC error: ${data.error.message}`);
  }
  return data.result;
};

const checkNearBalance = async (accountId, minBalance) => {
  try {
    if (!isValidAccountId(accountId)) {
      return false;
    }
    
    const account = await fetchNearRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    
    const balanceYocto = BigInt(account.amount);
    const balanceNear = Number(balanceYocto) / 1e24;
    
    return balanceNear >= minBalance;
  } catch (error) {
    console.log(`Error checking NEAR balance for ${accountId}:`, error.message);
    return false;
  }
};

const checkFtBalance = async (accountId, contractId, minBalance) => {
  try {
    if (!isValidAccountId(accountId) || !isValidAccountId(contractId)) {
      return false;
    }
    
    const result = await fetchNearRpc("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: "ft_balance_of",
      args_base64: Buffer.from(JSON.stringify({ account_id: accountId })).toString('base64'),
    });
    
    const balanceStr = Buffer.from(result.result).toString();
    const balance = JSON.parse(balanceStr);
    
    return parseInt(balance) >= minBalance;
  } catch (error) {
    console.log(`Error checking FT balance for ${accountId} on ${contractId}:`, error.message);
    return false;
  }
};

const checkContractInteraction = async (accountId, minContracts) => {
  try {
    if (!isValidAccountId(accountId)) {
      return false;
    }
    
    const result = await fetchNearRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });
    
    const hasContract = result.code_hash && result.code_hash !== "11111111111111111111111111111111";
    return hasContract && minContracts <= 1;
  } catch (error) {
    console.log(`Error checking contract interaction for ${accountId}:`, error.message);
    return false;
  }
};

const checkWhitelist = async (accountId, accounts) => {
  return accounts.includes(accountId);
};

export const evaluateRule = async (accountId, rule) => {
  switch (rule.type) {
    case "allowAll":
      return true;
    
    case "whitelist":
      return await checkWhitelist(accountId, rule.accounts);

    case "near_balance":
      return await checkNearBalance(accountId, rule.min);

    case "ft_balance":
      return await checkFtBalance(accountId, rule.contract, rule.min);

    case "has_contract_on_account":
      return await checkContractInteraction(accountId, rule.min_contracts);

    default:
      console.log(`Unknown rule type: ${rule.type}`);
      return false;
  }
};

export const evaluateAllRules = async (accountId, rules) => {
  if (!rules || rules.length === 0) {
    return true;
  }
  
  for (const rule of rules) {
    const result = await evaluateRule(accountId, rule);
    if (!result) {
      return false;
    }
  }
  
  return true;
};