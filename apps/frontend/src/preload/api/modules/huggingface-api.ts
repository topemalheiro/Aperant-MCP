/**
 * Hugging Face Integration API
 * Preload API for Hugging Face Hub operations
 */

import { IPC_CHANNELS } from '../../../shared/constants';
import type {
  HuggingFaceModel,
  HuggingFaceAuthResult,
  HuggingFaceSyncStatus,
  IPCResult
} from '../../../shared/types';
import { invokeIpc } from './ipc-utils';

/**
 * Hugging Face Integration API operations
 */
export interface HuggingFaceAPI {
  // CLI & Authentication
  checkHuggingFaceCli: () => Promise<IPCResult<{ installed: boolean; version?: string }>>;
  installHuggingFaceCli: () => Promise<IPCResult<{ command: string }>>;
  checkHuggingFaceAuth: () => Promise<IPCResult<{ authenticated: boolean; username?: string }>>;
  huggingFaceLogin: () => Promise<IPCResult<{ success: boolean; message?: string }>>;
  huggingFaceLoginWithToken: (token: string) => Promise<IPCResult<{ success: boolean }>>;
  getHuggingFaceToken: () => Promise<IPCResult<{ token: string }>>;
  getHuggingFaceUser: () => Promise<IPCResult<{ username: string; fullname?: string }>>;

  // Model operations
  listHuggingFaceModels: () => Promise<IPCResult<{ models: HuggingFaceModel[] }>>;
  detectHuggingFaceRepo: (projectPath: string) => Promise<IPCResult<{ repoId: string; repoType: string }>>;
  createHuggingFaceRepo: (
    repoName: string,
    options: { private?: boolean; projectPath: string }
  ) => Promise<IPCResult<{ repoId: string; url: string }>>;
  getHuggingFaceBranches: (repoId: string) => Promise<IPCResult<string[]>>;
  checkHuggingFaceConnection: (repoId: string) => Promise<IPCResult<HuggingFaceSyncStatus>>;
}

/**
 * Creates the Hugging Face Integration API implementation
 */
export const createHuggingFaceAPI = (): HuggingFaceAPI => ({
  // CLI & Authentication
  checkHuggingFaceCli: (): Promise<IPCResult<{ installed: boolean; version?: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_CHECK_CLI),

  installHuggingFaceCli: (): Promise<IPCResult<{ command: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_INSTALL_CLI),

  checkHuggingFaceAuth: (): Promise<IPCResult<{ authenticated: boolean; username?: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_CHECK_AUTH),

  huggingFaceLogin: (): Promise<IPCResult<{ success: boolean; message?: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_LOGIN),

  huggingFaceLoginWithToken: (token: string): Promise<IPCResult<{ success: boolean }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_LOGIN_WITH_TOKEN, token),

  getHuggingFaceToken: (): Promise<IPCResult<{ token: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_GET_TOKEN),

  getHuggingFaceUser: (): Promise<IPCResult<{ username: string; fullname?: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_GET_USER),

  // Model operations
  listHuggingFaceModels: (): Promise<IPCResult<{ models: HuggingFaceModel[] }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_LIST_MODELS),

  detectHuggingFaceRepo: (projectPath: string): Promise<IPCResult<{ repoId: string; repoType: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_DETECT_REPO, projectPath),

  createHuggingFaceRepo: (
    repoName: string,
    options: { private?: boolean; projectPath: string }
  ): Promise<IPCResult<{ repoId: string; url: string }>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_CREATE_REPO, repoName, options),

  getHuggingFaceBranches: (repoId: string): Promise<IPCResult<string[]>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_GET_BRANCHES, repoId),

  checkHuggingFaceConnection: (repoId: string): Promise<IPCResult<HuggingFaceSyncStatus>> =>
    invokeIpc(IPC_CHANNELS.HUGGINGFACE_CHECK_CONNECTION, repoId)
});
