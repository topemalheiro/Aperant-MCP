# Plan: Add MiniMax M2.5 Highspeed to OpenRouter Model Dropdown

## Problem
- OpenRouter's `/v1/models` API doesn't return MiniMax M2.5 Highspeed
- User wants this model to appear in the dropdown

## Current Behavior
The ModelSearchableSelect component:
1. Fetches models from API using `discoverModels(baseUrl, apiKey)`
2. Stores results in `models` array
3. If error → sets `modelDiscoveryNotSupported = true` → disables dropdown

## Why Previous Implementations Broke Things
- Previous error handling was too aggressive: ANY error set `modelDiscoveryNotSupported = true`
- This disabled the dropdown for ALL presets, not just the failing one

## Solution
**Add additional models ONLY after successful API fetch - no changes to error handling**

### Implementation Plan

1. **Add constant for additional models** (line ~26, after imports):
   ```typescript
   const ADDITIONAL_MODELS: Record<string, ModelInfo[]> = {
     'https://openrouter.ai/api': [
       { id: 'minimax/MiniMax-M2.5-highspeed', display_name: 'MiniMax M2.5 Highspeed' },
     ],
   };
   ```

2. **Modify fetch success handler** (line ~107-108):
   - After `setModels(result)`, add:
   ```typescript
   // Add extra models for specific APIs
   const normalizedUrl = baseUrl.replace(/\/$/, '');
   const extra = ADDITIONAL_MODELS[normalizedUrl];
   if (extra) {
     const existingIds = new Set(result.map(m => m.id));
     const newModels = extra.filter(m => !existingIds.has(m.id));
     setModels([...result, ...newModels]);
   }
   ```

## Why This Won't Break Existing Functionality
- Only runs AFTER successful API fetch (line 107)
- Only adds models for specific baseUrl keys
- No changes to error handling
- Other presets (Anthropic, Groq, etc.) work exactly as before

## Files Affected
- `apps/frontend/src/renderer/components/settings/ModelSearchableSelect.tsx`

## Build Command
```bash
cd apps/frontend && npm run build
```
