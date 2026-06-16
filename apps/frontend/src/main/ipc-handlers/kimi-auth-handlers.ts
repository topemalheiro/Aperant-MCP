import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import {
  clearKimiAuth,
  getKimiAuthState,
  startKimiOAuthFlow,
} from '../kimi-auth/kimi-oauth';

export function registerKimiAuthHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.KIMI_AUTH_LOGIN, async (_event, accountId: string) => {
    try {
      const result = await startKimiOAuthFlow(accountId);
      return {
        success: true,
        data: {
          isAuthenticated: true,
          expiresAt: result.expiresAt,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.KIMI_AUTH_STATUS, async (_event, accountId: string) => {
    try {
      return {
        success: true,
        data: await getKimiAuthState(accountId),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.KIMI_AUTH_LOGOUT, async (_event, accountId: string) => {
    try {
      await clearKimiAuth(accountId);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });
}
