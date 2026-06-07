/**
 * RDR Recovery Demonstration
 *
 * Shows how to use Auto-Claude MCP tools to handle RDR batches.
 * This script demonstrates the correct approach for the 10 tasks detected by RDR.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

interface RDRBatch {
  projectId: string;
  batchType: 'json_error' | 'incomplete' | 'qa_rejected' | 'errors';
  fixes: Array<{
    taskId: string;
    feedback?: string;
  }>;
}

/**
 * Step 1: Connect to Auto-Claude MCP Server
 */
async function connectToMCPServer(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['apps/frontend/src/main/mcp-server/start.js']
  });

  const client = new Client({
    name: 'rdr-recovery-demo',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  return client;
}

/**
 * Step 2: Process JSON Error Batch (Priority 3 - Auto-fix)
 */
async function processJsonErrors(client: Client, projectId: string): Promise<void> {
  const jsonErrorBatch: RDRBatch = {
    projectId,
    batchType: 'json_error',
    fixes: [
      { taskId: '071-marko' },
      { taskId: '079-alpine-htmx-knockout' },
      { taskId: '080-svelte-aurelia' },
      { taskId: '083-rte-major' },
      { taskId: '084-rte-other' },
      { taskId: '085-templating-backend' },
      { taskId: '086-templating-frontend' }
    ]
  };

  console.log('[RDR] Processing JSON error batch (7 tasks)...');

  const result = await client.callTool({
    name: 'process_rdr_batch',
    arguments: jsonErrorBatch
  });

  console.log('[RDR] JSON errors processed:', result);
}

/**
 * Step 3: Process Incomplete Task Batch (Priority 1 - Auto-recovery)
 */
async function processIncompleteTasks(client: Client, projectId: string): Promise<void> {
  const incompleteBatch: RDRBatch = {
    projectId,
    batchType: 'incomplete',
    fixes: [
      { taskId: '073-qwik' },      // 13/21 subtasks complete
      { taskId: '077-shadow-component-libs' },  // 6/13 subtasks complete
      { taskId: '081-ats-major' }  // 7/21 subtasks complete
    ]
  };

  console.log('[RDR] Processing incomplete task batch (3 tasks)...');

  const result = await client.callTool({
    name: 'process_rdr_batch',
    arguments: incompleteBatch
  });

  console.log('[RDR] Incomplete tasks processed:', result);
}

/**
 * Step 4: Get detailed error info for a specific task (optional)
 */
async function getTaskDetails(client: Client, projectId: string, taskId: string): Promise<void> {
  console.log(`[RDR] Getting error details for task ${taskId}...`);

  const result = await client.callTool({
    name: 'get_task_error_details',
    arguments: {
      projectId,
      taskId
    }
  });

  console.log(`[RDR] Task ${taskId} details:`, result);
}

/**
 * Main execution
 */
async function main() {
  const projectId = process.env.AUTO_CLAUDE_PROJECT_ID || 'REPLACE_WITH_YOUR_PROJECT_UUID';

  if (projectId === 'REPLACE_WITH_YOUR_PROJECT_UUID') {
    console.error('ERROR: Set AUTO_CLAUDE_PROJECT_ID environment variable');
    console.error('  Get the project UUID from the Auto-Claude UI');
    process.exit(1);
  }

  try {
    // Connect to MCP server
    console.log('[RDR] Connecting to Auto-Claude MCP server...');
    const client = await connectToMCPServer();
    console.log('[RDR] Connected successfully');

    // Process both batches in parallel
    await Promise.all([
      processJsonErrors(client, projectId),
      processIncompleteTasks(client, projectId)
    ]);

    console.log('[RDR] ✅ All RDR batches processed successfully');
    console.log('[RDR] File watcher will auto-resume tasks within 2-3 seconds');

    // Optional: Get detailed error info for one of the failed tasks
    // await getTaskDetails(client, projectId, '071-marko');

    await client.close();
  } catch (error) {
    console.error('[RDR] ❌ Recovery failed:', error);
    process.exit(1);
  }
}

/**
 * Alternative: File-based recovery (no MCP required)
 */
async function fileBasedRecovery(projectRoot: string): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const allTaskIds = [
    // JSON errors
    '071-marko', '079-alpine-htmx-knockout', '080-svelte-aurelia',
    '083-rte-major', '084-rte-other', '085-templating-backend', '086-templating-frontend',
    // Incomplete tasks
    '073-qwik', '077-shadow-component-libs', '081-ats-major'
  ];

  console.log('[RDR] Using file-based recovery for 10 tasks...');

  for (const taskId of allTaskIds) {
    const planPath = path.join(projectRoot, '.auto-claude', 'specs', taskId, 'implementation_plan.json');

    try {
      // Read current plan
      const planContent = await fs.readFile(planPath, 'utf-8');
      const plan = JSON.parse(planContent);

      // Update status to trigger recovery
      plan.status = 'start_requested';
      plan.start_requested_at = new Date().toISOString();

      // Write back
      await fs.writeFile(planPath, JSON.stringify(plan, null, 2));
      console.log(`[RDR] ✅ ${taskId} marked for recovery`);
    } catch (error) {
      console.error(`[RDR] ❌ Failed to process ${taskId}:`, error);
    }
  }

  console.log('[RDR] File-based recovery complete. File watcher will detect changes.');
}

// Run demonstration
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main, fileBasedRecovery, connectToMCPServer };
