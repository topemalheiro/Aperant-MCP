/**
 * Linux Platform Module
 *
 * Exports Linux-native window management, CDP prompt sending,
 * and reprompty layout daemon integration.
 */

export {
  getVSCodeWindows,
  findWindow,
  findWindowByTitle,
  findWindowByHandle,
  findWindowByProcessId,
  isWindowValid,
  sendMessageToWindow,
  isClaudeCodeBusy,
  getCdpPort,
  checkCdpForAgent,
  type VSCodeWindow,
  type BackgroundRoute,
  type SendMessageResult
} from './window-manager';

export {
  getWindowAgentStates,
  findWindowAgentState,
  sendViaAgentCdp,
  isCdpAvailable,
  mapAgentLabelToKind,
  mapTargetUrlToAgent,
  groupTargetsByPage,
  findWindowGroupByTitle,
  type AgentKind,
  type CdpTarget,
  type CdpWindowTargetGroup,
  type WindowAgentState
} from './linux-cdp-client';

export {
  isLayoutDaemonRunning,
  sendLayoutCommand,
  applyLayoutSlot,
  getLayoutDaemonSocketPath,
  type LayoutResponse
} from './layout-daemon';
