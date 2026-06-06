/**
 * Linux CDP (Chrome DevTools Protocol) Client
 *
 * Sends prompts to VS Code: AI extensions via CDP/WebSocket.
 * Uses Node.js built-in WebSocket (Node 24+) and http module.
 * Ported from Reprompty's CDP client, adapted for Aperant-MCP.
 */

import { get } from 'http';

export type AgentKind = 'claude-code' | 'codex' | 'kilo-code' | 'kimi-code' | 'unknown';

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface CdpWindowTargetGroup {
  page: CdpTarget;
  iframes: CdpTarget[];
}

export interface WindowAgentState {
  pageTitle: string;
  activeAgent: AgentKind;
  availableAgents: AgentKind[];
}

interface ViewSwitcherProbe {
  activeLabel: string | null;
  labels: string[];
}

interface SendViaAgentOptions {
  agent: Exclude<AgentKind, 'unknown'>;
  windowTitle?: string;
}

function normalizeText(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function uniqueAgents(agents: AgentKind[]): AgentKind[] {
  return Array.from(
    new Set(agents.filter((agent): agent is Exclude<AgentKind, 'unknown'> => agent !== 'unknown'))
  );
}

function stripEditorSuffix(title: string): string {
  return title
    .replace(/\s+-\s+Visual Studio Code.*$/i, '')
    .replace(/\s+-\s+Kilo Code.*$/i, '')
    .replace(/\s+-\s+Kimi Code.*$/i, '')
    .replace(/\s+-\s+VSCodium.*$/i, '')
    .replace(/\s+-\s+Code:\s+-\s+OSS.*$/i, '')
    .trim();
}

function windowTitleScore(candidateTitle: string, windowTitle: string): number {
  const normalizedCandidate = normalizeText(candidateTitle);
  const normalizedWindow = normalizeText(windowTitle);
  if (!normalizedCandidate || !normalizedWindow) {
    return -1;
  }
  if (normalizedCandidate === normalizedWindow) {
    return 100;
  }

  const strippedCandidate = normalizeText(stripEditorSuffix(candidateTitle));
  const strippedWindow = normalizeText(stripEditorSuffix(windowTitle));
  if (strippedCandidate && strippedCandidate === strippedWindow) {
    return 90;
  }
  if (normalizedWindow.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedWindow)) {
    return 80;
  }
  if (
    strippedWindow &&
    strippedCandidate &&
    (strippedWindow.includes(strippedCandidate) || strippedCandidate.includes(strippedWindow))
  ) {
    return 70;
  }

  return -1;
}

export function mapAgentLabelToKind(label?: string | null): AgentKind {
  const normalized = normalizeText(label);
  if (normalized === 'claude code') {
    return 'claude-code';
  }
  if (normalized === 'codex') {
    return 'codex';
  }
  if (normalized === 'kilo code') {
    return 'kilo-code';
  }
  if (normalized === 'kimi code') {
    return 'kimi-code';
  }
  return 'unknown';
}

export function mapTargetUrlToAgent(url?: string | null): AgentKind {
  const normalized = normalizeText(url);
  if (!normalized) {
    return 'unknown';
  }
  if (normalized.includes('extensionid=anthropic.claude-code')) {
    return 'claude-code';
  }
  if (normalized.includes('extensionid=openai.chatgpt')) {
    return 'codex';
  }
  if (normalized.includes('extensionid=kilocode.kilo-code')) {
    return 'kilo-code';
  }
  if (
    normalized.includes('extensionid=kimicode.kimi-code') ||
    normalized.includes('extensionid=moonshot-ai.kimi-code')
  ) {
    return 'kimi-code';
  }
  return 'unknown';
}

export function groupTargetsByPage(targets: CdpTarget[]): CdpWindowTargetGroup[] {
  const groups: CdpWindowTargetGroup[] = [];
  let currentGroup: CdpWindowTargetGroup | null = null;

  for (const target of targets) {
    if (target.type === 'page') {
      currentGroup = { page: target, iframes: [] };
      groups.push(currentGroup);
      continue;
    }

    if (target.type === 'iframe' && currentGroup) {
      currentGroup.iframes.push(target);
    }
  }

  return groups;
}

