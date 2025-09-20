import { isValidAccountId } from "../shared/near.js";

const fetchNearRpc = async (method, params) => {
  const NODE_URL = process.env.NODE_URL || "https://rpc.mainnet.near.org";
  console.log(`Fetching NEAR RPC: ${NODE_URL}`);
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

// Legacy functions kept for backward compatibility - now work with raw values
const checkNearBalance = async (accountId, minBalance) => {
  const balance = await getNearBalance(accountId);
  if (balance === null) return false;

  // Convert minBalance to yoctoNEAR if it's a number (legacy support)
  const minBalanceYocto = typeof minBalance === 'number' ?
    (BigInt(Math.floor(minBalance)) * BigInt("1000000000000000000000000")).toString() :
    minBalance.toString();

  return applyOperator(balance, "gte", minBalanceYocto);
};

const checkFtBalance = async (accountId, contractId, minBalance) => {
  const balance = await getFtBalance(accountId, contractId);
  if (balance === null) return false;

  return applyOperator(balance, "gte", minBalance.toString());
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

const checkNftOwnership = async (accountId, contractId) => {
  try {
    if (!isValidAccountId(accountId) || !isValidAccountId(contractId)) {
      return false;
    }

    const result = await fetchNearRpc("query", {
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: "nft_tokens_for_owner",
      args_base64: Buffer.from(JSON.stringify({ account_id: accountId, limit: 1 })).toString('base64'),
    });

    const tokensStr = Buffer.from(result.result).toString();
    const tokens = JSON.parse(tokensStr);

    return Array.isArray(tokens) && tokens.length > 0;
  } catch (error) {
    console.log(`Error checking NFT ownership for ${accountId} on ${contractId}:`, error.message);
    return false;
  }
};

const applyOperator = (value, operator, target) => {
  // Convert to BigInt for precise comparison
  let valueBigInt, targetBigInt;

  try {
    valueBigInt = typeof value === 'string' ? BigInt(value) : BigInt(value.toString());
    targetBigInt = typeof target === 'string' ? BigInt(target) : BigInt(target.toString());
  } catch (error) {
    console.log(`Error converting to BigInt: value=${value}, target=${target}`, error.message);
    return false;
  }

  switch (operator) {
    case "gte":
    case ">=":
      return valueBigInt >= targetBigInt;
    case "lte":
    case "<=":
      return valueBigInt <= targetBigInt;
    case "gt":
    case ">":
      return valueBigInt > targetBigInt;
    case "lt":
    case "<":
      return valueBigInt < targetBigInt;
    case "eq":
    case "==":
      return valueBigInt === targetBigInt;
    case "ne":
    case "!=":
      return valueBigInt !== targetBigInt;
    default:
      return valueBigInt >= targetBigInt; // default behavior for backward compatibility
  }
};

const checkWhitelist = async (accountId, accounts) => {
  return accounts.includes(accountId);
};

export const evaluateCondition = async (accountId, condition, debug = false, depth = 0) => {
  const indent = '  '.repeat(depth);

  if (debug) {
    console.log(`${indent}🔍 Evaluating condition:`, JSON.stringify(condition, null, 2).split('\n').map((line, i) => i === 0 ? line : `${indent}${line}`).join('\n'));
  }
  let result;

  switch (condition.type) {
    case "logic":
      result = await evaluateLogicCondition(accountId, condition, debug, depth + 1);
      break;

    case "not":
      const subResult = await evaluateCondition(accountId, condition.condition, debug, depth + 1);
      result = !subResult;
      if (debug) {
        console.log(`${indent}  ❗ NOT operator: ${subResult} -> ${result}`);
      }
      break;

    case "allowAll":
      result = true;
      if (debug) {
        console.log(`${indent}  ✅ allowAll: true`);
      }
      break;

    case "whitelist":
      result = await checkWhitelist(accountId, condition.accounts);
      if (debug) {
        console.log(`${indent}  👥 whitelist check for ${accountId} in [${condition.accounts.join(', ')}]: ${result}`);
      }
      break;

    case "near_balance":
      const nearBalance = await getNearBalance(accountId);
      if (nearBalance === null) {
        result = false;
        if (debug) {
          console.log(`${indent}  💰 NEAR balance check for ${accountId}: failed to fetch balance`);
        }
      } else {
        const nearValue = condition.value !== undefined ? condition.value.toString() : (condition.min || "0").toString();
        const nearOperator = condition.operator || "gte";
        result = applyOperator(nearBalance, nearOperator, nearValue);
        if (debug) {
          const nearBalanceFormatted = (BigInt(nearBalance) / BigInt("1000000000000000000000000")).toString();
          const nearValueFormatted = (BigInt(nearValue) / BigInt("1000000000000000000000000")).toString();
          console.log(`${indent}  💰 NEAR balance check for ${accountId}: ${nearBalanceFormatted} NEAR (${nearBalance} yocto) ${nearOperator} ${nearValueFormatted} NEAR (${nearValue} yocto) = ${result}`);
        }
      }
      break;

    case "ft_balance":
      const ftBalance = await getFtBalance(accountId, condition.contract);
      if (ftBalance === null) {
        result = false;
        if (debug) {
          console.log(`${indent}  🪙 FT balance check for ${accountId} on ${condition.contract}: failed to fetch balance`);
        }
      } else {
        const ftValue = condition.value !== undefined ? condition.value.toString() : (condition.min || "0").toString();
        const ftOperator = condition.operator || "gte";
        result = applyOperator(ftBalance, ftOperator, ftValue);
        if (debug) {
          console.log(`${indent}  🪙 FT balance check for ${accountId} on ${condition.contract}: ${ftBalance} ${ftOperator} ${ftValue} = ${result}`);
        }
      }
      break;

    case "nft_owned":
      result = await checkNftOwnership(accountId, condition.contract);
      if (debug) {
        console.log(`${indent}  🖼️ NFT ownership check for ${accountId} on ${condition.contract}: ${result}`);
      }
      break;

    case "has_contract_on_account":
      const hasContract = await getContractCount(accountId);
      if (hasContract === null) {
        result = false;
        if (debug) {
          console.log(`${indent}  📄 Contract check for ${accountId}: failed to fetch contract info`);
        }
      } else {
        // Handle both boolean and legacy string/number values
        const contractValue = condition.value !== undefined ? condition.value : (condition.min_contracts || 1);

        if (typeof contractValue === 'boolean') {
          // Simple boolean check
          result = hasContract === contractValue;
          if (debug) {
            console.log(`${indent}  📄 Contract check for ${accountId}: has_contract=${hasContract} === ${contractValue} = ${result}`);
          }
        } else {
          // Legacy numeric comparison
          const contractOperator = condition.operator || "gte";
          const contractCount = hasContract ? "1" : "0";
          result = applyOperator(contractCount, contractOperator, contractValue.toString());
          if (debug) {
            console.log(`${indent}  📄 Contract check for ${accountId}: ${contractCount} ${contractOperator} ${contractValue} = ${result}`);
          }
        }
      }
      break;

    default:
      console.log(`${indent}❌ Unknown condition type: ${condition.type}`);
      result = false;
  }

  if (debug) {
    const emoji = result ? '✅' : '❌';
    console.log(`${indent}${emoji} Condition result: ${result}`);
  }

  return result;
};

const evaluateLogicCondition = async (accountId, condition, debug = false, depth = 0) => {
  const indent = '  '.repeat(depth);
  if (!condition.conditions || !Array.isArray(condition.conditions)) {
    if (debug) {
      console.log(`${indent}❌ Invalid logic condition: missing or invalid conditions array`);
    }
    return false;
  }

  if (debug) {
    console.log(`${indent}🔗 Logic operator: ${condition.operator.toUpperCase()} (${condition.conditions.length} conditions)`);
  }

  if (condition.operator === "or") {
    for (let i = 0; i < condition.conditions.length; i++) {
      const subCondition = condition.conditions[i];
      if (debug) {
        console.log(`${indent}  📋 OR condition ${i + 1}/${condition.conditions.length}:`);
      }
      const result = await evaluateCondition(accountId, subCondition, debug, depth + 1);
      if (result) {
        if (debug) {
          console.log(`${indent}  ✅ OR: Found true condition, returning true`);
        }
        return true;
      }
    }
    if (debug) {
      console.log(`${indent}  ❌ OR: All conditions false, returning false`);
    }
    return false;
  } else {
    // default to "and"
    for (let i = 0; i < condition.conditions.length; i++) {
      const subCondition = condition.conditions[i];
      if (debug) {
        console.log(`${indent}  📋 AND condition ${i + 1}/${condition.conditions.length}:`);
      }
      const result = await evaluateCondition(accountId, subCondition, debug, depth + 1);
      if (!result) {
        if (debug) {
          console.log(`${indent}  ❌ AND: Found false condition, returning false`);
        }
        return false;
      }
    }
    if (debug) {
      console.log(`${indent}  ✅ AND: All conditions true, returning true`);
    }
    return true;
  }
};

// Helper functions to extract raw values for comparison
const getNearBalance = async (accountId) => {
  try {
    if (!isValidAccountId(accountId)) {
      return null;
    }

    const account = await fetchNearRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });

    // Return raw yoctoNEAR as string to preserve precision
    return account.amount;
  } catch (error) {
    console.log(`Error checking NEAR balance for ${accountId}:`, error.message);
    return null;
  }
};

