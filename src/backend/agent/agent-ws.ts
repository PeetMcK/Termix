import { WebSocketServer, WebSocket, type RawData } from "ws";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { nanoid } from "nanoid";
import { parse as parseUrl } from "url";
import { getDb } from "../database/db/index.js";
import { installTokens, agents } from "../database/db/schema.js";
import { eq, and, isNull, or, gt } from "drizzle-orm";
import { authLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";

const AGENT_WS_PORT = 30007;
const APP_AGENT_TERMINAL_PORT = 30008;
const AGENT_STREAM_PORT = 30009;
const authManager = AuthManager.getInstance();

interface AgentConnection {
  ws: WebSocket;
  agentId: string;
  userId: string;
  deviceId: string;
  lastHeartbeat: number;
}

interface AgentMessage {
  type: string;
  data?: Record<string, unknown>;
}

interface RegisterData {
  deviceId: string;
  token?: string;
  hostname?: string;
  platform?: string;
  os?: string;
  arch?: string;
  goVersion?: string;
}

// Map of agentId -> connection
const connectedAgents = new Map<string, AgentConnection>();

// Map of WebSocket -> pending token (for unauthenticated connections)
const pendingConnections = new Map<WebSocket, string>();

const agentWss = new WebSocketServer({ port: AGENT_WS_PORT });

authLogger.info(`Agent WebSocket server started on port ${AGENT_WS_PORT}`, {
  operation: "agent_ws_start",
  port: AGENT_WS_PORT,
});

agentWss.on("connection", async (ws, req) => {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    authLogger.warn("Agent connection rejected: missing token", {
      operation: "agent_connect_rejected",
      reason: "missing_token",
    });
    ws.close(4001, "Missing authentication token");
    return;
  }

  // Store token for this connection until registration
  pendingConnections.set(ws, token);

  ws.on("message", async (data: RawData) => {
    try {
      const message: AgentMessage = JSON.parse(data.toString());
      await handleAgentMessage(ws, message);
    } catch (err) {
      authLogger.error("Failed to handle agent message", err, {
        operation: "agent_message_error",
      });
      ws.send(
        JSON.stringify({ type: "error", data: { message: "Invalid message" } })
      );
    }
  });

  ws.on("close", () => {
    // Clean up pending connection
    pendingConnections.delete(ws);

    // Find and update agent status
    for (const [agentId, conn] of connectedAgents.entries()) {
      if (conn.ws === ws) {
        updateAgentStatus(agentId, "offline");
        connectedAgents.delete(agentId);
        authLogger.info(`Agent disconnected`, {
          operation: "agent_disconnect",
          agentId,
          deviceId: conn.deviceId,
        });
        break;
      }
    }
  });

  ws.on("error", (err) => {
    authLogger.error("Agent WebSocket error", err, {
      operation: "agent_ws_error",
    });
  });
});

async function handleAgentMessage(ws: WebSocket, message: AgentMessage) {
  switch (message.type) {
    case "register":
      await handleRegister(ws, message.data as unknown as RegisterData);
      break;
    case "heartbeat":
      await handleHeartbeat(ws, message.data);
      break;
    case "pty_data":
      handleAgentPtyData(message.data as { sessionId: string; data: string });
      break;
    case "pty_exit":
      handleAgentPtyExit(message.data as { sessionId: string; code: number });
      break;
    case "cmd_result":
      // Handle command execution result (to be implemented)
      break;
    case "cmd_error":
      // Handle command execution error (to be implemented)
      break;
    case "pong":
      // Response to ping, update heartbeat
      await handleHeartbeat(ws, {});
      break;

    // File operation responses from agent
    case "file_list":
    case "file_content":
    case "file_op_result":
    case "file_error":
      handleAgentFileOpResponse(message.type, message.data as Record<string, unknown>);
      break;

    // Streaming responses from agent
    case "stream_file_info_response":
    case "stream_chunk_response":
      handleAgentStreamingResponse(message.type, message.data as Record<string, unknown>);
      break;

    default:
      authLogger.warn(`Unknown agent message type: ${message.type}`, {
        operation: "agent_unknown_message",
        type: message.type,
      });
  }
}