export function findWindowGroupByTitle(
  groups: CdpWindowTargetGroup[],
  windowTitle?: string
): CdpWindowTargetGroup | null {
  if (groups.length === 0) {
    return null;
  }
  if (!windowTitle) {
    return groups.length === 1 ? groups[0] : null;
  }

  let bestGroup: CdpWindowTargetGroup | null = null;
  let bestScore = -1;
  let tied = false;

  for (const group of groups) {
    const score = windowTitleScore(group.page.title, windowTitle);
    if (score > bestScore) {
      bestGroup = group;
      bestScore = score;
      tied = false;
      continue;
    }
    if (score >= 0 && score === bestScore) {
      tied = true;
    }
  }

  if (bestScore < 0 || tied) {
    return null;
  }

  return bestGroup;
}

function findAgentIframeTarget(
  group: CdpWindowTargetGroup,
  agent: Exclude<AgentKind, 'unknown'>
): CdpTarget | null {
  const exact = group.iframes.find((target) => mapTargetUrlToAgent(target.url) === agent);
  if (exact) return exact;
  // Fallback: if only one iframe exists, assume it's the active agent's webview
  if (group.iframes.length === 1) return group.iframes[0];
  return null;
}

async function getCdpTargets(port: number): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    const req = get(`http://127.0.0.1:${port}/json`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const targets = Array.isArray(parsed) ? parsed : [];
          resolve(
            targets.filter(
              (target): target is CdpTarget =>
                Boolean(target?.type && target?.webSocketDebuggerUrl)
            )
          );
        } catch {
          reject(new Error('Failed to parse CDP targets'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('CDP targets request timed out'));
    });
  });
}

function cdpEvaluate(
  ws: WebSocket,
  expression: string,
  id: number
): Promise<{ result?: { result?: { value?: unknown; type?: string } } }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      ws.removeEventListener('message', handler);
      reject(new Error('CDP evaluate timed out'));
    }, 8000);

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg);
          }
        }
      } catch {
        // Ignore unrelated messages
      }
    };

    ws.addEventListener('message', handler);
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      })
    );
  });
}

function getEvaluationValue(message: {
  result?: { result?: { value?: unknown; type?: string } };
}): unknown {
  return message?.result?.result?.value;
}

async function withTargetSocket<T>(target: CdpTarget, callback: (ws: WebSocket) => Promise<T>): Promise<T> {
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 3000);
      ws.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      ws.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection error'));
      });
    });

    return await callback(ws);
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

async function probeViewSwitcher(group: CdpWindowTargetGroup): Promise<ViewSwitcherProbe> {
  return withTargetSocket(group.page, async (ws) => {
    const result = await cdpEvaluate(
      ws,
      `
      (() => {
        const container = document.querySelector('ul.actions-container[aria-label="Active View Switcher"]');
        if (!container) {
          return { activeLabel: null, labels: [] };
        }
        const items = Array.from(container.querySelectorAll('li.action-item'));
        const labels = items
          .map((item) => {
            const labelNode = item.querySelector('.action-label[aria-label]');
            const label = labelNode?.getAttribute('aria-label') || labelNode?.textContent?.trim() || '';
            const selected = item.classList.contains('checked') || item.getAttribute('aria-selected') === 'true';
            return label ? { label, selected } : null;
          })
          .filter((item) => Boolean(item));
        const active = labels.find((item) => item.selected)?.label ?? null;
        return {
          activeLabel: active,
          labels: labels.map((item) => item.label),
        };
      })()
      `,
      1
    );

    const value = getEvaluationValue(result);
    if (!value || typeof value !== 'object') {
      return { activeLabel: null, labels: [] };
    }

    const probe = value as { activeLabel?: unknown; labels?: unknown };
    return {
      activeLabel: typeof probe.activeLabel === 'string' ? probe.activeLabel : null,
      labels: Array.isArray(probe.labels)
        ? probe.labels.filter((item): item is string => typeof item === 'string')
        : []
    };
  });
}

