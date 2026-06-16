/**
 * ModelSearchableSelect - Searchable dropdown for API model selection
 *
 * A custom dropdown component that:
 * - Fetches available models from the API when opened
 * - Displays loading state during fetch
 * - Allows search/filter within dropdown
 * - Falls back to manual text input if API doesn't support model listing
 * - Cancels pending requests when closed
 *
 * Features:
 * - Lazy loading: fetches models on first open, not on mount
 * - Search filtering: type to filter model list
 * - Error handling: shows error with fallback to manual input
 * - Per-credential caching: reuses fetched models for same (baseUrl, apiKey)
 * - Request cancellation: aborts pending fetch when closed
 */
import { useState, useEffect, useRef } from 'react';
import { Loader2, ChevronDown, Search, Check, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../stores/settings-store';
import type { ModelInfo } from '@shared/types/profile';

/**
 * Known models for each API provider preset.
 *
 * These are used as a fallback when live discovery fails or as supplementary
 * entries when discovery succeeds but omits popular models. Keeping them per
 * preset guarantees the dropdown is never empty because of provider quirks.
 */
const PRESET_MODELS: Record<string, ModelInfo[]> = {
  'https://api.anthropic.com': [
    { id: 'claude-opus-4-5-20251101', display_name: 'Claude Opus 4.5' },
    { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
    { id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' },
    { id: 'claude-3-sonnet-20240229', display_name: 'Claude 3 Sonnet' },
    { id: 'claude-3-haiku-20240307', display_name: 'Claude 3 Haiku' }
  ],
  'https://openrouter.ai/api': [
    { id: 'openai/gpt-4o', display_name: 'OpenAI GPT-4o' },
    { id: 'openai/gpt-4o-mini', display_name: 'OpenAI GPT-4o Mini' },
    { id: 'anthropic/claude-3.5-sonnet', display_name: 'Anthropic Claude 3.5 Sonnet' },
    { id: 'anthropic/claude-3-opus', display_name: 'Anthropic Claude 3 Opus' },
    { id: 'google/gemini-1.5-pro-latest', display_name: 'Google Gemini 1.5 Pro' },
    { id: 'meta-llama/llama-3.3-70b-instruct', display_name: 'Meta Llama 3.3 70B' }
  ],
  'https://api.groq.com/openai/v1': [
    { id: 'llama-3.3-70b-versatile', display_name: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-8b-instant', display_name: 'Llama 3.1 8B Instant' },
    { id: 'mixtral-8x7b-32768', display_name: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it', display_name: 'Gemma 2 9B IT' }
  ],
  'https://api.z.ai/api/anthropic': [
    { id: 'glm-4.5', display_name: 'GLM 4.5' },
    { id: 'glm-4.5-flash', display_name: 'GLM 4.5 Flash' },
    { id: 'glm-4.1', display_name: 'GLM 4.1' },
    { id: 'glm-4.1-flash', display_name: 'GLM 4.1 Flash' },
    { id: 'glm-4', display_name: 'GLM 4' },
    { id: 'glm-4-air', display_name: 'GLM 4 Air' },
    { id: 'glm-4-airx', display_name: 'GLM 4 AirX' },
    { id: 'glm-4-flash', display_name: 'GLM 4 Flash' }
  ],
  'https://open.bigmodel.cn/api/anthropic': [
    { id: 'glm-4.5', display_name: 'GLM 4.5' },
    { id: 'glm-4.5-flash', display_name: 'GLM 4.5 Flash' },
    { id: 'glm-4.1', display_name: 'GLM 4.1' },
    { id: 'glm-4.1-flash', display_name: 'GLM 4.1 Flash' },
    { id: 'glm-4', display_name: 'GLM 4' },
    { id: 'glm-4-air', display_name: 'GLM 4 Air' },
    { id: 'glm-4-airx', display_name: 'GLM 4 AirX' },
    { id: 'glm-4-flash', display_name: 'GLM 4 Flash' }
  ],
  'https://api.minimax.io/anthropic': [
    { id: 'MiniMax-M2.1-highspeed', display_name: 'MiniMax M2.1 Highspeed' },
    { id: 'MiniMax-M2.5', display_name: 'MiniMax M2.5' },
    { id: 'MiniMax-M2.5-highspeed', display_name: 'MiniMax M2.5 Highspeed' },
    { id: 'MiniMax-M2.7-highspeed', display_name: 'MiniMax M2.7 Highspeed' }
  ],
  'https://api.moonshot.cn/v1': [
    { id: 'kimi-k2-5', display_name: 'Kimi K2.5' },
    { id: 'kimi-k2-6', display_name: 'Kimi K2.6' },
    { id: 'kimi-k2-7', display_name: 'Kimi K2.7' }
  ]
};

function getPresetModels(baseUrl: string): ModelInfo[] | undefined {
  const normalizedUrl = baseUrl.replace(/\/+$/, '');
  return PRESET_MODELS[normalizedUrl];
}

interface ModelSearchableSelectProps {
  /** Currently selected model ID */
  value: string;
  /** Callback when model is selected */
  onChange: (modelId: string) => void;
  /** Placeholder text when no model selected */
  placeholder?: string;
  /** Base URL for API (used for caching key) */
  baseUrl: string;
  /** API key for authentication (used for caching key) */
  apiKey: string;
  /** Disabled state */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * ModelSearchableSelect Component
 *
 * @example
 * ```tsx
 * <ModelSearchableSelect
 *   value="claude-sonnet-4-5-20250929"
 *   onChange={(modelId) => setModel(modelId)}
 *   baseUrl="https://api.anthropic.com"
 *   apiKey="sk-ant-..."
 *   placeholder="Select a model"
 * />
 * ```
 */
export function ModelSearchableSelect({
  value,
  onChange,
  placeholder,
  baseUrl,
  apiKey,
  disabled = false,
  className
}: ModelSearchableSelectProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('settings:modelSelect.placeholder');
  const discoverModels = useSettingsStore((state) => state.discoverModels);
  // Dropdown open state
  const [isOpen, setIsOpen] = useState(false);

  // Model discovery state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelDiscoveryNotSupported, setModelDiscoveryNotSupported] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Manual input mode (when API doesn't support model listing)
  const [_isManualInput, setIsManualInput] = useState(false);

  // AbortController for cancelling fetch requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Container ref for click-outside detection
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Merge discovered models with known preset models, deduplicated by id.
   */
  const mergeWithPresetModels = (discovered: ModelInfo[], url: string): ModelInfo[] => {
    const preset = getPresetModels(url);
    if (!preset || preset.length === 0) {
      return discovered;
    }
    const existingIds = new Set(discovered.map(m => m.id));
    const additions = preset.filter(m => !existingIds.has(m.id));
    return additions.length > 0 ? [...discovered, ...additions] : discovered;
  };

  /**
   * Fetch models from API.
   * Uses store's discoverModels action which has built-in caching.
   * Falls back to known preset models when discovery fails.
   */
  const fetchModels = async () => {
    console.log('[ModelSearchableSelect] fetchModels called with:', { baseUrl, apiKey: `${apiKey.slice(-4)}` });
    setIsLoading(true);
    setError(null);
    setModelDiscoveryNotSupported(false);

    // No API key yet — skip the backend call and show preset models immediately
    // so users can browse a provider's models before typing a key.
    if (!apiKey.trim()) {
      const preset = getPresetModels(baseUrl);
      if (preset && preset.length > 0) {
        console.log('[ModelSearchableSelect] No API key, using preset models for:', baseUrl);
        setModels(preset);
      } else {
        setModelDiscoveryNotSupported(true);
        setIsOpen(false);
      }
      setIsLoading(false);
      return;
    }

    abortControllerRef.current = new AbortController();

    try {
      const result = await discoverModels(baseUrl, apiKey, abortControllerRef.current.signal);
      console.log('[ModelSearchableSelect] discoverModels result:', result);

      if (result && Array.isArray(result)) {
        // Merge with preset models so popular/known models always appear
        const merged = mergeWithPresetModels(result, baseUrl);
        setModels(merged);
      } else {
        // No result from backend - try preset fallbacks
        const preset = getPresetModels(baseUrl);
        if (preset && preset.length > 0) {
          console.log('[ModelSearchableSelect] Discovery returned no models, using preset fallbacks for:', baseUrl);
          setModels(preset);
        } else {
          setModelDiscoveryNotSupported(true);
          setIsOpen(false);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        // We always have preset models for supported presets, so show them
        // and surface a short warning instead of locking the user into manual input.
        const preset = getPresetModels(baseUrl);
        if (preset && preset.length > 0) {
          console.log('[ModelSearchableSelect] Discovery failed, using preset fallbacks for:', baseUrl, err.message);
          setModels(preset);
          const errorType = (err as Error & { errorType?: string }).errorType;
          if (errorType === 'auth') {
            setError(t('settings:modelSelect.authError'));
          } else if (errorType === 'network') {
            setError(t('settings:modelSelect.networkError'));
          } else if (errorType === 'timeout') {
            setError(t('settings:modelSelect.timeoutError'));
          }
        } else {
          // No preset fallback - manual input mode
          if (err.message.includes('does not support model listing') ||
              err.message.includes('not_supported') ||
              (err as Error & { errorType?: string }).errorType === 'not_supported') {
            setModelDiscoveryNotSupported(true);
          } else {
            setModelDiscoveryNotSupported(true);
            console.warn('[ModelSearchableSelect] Model discovery failed:', err.message);
          }
          setIsOpen(false);
        }
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  /**
   * Handle dropdown open.
   * Triggers model fetch on first open.
   * Retries discovery on every open so transient failures or populated caches
   * from sibling fields are used instead of permanently locking into manual mode.
   */
  const handleOpen = () => {
    if (disabled) return;

    // If we already have models, just open the dropdown
    if (models.length > 0) {
      setIsOpen(true);
      setSearchQuery('');
      return;
    }

    // Open dropdown and attempt to fetch models. The store cache may already
    // contain results from another field, or a previous transient failure may
    // now succeed.
    setIsOpen(true);
    setSearchQuery('');
    setIsManualInput(false);

    if (!isLoading && !error) {
      fetchModels();
    }
  };

  /**
   * Handle dropdown close.
   * Cancels any pending fetch requests.
   */
  const handleClose = () => {
    setIsOpen(false);
    // Cancel pending fetch
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  };

  /**
   * Handle model selection from dropdown.
   */
  const handleSelectModel = (modelId: string) => {
    onChange(modelId);
    handleClose();
  };

  /**
   * Handle manual input change.
   */
  const handleManualInputChange = (inputValue: string) => {
    onChange(inputValue);
    setSearchQuery(inputValue);
  };

  /**
   * Filter models based on search query.
   */
  const filteredModels = models.filter(model =>
    model.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.display_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Click-outside detection for closing dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, handleClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Reset model list when baseUrl or apiKey changes so switching presets
  // doesn't leave stale models (e.g., MiniMax models showing for Anthropic).
  // biome-ignore lint/correctness/useExhaustiveDependencies: baseUrl/apiKey are props and intentional dependencies
  useEffect(() => {
    // Abort any in-flight discovery request for the previous provider
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    // Close the dropdown and wipe all discovery state
    setIsOpen(false);
    setModels([]);
    setSearchQuery('');
    setError(null);
    setModelDiscoveryNotSupported(false);
    setIsManualInput(false);
  }, [baseUrl, apiKey]);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Main input with loading/dropdown indicator */}
      <div className="relative">
        <Input
          value={value || ''}
          onChange={(e) => {
            handleManualInputChange(e.target.value);
          }}
          onFocus={() => {
            // Always attempt to open; handleOpen will retry discovery if needed
            handleOpen();
          }}
          placeholder={
            // Show manual placeholder only when we have confirmed discovery is
            // unsupported and have no models to display.
            modelDiscoveryNotSupported && models.length === 0
              ? t('settings:modelSelect.placeholderManual')
              : resolvedPlaceholder
          }
          disabled={disabled}
          className="pr-10"
        />
        {/* Right side indicator: loading spinner, dropdown arrow, or nothing for manual mode */}
        <div className="absolute right-0 top-0 h-full flex items-center px-3">
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={isOpen ? handleClose : handleOpen}
              disabled={disabled}
              className="h-6 w-6 p-0 hover:bg-accent"
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
            </Button>
          )}
        </div>
      </div>

      {/* Dropdown panel - only show when we have models to display */}
      {isOpen && !isLoading && models.length > 0 && (
        <div
          className="absolute z-50 w-full bottom-full mb-1 bg-background border rounded-md shadow-lg max-h-60 overflow-hidden flex flex-col"
          data-testid="model-select-dropdown"
        >
          {/* Search input */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('settings:modelSelect.searchPlaceholder')}
                className="pl-8"
                autoFocus
              />
            </div>
          </div>

          {/* Model list */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredModels.length === 0 ? (
              <div className="p-3 text-center text-sm text-muted-foreground">
                {t('settings:modelSelect.noResults')}
              </div>
            ) : (
              filteredModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelectModel(model.id)}
                  className={cn(
                    'w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-start gap-2',
                    value === model.id && 'bg-accent'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{model.display_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{model.id}</div>
                  </div>
                  {value === model.id && (
                    <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Info/error messages below input */}
      {modelDiscoveryNotSupported && models.length === 0 && (
        <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
          <Info className="h-3 w-3" />
          {t('settings:modelSelect.discoveryNotAvailable')}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive mt-1">{error}</p>
      )}
    </div>
  );
}