async function handleRegister(ws: WebSocket, data: RegisterData) {
  const token = pendingConnections.get(ws);
  if (!token) {
    ws.send(
      JSON.stringify({
        type: "register_ack",
        data: { success: false, message: "No token provided" },
      })
    );
    ws.close(4001, "No token");
    return;
  }

  const { deviceId, hostname, platform, os, arch, goVersion } = data;

  if (!deviceId) {
    ws.send(
      JSON.stringify({
        type: "register_ack",
        data: { success: false, message: "Device ID required" },
      })
    );
    return;
  }

  // First, try to authenticate with an existing agent token
  const existingAgent = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.agentToken, token), isNull(agents.revokedAt)))
    .limit(1);

  if (existingAgent.length > 0) {
    // Existing agent reconnecting
    const agent = existingAgent[0];

    await getDb()
      .update(agents)
      .set({
        hostname: hostname || agent.hostname,
        platform: platform || agent.platform,
        os: os || agent.os,
        arch: arch || agent.arch,
        agentVersion: goVersion || agent.agentVersion,
        status: "online",
        lastSeenAt: new Date().toISOString(),
      })
      .where(eq(agents.id, agent.id));

    // Clear pending and store as connected
    pendingConnections.delete(ws);
    connectedAgents.set(agent.id, {
      ws,
      agentId: agent.id,
      userId: agent.userId,
      deviceId: agent.deviceId,
      lastHeartbeat: Date.now(),
    });

    authLogger.success(`Agent reconnected: ${hostname || agent.hostname}`, {
      operation: "agent_reconnect",
      agentId: agent.id,
      deviceId: agent.deviceId,
      userId: agent.userId,
    });

    ws.send(
      JSON.stringify({
        type: "register_ack",
        data: {
          success: true,
          message: "Reconnected successfully",
          agentId: agent.id,
          config: {
            enableTerminal: agent.enableTerminal,
            enableFileManager: agent.enableFileManager,
            enableTunnels: agent.enableTunnels,
          },
        },
      })
    );
    return;
  }

  // Try to authenticate with install token (enrollment)
  const now = new Date().toISOString();
  const installToken = await getDb()
    .select()
    .from(installTokens)
    .where(
      and(
        eq(installTokens.token, token),
        isNull(installTokens.revokedAt),
        or(isNull(installTokens.expiresAt), gt(installTokens.expiresAt, now))
      )
    )
    .limit(1);

  if (installToken.length === 0) {
    authLogger.warn("Agent enrollment rejected: invalid token", {
      operation: "agent_enroll_rejected",
      reason: "invalid_token",
      deviceId,
    });
    ws.send(
      JSON.stringify({
        type: "register_ack",
        data: { success: false, message: "Invalid or expired token" },
      })
    );
    ws.close(4002, "Invalid token");
    return;
  }

  const iToken = installToken[0];

  // Check max uses
  if (iToken.maxUses !== null && iToken.currentUses >= iToken.maxUses) {
    authLogger.warn("Agent enrollment rejected: token exhausted", {
      operation: "agent_enroll_rejected",
      reason: "token_exhausted",
      tokenId: iToken.id,
      deviceId,
    });
    ws.send(
      JSON.stringify({
        type: "register_ack",
        data: { success: false, message: "Install token usage limit reached" },
      })
    );
    ws.close(4003, "Token exhausted");
    return;
  }

  // Generate new agent token
  const agentId = nanoid();
  const newAgentToken = crypto.randomBytes(48).toString("base64url");
  const config = JSON.parse(iToken.configTemplate);

  // Create agent record
  await getDb().insert(agents).values({
    id: agentId,
    userId: iToken.userId,
    installTokenId: iToken.id,
    deviceId,
    hostname: hostname || null,
    platform: platform || null,
    os: os || null,
    arch: arch || null,
    agentVersion: goVersion || null,
    agentToken: newAgentToken,
    folder: config.folder || null,
    tags: Array.isArray(config.tags) ? config.tags.join(",") : "",
    enableTerminal: config.enableTerminal ?? true,
    enableFileManager: config.enableFileManager ?? true,
    enableTunnels: config.enableTunnels ?? true,
    status: "online",
    lastSeenAt: new Date().toISOString(),
  });

  // Increment install token usage
  await getDb()
    .update(installTokens)
    .set({ currentUses: iToken.currentUses + 1 })
    .where(eq(installTokens.id, iToken.id));

  // Clear pending and store as connected
  pendingConnections.delete(ws);
  connectedAgents.set(agentId, {
    ws,
    agentId,
    userId: iToken.userId,
    deviceId,
    lastHeartbeat: Date.now(),
  });

  authLogger.success(`Agent enrolled: ${hostname} (${deviceId})`, {
    operation: "agent_enroll",
    agentId,
    deviceId,
    userId: iToken.userId,
    installTokenId: iToken.id,
  });

  // Send agent token back (agent should store in keychain)
  ws.send(
    JSON.stringify({
      type: "register_ack",
      data: {
        success: true,
        message: "Enrolled successfully",
        agentId,
        agentToken: newAgentToken, // Only sent once during enrollment!
        config: {
          enableTerminal: config.enableTerminal ?? true,
          enableFileManager: config.enableFileManager ?? true,
          enableTunnels: config.enableTunnels ?? true,
        },
      },
    })
  );
}