function buildWindowAgentState(group: CdpWindowTargetGroup, probe: ViewSwitcherProbe): WindowAgentState {
  const iframeAgents = group.iframes.map((target) => mapTargetUrlToAgent(target.url));
  const labelAgents = probe.labels.map((label) => mapAgentLabelToKind(label));
  return {
    pageTitle: group.page.title,
    activeAgent: mapAgentLabelToKind(probe.activeLabel),
    availableAgents: uniqueAgents([...iframeAgents, ...labelAgents])
  };
}

export async function getWindowAgentStates(port: number): Promise<WindowAgentState[]> {
  const targets = await getCdpTargets(port);
  const groups = groupTargetsByPage(targets);
  const states: WindowAgentState[] = [];

  for (const group of groups) {
    try {
      const probe = await probeViewSwitcher(group);
      states.push(buildWindowAgentState(group, probe));
    } catch {
      states.push({
        pageTitle: group.page.title,
        activeAgent: 'unknown',
        availableAgents: uniqueAgents(group.iframes.map((target) => mapTargetUrlToAgent(target.url)))
      });
    }
  }

  return states;
}

export function findWindowAgentState(
  states: WindowAgentState[],
  windowTitle?: string
): WindowAgentState | null {
  if (states.length === 0) {
    return null;
  }
  if (!windowTitle) {
    return states.length === 1 ? states[0] : null;
  }

  let bestState: WindowAgentState | null = null;
  let bestScore = -1;
  let tied = false;

  for (const state of states) {
    const score = windowTitleScore(state.pageTitle, windowTitle);
    if (score > bestScore) {
      bestState = state;
      bestScore = score;
      tied = false;
      continue;
    }
    if (score >= 0 && score === bestScore) {
      tied = true;
    }
  }

  if (bestScore < 0 || tied) {
    return null;
  }

  return bestState;
}

