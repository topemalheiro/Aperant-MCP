/**
 * @vitest-environment jsdom
 */
/**
 * Tests for ModelSearchableSelect component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../shared/i18n';
import { ModelSearchableSelect } from './ModelSearchableSelect';
import { useSettingsStore } from '../../stores/settings-store';

// Mock the settings store
vi.mock('../../stores/settings-store');

describe('ModelSearchableSelect', () => {
  const mockDiscoverModels = vi.fn();
  const mockOnChange = vi.fn();


  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useSettingsStore).mockImplementation((selector?: (state: any) => any): any => {
      const state = { discoverModels: mockDiscoverModels };
      return selector ? selector(state) : state;
    });
  });

  it('should render input with placeholder', () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
        placeholder="Select a model"
      />
    );

    expect(screen.getByPlaceholderText('Select a model')).toBeInTheDocument();
  });

  it('should render with initial value', () => {
    render(
      <ModelSearchableSelect
        value="claude-sonnet-4-5-20250929"
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByDisplayValue('claude-sonnet-4-5-20250929');
    expect(input).toBeInTheDocument();
  });

  it('should fetch models when dropdown opens', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    // Click to open dropdown
    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(mockDiscoverModels).toHaveBeenCalledWith(
        'https://api.anthropic.com',
        'sk-test-key-12chars',
        expect.any(AbortSignal)
      );
    });
  });

  it('should display loading state while fetching', async () => {
    mockDiscoverModels.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Component shows a Loader2 spinner with animate-spin class
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });
  });

  it('should display fetched models in dropdown', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
      expect(screen.getByText('claude-sonnet-4-5-20250929')).toBeInTheDocument();
    });
  });

  it('should render dropdown above the input', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByTestId('model-select-dropdown')).toBeInTheDocument();
    });

    const dropdown = screen.getByTestId('model-select-dropdown');
    expect(dropdown).toHaveClass('bottom-full');
  });

  it('should select model and close dropdown', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      const modelButton = screen.getByText('Claude Sonnet 4.5');
      fireEvent.click(modelButton);
    });

    expect(mockOnChange).toHaveBeenCalledWith('claude-sonnet-4-5-20250929');
  });

  it('should allow manual text input', async () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.change(input, { target: { value: 'custom-model-name' } });

    expect(mockOnChange).toHaveBeenCalledWith('custom-model-name');
  });

  it('should filter models based on search query', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' },
      { id: 'claude-3-opus-20240229', display_name: 'Claude Opus 3' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    // Wait for models to load
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Type search query
    const searchInput = screen.getByPlaceholderText('Search models...');
    fireEvent.change(searchInput, { target: { value: 'haiku' } });

    // Should only show Haiku
    await waitFor(() => {
      expect(screen.getByText('Claude Haiku 4.5')).toBeInTheDocument();
      expect(screen.queryByText('Claude Sonnet 4.5')).not.toBeInTheDocument();
      expect(screen.queryByText('Claude Opus 3')).not.toBeInTheDocument();
    });
  });

  it('should show fallback mode on fetch failure', async () => {
    mockDiscoverModels.mockRejectedValue(
      new Error('This API endpoint does not support model listing')
    );

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://custom-api.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Component falls back to manual input mode with info message
      expect(screen.getByText(/Model discovery not available/)).toBeInTheDocument();
    });
  });

  it('should use preset models when discovery returns empty', async () => {
    mockDiscoverModels.mockResolvedValue([]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Preset Anthropic models should still appear
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });
  });

  it('should show no results message when search does not match', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Search for non-existent model
    const searchInput = screen.getByPlaceholderText('Search models...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    await waitFor(() => {
      expect(screen.getByText('No models match your search')).toBeInTheDocument();
    });
  });

  it('should be disabled when disabled prop is true', () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
        disabled={true}
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    expect(input).toBeDisabled();
  });

  it('should highlight selected model', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value="claude-sonnet-4-5-20250929"
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByDisplayValue('claude-sonnet-4-5-20250929');
    fireEvent.focus(input);

    await waitFor(() => {
      // Selected model should have Check icon indicator (via background color)
      const sonnetButton = screen.getByText('Claude Sonnet 4.5').closest('button');
      expect(sonnetButton).toHaveClass('bg-accent');
    });
  });

  it('should close dropdown when clicking outside', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <div>
        <ModelSearchableSelect
          value=""
          onChange={mockOnChange}
          baseUrl="https://api.anthropic.com"
          apiKey="sk-test-key-12chars"
        />
        <div data-testid="outside-element">Outside</div>
      </div>
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Click outside
    fireEvent.mouseDown(screen.getByTestId('outside-element'));

    await waitFor(() => {
      expect(screen.queryByText('Claude Sonnet 4.5')).not.toBeInTheDocument();
    });
  });

  it('should clear stale models when baseUrl changes', async () => {
    mockDiscoverModels
      .mockResolvedValueOnce([
        { id: 'MiniMax-M2.5-highspeed', display_name: 'MiniMax M2.5 Highspeed' }
      ])
      .mockResolvedValueOnce([
        { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
      ]);

    const { rerender } = render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.minimax.io/anthropic"
        apiKey="sk-test-key-12chars"
      />
    );

    // Open dropdown for MiniMax
    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('MiniMax M2.5 Highspeed')).toBeInTheDocument();
    });

    // Switch to Anthropic baseUrl
    rerender(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    // Old MiniMax model should no longer be rendered, even before the new fetch completes
    await waitFor(() => {
      expect(screen.queryByText('MiniMax M2.5 Highspeed')).not.toBeInTheDocument();
    });

    // Focus again to trigger fetch for the new provider
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
      expect(mockDiscoverModels).toHaveBeenLastCalledWith(
        'https://api.anthropic.com',
        'sk-test-key-12chars',
        expect.any(AbortSignal)
      );
    });
  });

  it('should not inject hardcoded MiniMax into OpenRouter results', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'openai/gpt-4o', display_name: 'GPT-4o' },
      { id: 'anthropic/claude-3.5-sonnet', display_name: 'Claude 3.5 Sonnet' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://openrouter.ai/api"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('GPT-4o')).toBeInTheDocument();
    });

    expect(screen.queryByText('MiniMax M2.5 Highspeed')).not.toBeInTheDocument();
    expect(screen.queryByText('minimax/MiniMax-M2.5-highspeed')).not.toBeInTheDocument();
  });

  it('should retry discovery on open after a previous failure', async () => {
    mockDiscoverModels
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([
        { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
      ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');

    // First open fails but preset fallback models are still shown
    fireEvent.focus(input);
    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });

    // Second open retries and succeeds
    fireEvent.blur(input);
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
    });
  });

  it('should merge discovered models with preset models', async () => {
    mockDiscoverModels.mockResolvedValue([
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' }
    ]);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
      // Preset model not returned by discovery should also appear
      expect(screen.getByText('Claude Opus 4.5')).toBeInTheDocument();
    });
  });

  it('should show preset models when discovery fails for a known preset', async () => {
    const authError = new Error('Authentication failed. Please check your API key.');
    (authError as Error & { errorType?: string }).errorType = 'auth';
    mockDiscoverModels.mockRejectedValue(authError);

    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.groq.com/openai/v1"
        apiKey="sk-test-key-12chars"
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      // Preset Groq models appear despite discovery failure
      expect(screen.getByText('Llama 3.3 70B Versatile')).toBeInTheDocument();
      // Auth error is surfaced to the user
      expect(screen.getByText(/Could not authenticate/)).toBeInTheDocument();
    });
  });

  it('should show preset models immediately when apiKey is empty', async () => {
    render(
      <ModelSearchableSelect
        value=""
        onChange={mockOnChange}
        baseUrl="https://api.anthropic.com"
        apiKey=""
      />
    );

    const input = screen.getByPlaceholderText('Select a model or type manually');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument();
      expect(screen.getByText('Claude Opus 4.5')).toBeInTheDocument();
    });

    // Backend should not be called when no key is entered
    expect(mockDiscoverModels).not.toHaveBeenCalled();
  });
});