const getFtBalance = async (accountId, contractId) => {
  try {
    if (!isValidAccountId(accountId) || !isValidAccountId(contractId)) {
      return null;
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

    // Return raw balance as string to preserve precision
    return balance;
  } catch (error) {
    console.log(`Error checking FT balance for ${accountId} on ${contractId}:`, error.message);
    return null;
  }
};

const getContractCount = async (accountId) => {
  try {
    if (!isValidAccountId(accountId)) {
      return null;
    }

    const result = await fetchNearRpc("query", {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    });

    const hasContract = result.code_hash && result.code_hash !== "11111111111111111111111111111111";
    return hasContract; // Return boolean
  } catch (error) {
    console.log(`Error checking contract interaction for ${accountId}:`, error.message);
    return null;
  }
};

// Legacy function for backward compatibility
export const evaluateRule = async (accountId, rule, debug = false) => {
  return await evaluateCondition(accountId, rule, debug);
};

export const evaluateAllRules = async (accountId, rules, debug = false) => {
  if (debug) {
    console.log(`\n🚀 Starting rule evaluation for user: ${accountId}`);
    console.log('═'.repeat(60));
  }
  if (!rules) {
    return true;
  }

  // Handle new logic format
  if (typeof rules === 'object' && !Array.isArray(rules)) {
    const result = await evaluateCondition(accountId, rules, debug, 0);
    if (debug) {
      console.log('═'.repeat(60));
      const emoji = result ? '🎉' : '🚫';
      console.log(`${emoji} Final result for ${accountId}: ${result}\n`);
    }
    return result;
  }

  // Handle legacy array format - convert to new format
  if (Array.isArray(rules)) {
    if (rules.length === 0) {
      return true;
    }

    // Convert legacy rules to new format
    const convertedRules = {
      type: "logic",
      operator: "and",
      conditions: rules.map(rule => {
        const converted = { ...rule };

        // Convert legacy min property to value/operator format
        if (converted.min !== undefined) {
          converted.value = converted.min;
          converted.operator = "gte";
          delete converted.min;
        }

        if (converted.min_contracts !== undefined) {
          converted.value = converted.min_contracts;
          converted.operator = "gte";
          delete converted.min_contracts;
        }

        return converted;
      })
    };

    const result = await evaluateCondition(accountId, convertedRules, debug, 0);
    if (debug) {
      console.log('═'.repeat(60));
      const emoji = result ? '🎉' : '🚫';
      console.log(`${emoji} Final result for ${accountId}: ${result} (converted from legacy format)\n`);
    }
    return result;
  }

  return true;
};