function getSendScript(agent: Exclude<AgentKind, 'unknown'>, message: string) {
  const escapedMessage = JSON.stringify(message);

  if (agent === 'claude-code') {
    return {
      inject: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        if (!doc) return 'no_contentDocument';
        var input = doc.querySelector('.messageInput_cKsPxg[contenteditable]');
        if (!input) input = doc.querySelector('[contenteditable="plaintext-only"][role="textbox"]');
        if (!input) input = doc.querySelector('[role="textbox"][contenteditable]');
        if (!input) return 'input_not_found';
        input.focus();
        input.textContent = ${escapedMessage};
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${escapedMessage}, inputType: 'insertText' }));
        return 'injected';
      })()
      `,
      submit: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        var input = doc.querySelector('.messageInput_cKsPxg[contenteditable]');
        if (!input) input = doc.querySelector('[contenteditable="plaintext-only"][role="textbox"]');
        if (!input) input = doc.querySelector('[role="textbox"][contenteditable]');
        if (!input) return 'no_input';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return 'sent';
      })()
      `
    };
  }

  if (agent === 'codex') {
    return {
      inject: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        if (!doc) return 'no_contentDocument';
        var input = doc.querySelector('div.ProseMirror[contenteditable="true"]');
        if (!input) input = doc.querySelector('.ProseMirror[contenteditable="true"]');
        if (!input) return 'input_not_found';
        input.focus();
        input.innerHTML = '';
        var paragraph = doc.createElement('p');
        paragraph.textContent = ${escapedMessage};
        input.appendChild(paragraph);
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, data: ${escapedMessage}, inputType: 'insertText' }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${escapedMessage}, inputType: 'insertText' }));
        return 'injected';
      })()
      `,
      submit: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        var input = doc.querySelector('div.ProseMirror[contenteditable="true"]');
        if (!input) input = doc.querySelector('.ProseMirror[contenteditable="true"]');
        if (!input) return 'no_input';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return 'sent';
      })()
      `
    };
  }

  if (agent === 'kilo-code') {
    return {
      inject: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        if (!doc) return 'no_contentDocument';
        var input = doc.querySelector('textarea');
        if (!input) input = doc.querySelector('[role="textbox"]');
        if (!input) return 'input_not_found';
        var setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (!setValue) return 'no_value_setter';
        input.focus();
        setValue.call(input, ${escapedMessage});
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ${escapedMessage}, inputType: 'insertText' }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ${escapedMessage}, inputType: 'insertText' }));
        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        return 'injected';
      })()
      `,
      submit: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        var input = doc.querySelector('textarea');
        if (!input) input = doc.querySelector('[role="textbox"]');
        if (!input) return 'no_input';
        var sendButton = Array.from(doc.querySelectorAll('button')).find(function (button) {
          if (button.disabled) return false;
          var label = (button.getAttribute('aria-label') || button.textContent || '').toLowerCase();
          return label.includes('send');
        });
        if (sendButton) {
          sendButton.click();
          return 'sent_button';
        }
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return 'sent';
      })()
      `
    };
  }

  if (agent === 'kimi-code') {
    return {
      inject: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        if (!doc) return 'no_contentDocument';
        var input = doc.querySelector('textarea');
        if (!input) input = doc.querySelector('[role="textbox"]');
        if (!input) input = doc.querySelector('div[contenteditable="true"]');
        if (!input) return 'input_not_found';
        var setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        input.focus();
        if (setValue && input.tagName === 'TEXTAREA') {
          setValue.call(input, ${escapedMessage});
        } else if (input.isContentEditable) {
          input.innerHTML = '<p>' + ${escapedMessage}.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</p>';
        } else {
          input.textContent = ${escapedMessage};
        }
        input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: ${escapedMessage}, inputType: 'insertText' }));
        input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, data: ${escapedMessage}, inputType: 'insertText' }));
        input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        return 'injected';
      })()
      `,
      submit: `
      (() => {
        var iframe = document.querySelector('iframe');
        if (!iframe) return 'no_iframe';
        var doc = iframe.contentDocument;
        var input = doc.querySelector('textarea');
        if (!input) input = doc.querySelector('[role="textbox"]');
        if (!input) input = doc.querySelector('div[contenteditable="true"]');
        if (!input) return 'no_input';
        // Kimi Code: uses React; synthetic button clicks do not trigger its onClick.
        // Dispatch Enter key events on the textarea instead — this is what actually works.
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return 'sent_enter';
      })()
      `
    };
  }

  return null;
}

async function sendIntoAgentTarget(
  target: CdpTarget,
  agent: Exclude<AgentKind, 'unknown'>,
  message: string
): Promise<{ success: boolean; error?: string }> {
  const scripts = getSendScript(agent, message);
  if (!scripts) {
    return { success: false, error: `CDP sending is not supported for ${agent}` };
  }

  try {
    return await withTargetSocket(target, async (ws) => {
      const injectResult = await cdpEvaluate(ws, scripts.inject, 1);
      const injectValue = getEvaluationValue(injectResult);
      if (injectValue !== 'injected') {
        return {
          success: false,
          error: `CDP inject returned: ${String(injectValue)}`
        };
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      const submitResult = await cdpEvaluate(ws, scripts.submit, 2);
      const submitValue = getEvaluationValue(submitResult);
      if (submitValue === 'sent' || submitValue === 'sent_button' || submitValue === 'sent_enter') {
        return { success: true };
      }

      return {
        success: false,
        error: `CDP submit returned: ${String(submitValue)}`
      };
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function sendViaAgentCdp(
  port: number,
  message: string,
  options: SendViaAgentOptions
): Promise<{ success: boolean; error?: string }> {
  try {
    const targets = await getCdpTargets(port);
    const groups = groupTargetsByPage(targets);
    const windowGroup = findWindowGroupByTitle(groups, options.windowTitle);

    if (!windowGroup) {
      return {
        success: false,
        error: options.windowTitle
          ? `No unique VS Code: CDP target matched "${options.windowTitle}"`
          : 'No unique VS Code: CDP target matched the requested agent'
      };
    }

    const iframeTarget = findAgentIframeTarget(windowGroup, options.agent);
    if (!iframeTarget) {
      return {
        success: false,
        error: `${options.agent} webview not found in ${windowGroup.page.title}`
      };
    }

    return sendIntoAgentTarget(iframeTarget, options.agent, message);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function isCdpAvailable(
  port: number,
  agent: Exclude<AgentKind, 'unknown'> = 'kilo-code'
): Promise<boolean> {
  try {
    const targets = await getCdpTargets(port);
    const groups = groupTargetsByPage(targets);
    return groups.some((group) => Boolean(findAgentIframeTarget(group, agent)));
  } catch {
    return false;
  }
}