async function handleHeartbeat(
  ws: WebSocket,
  data: Record<string, unknown> | undefined
) {
  // Find connection by websocket
  for (const [agentId, conn] of connectedAgents.entries()) {
    if (conn.ws === ws) {
      conn.lastHeartbeat = Date.now();

      await getDb()
        .update(agents)
        .set({ lastSeenAt: new Date().toISOString() })
        .where(eq(agents.id, agentId));

      break;
    }
  }
}

async function updateAgentStatus(agentId: string, status: string) {
  await getDb()
    .update(agents)
    .set({ status, lastSeenAt: new Date().toISOString() })
    .where(eq(agents.id, agentId));
}

// Export for use by other modules (e.g., to send commands to agents)
export function getConnectedAgent(agentId: string): AgentConnection | undefined {
  return connectedAgents.get(agentId);
}

export function getConnectedAgentsByUser(userId: string): AgentConnection[] {
  const result: AgentConnection[] = [];
  for (const conn of connectedAgents.values()) {
    if (conn.userId === userId) {
      result.push(conn);
    }
  }
  return result;
}

export function sendToAgent(agentId: string, message: AgentMessage): boolean {
  const conn = connectedAgents.get(agentId);
  if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  conn.ws.send(JSON.stringify(message));
  return true;
}

// ============================================================================
// APP -> AGENT TERMINAL WEBSOCKET (port 30008)
// ============================================================================

interface AppTerminalSession {
  ws: WebSocket;
  userId: string;
  agentId: string;
  sessionId: string;
}

// File operation request tracking
interface FileOpRequest {
  ws: WebSocket;
  userId: string;
  agentId: string;
  requestId: string;
  timestamp: number;
}

// Map requestId -> pending file operation request
const pendingFileOps = new Map<string, FileOpRequest>();

// Cleanup old pending requests every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [requestId, req] of pendingFileOps.entries()) {
    if (now - req.timestamp > 5 * 60 * 1000) {
      pendingFileOps.delete(requestId);
    }
  }
}, 60 * 1000);

// Map sessionId -> app terminal session
const appTerminalSessions = new Map<string, AppTerminalSession>();

// Map app WebSocket -> sessionId
const appWsToSession = new Map<WebSocket, string>();

const agentTerminalWss = new WebSocketServer({
  port: APP_AGENT_TERMINAL_PORT,
  verifyClient: async (info, callback) => {
    try {
      const url = parseUrl(info.req.url!, true);
      const token = url.query.token as string;

      if (!token) {
        callback(false, 401, "Missing token");
        return;
      }

      const payload = await authManager.verifyJWTToken(token);
      if (!payload) {
        callback(false, 401, "Invalid token");
        return;
      }

      callback(true);
    } catch {
      callback(false, 401, "Authentication failed");
    }
  },
});

