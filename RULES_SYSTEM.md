# Система правил доступа к каналам

## Обзор

Новая система правил поддерживает сложные логические операции с операторами сравнения, сохраняя обратную совместимость с существующим форматом.

## Структура правил

### Простые правила (legacy формат)
```json
{
  "rules": [
    { "type": "near_balance", "min": 1000 },
    { "type": "ft_balance", "contract": "token.near", "min": 100 }
  ]
}
```
*Работает как AND - все правила должны выполняться*

### Логические группы (новый формат)
```json
{
  "rules": {
    "type": "logic",
    "operator": "and",
    "conditions": [...]
  }
}
```

## Типы условий

### 1. Логические операторы
- `and` - все условия должны выполняться
- `or` - хотя бы одно условие должно выполняться
- `not` - инвертирует результат условия

### 2. Операторы сравнения
- `gte` (>=) - больше или равно
- `lte` (<=) - меньше или равно
- `gt` (>) - больше
- `lt` (<) - меньше
- `eq` (==) - равно
- `ne` (!=) - не равно

### 3. Типы правил

#### Баланс NEAR
```json
{
  "type": "near_balance",
  "operator": "gte",
  "value": "1000000000000000000000000000"
}
```
⚠️ **Важно**: `value` должно быть строкой в yoctoNEAR (1 NEAR = 10²⁴ yoctoNEAR)

#### Баланс FT токенов
```json
{
  "type": "ft_balance",
  "contract": "token.near",
  "operator": "gt",
  "value": "100000000000000000000"
}
```
⚠️ **Важно**: `value` должно быть строкой в минимальных единицах токена с учетом decimals

#### Владение NFT
```json
{
  "type": "nft_owned",
  "contract": "nft.near"
}
```

#### Whitelist/Blacklist
```json
{
  "type": "whitelist",
  "accounts": ["user1.near", "user2.near"]
}
```

#### Наличие контракта
```json
{
  "type": "has_contract_on_account",
  "operator": "gte",
  "value": "1"
}
```

#### Разрешить всем
```json
{
  "type": "allowAll"
}
```

## Примеры использования

### Пример 1: (100+ токенов А ИЛИ 200+ NEAR) И NFT А
```json
{
  "rules": {
    "type": "logic",
    "operator": "and",
    "conditions": [
      {
        "type": "logic",
        "operator": "or",
        "conditions": [
          {
            "type": "ft_balance",
            "contract": "token_a.near",
            "operator": "gte",
            "value": "100000000000000000000"
          },
          {
            "type": "near_balance",
            "operator": "gte",
            "value": "200000000000000000000000000"
          }
        ]
      },
      {
        "type": "nft_owned",
        "contract": "nft_a.near"
      }
    ]
  }
}
```

### Пример 2: Больше 1 токена А, но меньше 100 токенов Б
```json
{
  "rules": {
    "type": "logic",
    "operator": "and",
    "conditions": [
      {
        "type": "ft_balance",
        "contract": "token_a.near",
        "operator": "gt",
        "value": "1000000000000000000"
      },
      {
        "type": "ft_balance",
        "contract": "token_b.near",
        "operator": "lt",
        "value": "100000000000000000000"
      }
    ]
  }
}
```

### Пример 3: НЕ в черном списке
```json
{
  "rules": {
    "type": "not",
    "condition": {
      "type": "whitelist",
      "accounts": ["banned1.near", "banned2.near"]
    }
  }
}
```

### Пример 4: Сложные правила с отладкой
```json
{
  "name": "Complex Channel",
  "debug": true,
  "rules": {
    "type": "logic",
    "operator": "and",
    "conditions": [
      {
        "type": "logic",
        "operator": "or",
        "conditions": [
          {
            "type": "ft_balance",
            "contract": "jambo-1679.meme-cooking.near",
            "operator": "gte",
            "value": "100000000000000000000"
          },
          {
            "type": "near_balance",
            "operator": "gte",
            "value": "200000000000000000000000000"
          }
        ]
      },
      {
        "type": "not",
        "condition": {
          "type": "whitelist",
          "accounts": ["banned1.near", "banned2.near"]
        }
      }
    ]
  }
}
```

## Обратная совместимость

Старый формат массива правил продолжает работать:
```json
{
  "rules": [
    { "type": "near_balance", "min": 1000 }
  ]
}
```

Автоматически конвертируется в:
```json
{
  "rules": {
    "type": "logic",
    "operator": "and",
    "conditions": [
      { "type": "near_balance", "operator": "gte", "value": "1000000000000000000000000000" }
    ]
  }
}
```

## Debug режим

Для отладки правил добавьте в конфигурацию канала:
```json
{
  "debug": true
}
```

### Пример debug вывода:
```
🚀 Starting rule evaluation for user: test.near
══════════════════════════════════════════════════════════
🔍 Evaluating condition: {...}
🔗 Logic operator: AND (3 conditions)
  📋 AND condition 1/3:
    🔗 Logic operator: OR (2 conditions)
      📋 OR condition 1/2:
        🪙 FT balance check for test.near on jambo-1679.meme-cooking.near: 50000000000000000000 gte 100000000000000000000 = false
      📋 OR condition 2/2:
        💰 NEAR balance check for test.near: 205 NEAR (205000000000000000000000000 yocto) gte 200 NEAR (200000000000000000000000000 yocto) = true
    ✅ OR: Found true condition, returning true
  ✅ Condition result: true
  📋 AND condition 2/3:
    👥 whitelist check for test.near in [banned1.near, banned2.near]: false
    ❗ NOT operator: false -> true
  ✅ Condition result: true
  📋 AND condition 3/3:
    💰 NEAR balance check for test.near: 205 NEAR (205000000000000000000000000 yocto) gte 100 NEAR (100000000000000000000000000 yocto) = true
  ✅ Condition result: true
✅ AND: All conditions true, returning true
✅ Condition result: true
══════════════════════════════════════════════════════════
🎉 Final result for test.near: true
```

## Важные замечания

### Точность чисел
- Все балансы сравниваются как BigInt для предотвращения ошибок округления
- Значения в конфигурации должны быть строками для больших чисел
- NEAR: используйте yoctoNEAR (1 NEAR = "1000000000000000000000000000")
- FT токены: используйте минимальные единицы с учетом decimals

### Производительность
- Правила выполняются последовательно
- OR условия прерываются при первом true
- AND условия прерываются при первом false
- Кэширование результатов RPC запросов не реализовано

### Безопасность
- Все RPC запросы используют finality: "final"
- Некорректные account_id автоматически отклоняются
- Ошибки сети возвращают false (отказ в доступе)

## Конвертация значений

### NEAR (24 decimals)
- 1 NEAR = "1000000000000000000000000000"
- 0.1 NEAR = "100000000000000000000000000"
- 1000 NEAR = "1000000000000000000000000000000"

### JAMBO (18 decimals)
- 1 JAMBO = "1000000000000000000"
- 100 JAMBO = "100000000000000000000"
- 0.5 JAMBO = "500000000000000000"

### Калькулятор
Для конвертации используйте формулу:
```
raw_value = human_readable_value * (10 ^ decimals)
```

Пример для 100 JAMBO (18 decimals):
```
"100000000000000000000" = 100 * (10^18)
```