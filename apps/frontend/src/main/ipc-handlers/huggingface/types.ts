/**
 * Hugging Face IPC Handler Types
 */

export interface HuggingFaceAuthStartResult {
  success: boolean;
  message?: string;
}

export interface HuggingFaceModelInfo {
  id: string;
  modelId: string;
  author: string;
  private: boolean;
  gated: boolean | 'auto' | 'manual';
  downloads: number;
  likes: number;
  tags: string[];
  library: string | null;
  pipeline_tag: string | null;
  createdAt: string;
  lastModified: string;
}

export interface HuggingFaceUserInfo {
  username: string;
  fullname?: string;
  avatarUrl?: string;
}