authLogger.info(`Agent terminal WebSocket server started on port ${APP_AGENT_TERMINAL_PORT}`, {
  operation: "agent_terminal_ws_start",
  port: APP_AGENT_TERMINAL_PORT,
});

agentTerminalWss.on("connection", async (ws, req) => {
  let userId: string;

  try {
    const url = parseUrl(req.url!, true);
    const token = url.query.token as string;

    const payload = await authManager.verifyJWTToken(token);
    if (!payload) {
      ws.close(1008, "Authentication failed");
      return;
    }
    userId = payload.userId;
  } catch {
    ws.close(1008, "Authentication failed");
    return;
  }

  ws.on("message", async (data: RawData) => {
    try {
      const message = JSON.parse(data.toString());
      await handleAppTerminalMessage(ws, userId, message);
    } catch (err) {
      authLogger.error("Failed to handle app terminal message", err, {
        operation: "app_terminal_message_error",
      });
    }
  });

  ws.on("close", () => {
    const sessionId = appWsToSession.get(ws);
    if (sessionId) {
      const session = appTerminalSessions.get(sessionId);
      if (session) {
        // Send close_pty to agent
        sendToAgent(session.agentId, {
          type: "close_pty",
          data: { sessionId },
        });
        appTerminalSessions.delete(sessionId);
      }
      appWsToSession.delete(ws);
    }
  });
});

interface AppTerminalMessage {
  type: string;
  data?: Record<string, unknown>;
}

async function handleAppTerminalMessage(ws: WebSocket, userId: string, message: AppTerminalMessage) {
  switch (message.type) {
    case "connectToAgent": {
      const { agentId, cols, rows } = message.data as { agentId: string; cols: number; rows: number };

      // Verify user owns this agent
      const agentList = await getDb()
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.userId, userId),
            isNull(agents.revokedAt)
          )
        )
        .limit(1);

      if (agentList.length === 0) {
        ws.send(JSON.stringify({ type: "error", message: "Agent not found or not authorized" }));
        return;
      }

      const agent = agentList[0];

      // Check if agent is connected
      const agentConn = connectedAgents.get(agentId);
      if (!agentConn || agentConn.ws.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: "Agent is offline" }));
        return;
      }

      // Check if terminal is enabled
      if (!agent.enableTerminal) {
        ws.send(JSON.stringify({ type: "error", message: "Terminal access disabled for this agent" }));
        return;
      }

      // Create session
      const sessionId = nanoid();
      appTerminalSessions.set(sessionId, { ws, userId, agentId, sessionId });
      appWsToSession.set(ws, sessionId);

      // Send spawn_pty to agent
      const sent = sendToAgent(agentId, {
        type: "spawn_pty",
        data: { sessionId, cols, rows },
      });

      if (!sent) {
        appTerminalSessions.delete(sessionId);
        appWsToSession.delete(ws);
        ws.send(JSON.stringify({ type: "error", message: "Failed to send to agent" }));
        return;
      }

      ws.send(JSON.stringify({ type: "connected", message: "Terminal session started", sessionId }));

      authLogger.info(`App terminal connected to agent`, {
        operation: "app_agent_terminal_connect",
        userId,
        agentId,
        sessionId,
        hostname: agent.hostname,
      });
      break;
    }

    case "input": {
      const sessionId = appWsToSession.get(ws);
      if (!sessionId) return;

      const session = appTerminalSessions.get(sessionId);
      if (!session) return;

      // Base64 encode the input
      const inputData = String(message.data ?? "");
      const b64Data = Buffer.from(inputData, "utf8").toString("base64");

      sendToAgent(session.agentId, {
        type: "pty_input",
        data: { sessionId, data: b64Data },
      });
      break;
    }

    case "resize": {
      const sessionId = appWsToSession.get(ws);
      if (!sessionId) return;

      const session = appTerminalSessions.get(sessionId);
      if (!session) return;

      const { cols, rows } = message.data as { cols: number; rows: number };
      sendToAgent(session.agentId, {
        type: "pty_resize",
        data: { sessionId, cols, rows },
      });
      break;
    }

    case "disconnect": {
      const sessionId = appWsToSession.get(ws);
      if (!sessionId) return;

      const session = appTerminalSessions.get(sessionId);
      if (!session) return;

      sendToAgent(session.agentId, {
        type: "close_pty",
        data: { sessionId },
      });

      appTerminalSessions.delete(sessionId);
      appWsToSession.delete(ws);
      break;
    }

    // File operations
    case "list_files":
    case "download_file":
    case "upload_file":
    case "create_file":
    case "create_folder":
    case "delete_item":
    case "copy_item":
    case "move_item":
    case "rename_item": {
      authLogger.info(`[FileOp] Received ${message.type} request from app`, {
        operation: "file_op_request",
        type: message.type,
        data: message.data,
      });
      await handleFileOpRequest(ws, userId, message.type, message.data as Record<string, unknown>);
      break;
    }
  }
}

