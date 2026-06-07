/**
 * Unit tests for Hugging Face utility functions
 * Tests validation, URL parsing, and security functions
 */
import { describe, it, expect } from 'vitest';

// Regex pattern to validate HF repo ID format (username/repo-name)
const HF_REPO_ID_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * Validate Hugging Face repo ID format (username/repo-name)
 */
function isValidHuggingFaceRepoId(repoId: string): boolean {
  return HF_REPO_ID_PATTERN.test(repoId);
}

/**
 * Parse Hugging Face URL to extract repo ID
 */
function parseHuggingFaceUrl(url: string): { repoId: string; repoType: 'model' | 'dataset' | 'space' } | null {
  // HTTPS format
  const httpsMatch = url.match(/https?:\/\/huggingface\.co\/(?:(datasets|spaces)\/)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (httpsMatch) {
    const typePrefix = httpsMatch[1];
    const repoId = httpsMatch[2].replace(/\.git$/, '');
    let repoType: 'model' | 'dataset' | 'space' = 'model';
    if (typePrefix === 'datasets') repoType = 'dataset';
    if (typePrefix === 'spaces') repoType = 'space';
    return { repoId, repoType };
  }

  // SSH format (git@hf.co:username/repo)
  const sshMatch = url.match(/git@hf\.co:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (sshMatch) {
    const repoId = sshMatch[1].replace(/\.git$/, '');
    return { repoId, repoType: 'model' };
  }

  return null;
}

/**
 * Redact sensitive information from data before logging
 */
function redactSensitiveData(data: unknown): unknown {
  if (typeof data === 'string') {
    // Redact anything that looks like a HF token (hf_*)
    return data.replace(/hf_[A-Za-z0-9]+/g, 'hf_[REDACTED]');
  }
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) {
      return data.map(redactSensitiveData);
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (/token|password|secret|credential|auth/i.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactSensitiveData(value);
      }
    }
    return result;
  }
  return data;
}

