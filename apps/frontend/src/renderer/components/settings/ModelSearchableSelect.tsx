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
 * Additional models to include for specific APIs that don't return all available models.
 * OpenRouter doesn't return MiniMax M2.5 Highspeed in their /v1/models response.
 * MiniMax API may not support model listing, so we provide known models.
 * Kimi (Moonshot) API is OpenAI-compatible; provide known model IDs.
 */
const ADDITIONAL_MODELS: Record<string, ModelInfo[]> = {
  'https://api.minimax.io/anthropic': [
    { id: 'MiniMax-M2.1-highspeed', display_name: 'MiniMax M2.1 Highspeed' },
    { id: 'MiniMax-M2.5', display_name: 'MiniMax M2.5' },
    { id: 'MiniMax-M2.5-highspeed', display_name: 'MiniMax M2.5 Highspeed' },
    { id: 'MiniMax-M2.7-highspeed', display_name: 'MiniMax M2.7 Highspeed' },
  ],
  'https://api.moonshot.cn/v1': [
    { id: 'kimi-k2-5', display_name: 'Kimi K2.5' },
    { id: 'kimi-k2-6', display_name: 'Kimi K2.6' },
    { id: 'kimi-k2-7', display_name: 'Kimi K2.7' },
  ],
};

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
   * Fetch models from API.
   * Uses store's discoverModels action which has built-in caching.
   */
  const fetchModels = async () => {
    console.log('[ModelSearchableSelect] fetchModels called with:', { baseUrl, apiKey: `${apiKey.slice(-4)}` });
    // Fetch from API
    setIsLoading(true);
    setError(null);
    setModelDiscoveryNotSupported(false);
    abortControllerRef.current = new AbortController();

    try {
      const result = await discoverModels(baseUrl, apiKey, abortControllerRef.current.signal);
      console.log('[ModelSearchableSelect] discoverModels result:', result);

      if (result && Array.isArray(result)) {
        setModels(result);
        // Add extra models for specific APIs (e.g., MiniMax M2.5 Highspeed for OpenRouter)
        const normalizedUrl = baseUrl.replace(/\/$/, '');
        const extra = ADDITIONAL_MODELS[normalizedUrl];
        if (extra) {
          const existingIds = new Set(result.map(m => m.id));
          const newModels = extra.filter(m => !existingIds.has(m.id));
          if (newModels.length > 0) {
            setModels([...result, ...newModels]);
          }
        }
      } else {
        // No result - treat as not supported
        setModelDiscoveryNotSupported(true);
        setIsOpen(false);
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        // Check if there are hardcoded models for this API - show them even if discovery fails
        const normalizedUrl = baseUrl.replace(/\/$/, '');
        const extra = ADDITIONAL_MODELS[normalizedUrl];
        
        if (extra && extra.length > 0) {
          // We have hardcoded models for this API - use them
          console.log('[ModelSearchableSelect] Using hardcoded models for:', normalizedUrl);
          setModels(extra);
          setIsOpen(true);
        } else {
          // No hardcoded models - fall back to manual input
          if (err.message.includes('does not support model listing') ||
              err.message.includes('not_supported')) {
            setModelDiscoveryNotSupported(true);
          } else {
            // For other errors, also treat as "not supported" for better UX
            // User can still type manually
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
      {error && models.length === 0 && (
        <p className="text-sm text-destructive mt-1">{error}</p>
      )}
    </div>
  );
}