// Handle file operation request from app
async function handleFileOpRequest(
  ws: WebSocket,
  userId: string,
  msgType: string,
  data: Record<string, unknown>
) {
  const { agentId, requestId, ...opData } = data as {
    agentId: string;
    requestId: string;
    [key: string]: unknown;
  };

  if (!agentId || !requestId) {
    ws.send(JSON.stringify({
      type: "file_error",
      data: { requestId, code: 400, message: "Missing agentId or requestId" }
    }));
    return;
  }

  // Verify user owns this agent
  const agentList = await getDb()
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.userId, userId),
        isNull(agents.revokedAt)
      )
    )
    .limit(1);

  if (agentList.length === 0) {
    ws.send(JSON.stringify({
      type: "file_error",
      data: { requestId, code: 403, message: "Agent not found or not authorized" }
    }));
    return;
  }

  const agent = agentList[0];

  // Check if file manager is enabled
  if (!agent.enableFileManager) {
    ws.send(JSON.stringify({
      type: "file_error",
      data: { requestId, code: 403, message: "File manager disabled for this agent" }
    }));
    return;
  }

  // Check if agent is connected
  const agentConn = connectedAgents.get(agentId);
  if (!agentConn || agentConn.ws.readyState !== WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "file_error",
      data: { requestId, code: 503, message: "Agent is offline" }
    }));
    return;
  }

  // Store pending request
  pendingFileOps.set(requestId, {
    ws,
    userId,
    agentId,
    requestId,
    timestamp: Date.now(),
  });

  // Forward to agent
  const agentMessage = {
    type: msgType,
    data: { requestId, ...opData },
  };
  authLogger.info(`[FileOp] Forwarding to agent ${agentId}:`, {
    operation: "file_op_forward",
    agentId,
    message: agentMessage,
  });
  const sent = sendToAgent(agentId, agentMessage);

  if (!sent) {
    authLogger.warn(`[FileOp] Failed to send to agent ${agentId}`, {
      operation: "file_op_send_failed",
      agentId,
    });
    pendingFileOps.delete(requestId);
    ws.send(JSON.stringify({
      type: "file_error",
      data: { requestId, code: 500, message: "Failed to send to agent" }
    }));
  } else {
    authLogger.info(`[FileOp] Message sent to agent ${agentId} successfully`, {
      operation: "file_op_sent",
      agentId,
      requestId,
    });
  }
}

// Handle file operation response from agent -> forward to app
function handleAgentFileOpResponse(msgType: string, data: Record<string, unknown>) {
  authLogger.info(`[FileOp] Received response from agent: ${msgType}`, {
    operation: "file_op_response",
    type: msgType,
    requestId: data.requestId as string,
  });

  const requestId = data.requestId as string;
  if (!requestId) {
    authLogger.warn("File op response missing requestId", {
      operation: "agent_file_op_no_request_id",
      type: msgType,
    });
    return;
  }

  const pendingReq = pendingFileOps.get(requestId);
  if (!pendingReq) {
    authLogger.warn(`[FileOp] No pending request for ${requestId} (may have timed out)`, {
      operation: "file_op_no_pending",
      requestId,
    });
    return;
  }

  // Forward to app
  if (pendingReq.ws.readyState === WebSocket.OPEN) {
    authLogger.info(`[FileOp] Forwarding response to app for ${requestId}`, {
      operation: "file_op_forward_to_app",
      requestId,
    });
    pendingReq.ws.send(JSON.stringify({ type: msgType, data }));
  } else {
    authLogger.warn(`[FileOp] App WebSocket not open for ${requestId}`, {
      operation: "file_op_app_ws_closed",
      requestId,
    });
  }

  // Clean up pending request
  pendingFileOps.delete(requestId);
}