describe('Hugging Face Utils', () => {
  describe('isValidHuggingFaceRepoId', () => {
    it('should accept valid username/repo format', () => {
      expect(isValidHuggingFaceRepoId('meta-llama/Llama-2-7b')).toBe(true);
      expect(isValidHuggingFaceRepoId('openai/whisper-large')).toBe(true);
      expect(isValidHuggingFaceRepoId('microsoft/phi-2')).toBe(true);
    });

    it('should accept repo IDs with dots and underscores', () => {
      expect(isValidHuggingFaceRepoId('user.name/model_name')).toBe(true);
      expect(isValidHuggingFaceRepoId('my_user/my.model')).toBe(true);
      expect(isValidHuggingFaceRepoId('org-name/model-v1.0')).toBe(true);
    });

    it('should accept repo IDs with hyphens', () => {
      expect(isValidHuggingFaceRepoId('meta-llama/Meta-Llama-3-8B')).toBe(true);
      expect(isValidHuggingFaceRepoId('stability-ai/stable-diffusion-xl')).toBe(true);
    });

    it('should reject repo IDs without a slash', () => {
      expect(isValidHuggingFaceRepoId('modelname')).toBe(false);
      expect(isValidHuggingFaceRepoId('username')).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidHuggingFaceRepoId('')).toBe(false);
    });

    it('should reject repo IDs with special characters', () => {
      expect(isValidHuggingFaceRepoId('user/model@v1')).toBe(false);
      expect(isValidHuggingFaceRepoId('user/model#1')).toBe(false);
      expect(isValidHuggingFaceRepoId('user/model$test')).toBe(false);
      expect(isValidHuggingFaceRepoId('user/model name')).toBe(false);
    });

    it('should reject repo IDs with multiple slashes', () => {
      expect(isValidHuggingFaceRepoId('org/team/model')).toBe(false);
      expect(isValidHuggingFaceRepoId('a/b/c')).toBe(false);
    });

    it('should reject repo IDs with empty segments', () => {
      expect(isValidHuggingFaceRepoId('/model')).toBe(false);
      expect(isValidHuggingFaceRepoId('user/')).toBe(false);
      expect(isValidHuggingFaceRepoId('/')).toBe(false);
    });
  });

  describe('parseHuggingFaceUrl', () => {
    describe('HTTPS URLs', () => {
      it('should parse model URLs', () => {
        const result = parseHuggingFaceUrl('https://huggingface.co/meta-llama/Llama-2-7b');
        expect(result).toEqual({ repoId: 'meta-llama/Llama-2-7b', repoType: 'model' });
      });

      it('should parse model URLs with .git suffix', () => {
        const result = parseHuggingFaceUrl('https://huggingface.co/openai/whisper.git');
        expect(result).toEqual({ repoId: 'openai/whisper', repoType: 'model' });
      });

      it('should parse dataset URLs', () => {
        const result = parseHuggingFaceUrl('https://huggingface.co/datasets/squad/squad');
        expect(result).toEqual({ repoId: 'squad/squad', repoType: 'dataset' });
      });

      it('should parse space URLs', () => {
        const result = parseHuggingFaceUrl('https://huggingface.co/spaces/gradio/chatbot');
        expect(result).toEqual({ repoId: 'gradio/chatbot', repoType: 'space' });
      });

      it('should handle HTTP URLs', () => {
        const result = parseHuggingFaceUrl('http://huggingface.co/user/model');
        expect(result).toEqual({ repoId: 'user/model', repoType: 'model' });
      });
    });

    describe('SSH URLs', () => {
      it('should parse SSH URLs', () => {
        const result = parseHuggingFaceUrl('git@hf.co:meta-llama/Llama-2-7b');
        expect(result).toEqual({ repoId: 'meta-llama/Llama-2-7b', repoType: 'model' });
      });

      it('should parse SSH URLs with .git suffix', () => {
        const result = parseHuggingFaceUrl('git@hf.co:openai/whisper.git');
        expect(result).toEqual({ repoId: 'openai/whisper', repoType: 'model' });
      });
    });

    describe('Invalid URLs', () => {
      it('should return null for non-HuggingFace URLs', () => {
        expect(parseHuggingFaceUrl('https://github.com/user/repo')).toBe(null);
        expect(parseHuggingFaceUrl('https://gitlab.com/user/repo')).toBe(null);
      });

      it('should return null for empty strings', () => {
        expect(parseHuggingFaceUrl('')).toBe(null);
      });

      it('should return null for invalid formats', () => {
        expect(parseHuggingFaceUrl('huggingface.co/user/model')).toBe(null);
        expect(parseHuggingFaceUrl('not-a-url')).toBe(null);
      });

      it('should return null for HF URLs without repo', () => {
        expect(parseHuggingFaceUrl('https://huggingface.co/')).toBe(null);
        expect(parseHuggingFaceUrl('https://huggingface.co/settings')).toBe(null);
      });
    });
  });

  describe('redactSensitiveData', () => {
    it('should redact Hugging Face tokens in strings', () => {
      const data = 'Token is hf_abc123XYZdef456';
      const result = redactSensitiveData(data);
      expect(result).toBe('Token is hf_[REDACTED]');
      expect(result).not.toContain('abc123');
    });

    it('should redact multiple tokens in a string', () => {
      const data = 'First: hf_token1, Second: hf_token2';
      const result = redactSensitiveData(data);
      expect(result).toBe('First: hf_[REDACTED], Second: hf_[REDACTED]');
    });

    it('should redact sensitive keys in objects', () => {
      const data = {
        username: 'testuser',
        token: 'secret123',
        password: 'pass456',
        auth: 'bearer xyz',
        credential: 'cred789',
      };

      const result = redactSensitiveData(data) as Record<string, unknown>;

      expect(result.username).toBe('testuser');
      expect(result.token).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.auth).toBe('[REDACTED]');
      expect(result.credential).toBe('[REDACTED]');
    });

    it('should redact nested sensitive data', () => {
      const data = {
        user: {
          name: 'test',
          authToken: 'secret',
        },
        config: {
          secretValue: 'key123',
        },
      };

      const result = redactSensitiveData(data) as Record<string, Record<string, unknown>>;

      expect(result.user.name).toBe('test');
      expect(result.user.authToken).toBe('[REDACTED]');
      expect(result.config.secretValue).toBe('[REDACTED]');
    });

    it('should redact tokens in arrays', () => {
      const data = ['hf_secret123', 'normal text'];
      const result = redactSensitiveData(data) as string[];

      expect(result[0]).toBe('hf_[REDACTED]');
      expect(result[1]).toBe('normal text');
    });

    it('should preserve non-sensitive values', () => {
      expect(redactSensitiveData('normal text')).toBe('normal text');
      expect(redactSensitiveData(123)).toBe(123);
      expect(redactSensitiveData(null)).toBe(null);
      expect(redactSensitiveData(undefined)).toBe(undefined);
      expect(redactSensitiveData(true)).toBe(true);
    });

    it('should handle complex nested structures', () => {
      const data = {
        models: [
          { id: 'model1', accessToken: 'token1' },
          { id: 'model2', accessToken: 'token2' },
        ],
        meta: {
          secretKey: 'key123',
          count: 2,
        },
      };

      const result = redactSensitiveData(data) as {
        models: Array<{ id: string; accessToken: string }>;
        meta: { secretKey: string; count: number };
      };

      expect(result.models[0].id).toBe('model1');
      expect(result.models[0].accessToken).toBe('[REDACTED]');
      expect(result.models[1].accessToken).toBe('[REDACTED]');
      expect(result.meta.secretKey).toBe('[REDACTED]');
      expect(result.meta.count).toBe(2);
    });
  });
});