// Handle PTY data from agent -> forward to app
function handleAgentPtyData(data: { sessionId: string; data: string }) {
  const session = appTerminalSessions.get(data.sessionId);
  if (!session || session.ws.readyState !== WebSocket.OPEN) return;

  // Decode base64 and send to app
  const decoded = Buffer.from(data.data, "base64").toString("utf8");
  session.ws.send(JSON.stringify({ type: "data", data: decoded }));
}

// Handle PTY exit from agent -> notify app
function handleAgentPtyExit(data: { sessionId: string; code: number }) {
  const session = appTerminalSessions.get(data.sessionId);
  if (!session) return;

  session.ws.send(JSON.stringify({ type: "disconnected", message: "Terminal session ended", code: data.code }));
  appTerminalSessions.delete(data.sessionId);
  appWsToSession.delete(session.ws);
}

// ========================================
// HTTP Streaming Server for Agent Files
// ========================================

const streamApp = express();
streamApp.use(cors());

// Custom auth middleware that accepts token from query string (for media elements)
streamApp.use(async (req, res, next) => {
  // Try to get token from Authorization header first
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  // Fall back to query parameter (for video/audio src attributes)
  if (!token && req.query.token) {
    token = req.query.token as string;
  }

  if (!token) {
    authLogger.warn("Stream request missing token", {
      operation: "stream_auth_missing_token",
      path: req.path,
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Verify token
    const decoded = await authManager.verifyJWTToken(token);
    if (!decoded) {
      authLogger.warn("Stream request invalid token", {
        operation: "stream_auth_invalid_token",
        path: req.path,
      });
      return res.status(401).json({ error: "Invalid token" });
    }

    (req as any).userId = decoded.userId;
    next();
  } catch (error) {
    authLogger.error("Stream auth error", error, {
      operation: "stream_auth_error",
      path: req.path,
    });
    return res.status(401).json({ error: "Authentication failed" });
  }
});

// Pending streaming requests
interface StreamingRequest {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

const pendingStreamingRequests = new Map<string, StreamingRequest>();

// Handle streaming responses from agent
function handleAgentStreamingResponse(msgType: string, data: Record<string, unknown>) {
  const requestId = data.requestId as string;
  if (!requestId) return;

  const pending = pendingStreamingRequests.get(requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  pendingStreamingRequests.delete(requestId);

  if (data.error) {
    pending.reject(new Error(data.error as string));
  } else {
    pending.resolve(data);
  }
}

// Request file info from agent
async function requestAgentFileInfo(agentId: string, filePath: string): Promise<{
  fileName: string;
  mimeType: string;
  size: number;
}> {
  const agentConn = connectedAgents.get(agentId);
  if (!agentConn || agentConn.ws.readyState !== WebSocket.OPEN) {
    throw new Error("Agent is offline");
  }

  const requestId = `stream-info-${nanoid()}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingStreamingRequests.delete(requestId);
      reject(new Error("Stream info request timeout"));
    }, 30000);

    pendingStreamingRequests.set(requestId, {
      resolve: (data) => {
        resolve({
          fileName: data.fileName as string,
          mimeType: data.mimeType as string,
          size: data.size as number,
        });
      },
      reject,
      timeout,
    });

    agentConn.ws.send(JSON.stringify({
      type: "stream_file_info",
      data: { requestId, path: filePath }
    }));
  });
}

// Request a chunk of file data from agent
async function requestAgentFileChunk(
  agentId: string,
  filePath: string,
  offset: number,
  length: number
): Promise<Buffer> {
  const agentConn = connectedAgents.get(agentId);
  if (!agentConn || agentConn.ws.readyState !== WebSocket.OPEN) {
    throw new Error("Agent is offline");
  }

  const requestId = `stream-chunk-${nanoid()}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingStreamingRequests.delete(requestId);
      reject(new Error("Stream chunk request timeout"));
    }, 60000);

    pendingStreamingRequests.set(requestId, {
      resolve: (data) => {
        const base64Data = data.data as string;
        resolve(Buffer.from(base64Data, "base64"));
      },
      reject,
      timeout,
    });

    agentConn.ws.send(JSON.stringify({
      type: "stream_chunk",
      data: { requestId, path: filePath, offset, length }
    }));
  });
}

// Chunk size for streaming (1MB chunks)
const STREAM_CHUNK_SIZE = 1024 * 1024;

// Stream endpoint - use regex to capture file path with slashes
streamApp.get(/^\/stream\/([^\/]+)\/(.+)$/, async (req, res) => {
  const agentId = req.params[0];
  const filePath = "/" + req.params[1]; // Reconstruct path
  const userId = (req as any).userId as string;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();

    // Verify user owns this agent
    const agentList = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, userId), isNull(agents.revokedAt)));

    if (agentList.length === 0) {
      return res.status(403).json({ error: "Agent not found or not authorized" });
    }

    const agent = agentList[0];
    if (!agent.enableFileManager) {
      return res.status(403).json({ error: "File manager disabled for this agent" });
    }

    // First, get file info
    const fileInfo = await requestAgentFileInfo(agentId, filePath);
    const fileSize = fileInfo.size;

    authLogger.info(`Streaming file: ${filePath}, size: ${fileSize}`, {
      operation: "agent_stream_start",
      agentId,
      filePath,
      fileSize,
    });

    // Handle Range requests for seeking
    const range = req.headers.range;
    let start = 0;
    let end = fileSize - 1;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      // Ensure valid range
      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).json({ error: "Range not satisfiable" });
        return;
      }

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": fileInfo.mimeType || "application/octet-stream",
      });
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": fileInfo.mimeType || "application/octet-stream",
        "Accept-Ranges": "bytes",
      });
    }

    // Stream the file in chunks
    let currentOffset = start;
    const targetEnd = end;

    while (currentOffset <= targetEnd) {
      const chunkSize = Math.min(STREAM_CHUNK_SIZE, targetEnd - currentOffset + 1);

      try {
        const chunk = await requestAgentFileChunk(agentId, filePath, currentOffset, chunkSize);

        // Write chunk to response
        const writeOk = res.write(chunk);

        if (!writeOk) {
          // Backpressure - wait for drain
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }

        currentOffset += chunk.length;

        // Check if client disconnected
        if (res.destroyed) {
          authLogger.info("Client disconnected during stream", {
            operation: "agent_stream_client_disconnect",
            agentId,
            filePath,
          });
          return;
        }
      } catch (chunkError) {
        authLogger.error("Failed to fetch chunk", chunkError, {
          operation: "agent_stream_chunk_error",
          agentId,
          filePath,
          offset: currentOffset,
        });
        // End response on chunk error
        res.end();
        return;
      }
    }

    res.end();
  } catch (error) {
    authLogger.error("Stream request failed", error, {
      operation: "agent_stream_error",
      agentId,
      filePath,
    });

    // Only send error if headers haven't been sent
    if (!res.headersSent) {
      const err = error as Error;
      res.status(500).json({ error: err.message || "Stream failed" });
    } else {
      res.end();
    }
  }
});

const streamServer = streamApp.listen(AGENT_STREAM_PORT, () => {
  authLogger.info(`Agent file streaming server started on port ${AGENT_STREAM_PORT}`, {
    operation: "agent_stream_start",
    port: AGENT_STREAM_PORT,
  });
});

export { connectedAgents, agentWss, agentTerminalWss, appTerminalSessions, streamServer };
