import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import crypto from "crypto";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { installTokens, agents } from "../db/schema.js";
import { eq, and, desc, isNull, or, gt } from "drizzle-orm";
import type { Request, Response } from "express";
import { authLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

// === INSTALL TOKENS ===

// GET /agents/install-tokens - List all install tokens for user
router.get(
  "/install-tokens",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    try {
      const tokens = await getDb()
        .select()
        .from(installTokens)
        .where(
          and(eq(installTokens.userId, userId), isNull(installTokens.revokedAt))
        )
        .orderBy(desc(installTokens.createdAt));

      const now = new Date();
      res.json(
        tokens.map((t) => ({
          id: t.id,
          name: t.name,
          maxUses: t.maxUses,
          currentUses: t.currentUses,
          expiresAt: t.expiresAt,
          configTemplate: JSON.parse(t.configTemplate),
          createdAt: t.createdAt,
          isExpired: t.expiresAt ? new Date(t.expiresAt) < now : false,
          isExhausted: t.maxUses !== null && t.currentUses >= t.maxUses,
        }))
      );
    } catch (err) {
      authLogger.error("Failed to fetch install tokens", err, {
        operation: "install_tokens_list",
        userId,
      });
      res.status(500).json({ error: "Failed to fetch install tokens" });
    }
  }
);

// POST /agents/install-tokens - Create new install token
router.post(
  "/install-tokens",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, maxUses, expiresInMinutes, configTemplate } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: "Name is required" });
    }

    try {
      const id = nanoid();
      const token = crypto.randomBytes(32).toString("base64url");

      const expiresAt = expiresInMinutes
        ? new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString()
        : null;

      const config = {
        folder: configTemplate?.folder || null,
        tags: configTemplate?.tags || [],
        enableTerminal: configTemplate?.enableTerminal ?? true,
        enableFileManager: configTemplate?.enableFileManager ?? true,
        enableTunnels: configTemplate?.enableTunnels ?? true,
      };

      await getDb().insert(installTokens).values({
        id,
        userId,
        name: name.trim(),
        token,
        maxUses: maxUses || null,
        currentUses: 0,
        expiresAt,
        configTemplate: JSON.stringify(config),
      });

      authLogger.success(`Install token created: ${name}`, {
        operation: "install_token_create",
        userId,
        tokenId: id,
      });

      res.status(201).json({
        id,
        name: name.trim(),
        token, // Only returned once at creation
        maxUses: maxUses || null,
        expiresAt,
        configTemplate: config,
      });
    } catch (err) {
      authLogger.error("Failed to create install token", err, {
        operation: "install_token_create",
        userId,
      });
      res.status(500).json({ error: "Failed to create install token" });
    }
  }
);

// DELETE /agents/install-tokens/:id - Revoke install token
router.delete(
  "/install-tokens/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;

    try {
      const result = await getDb()
        .update(installTokens)
        .set({ revokedAt: new Date().toISOString() })
        .where(
          and(eq(installTokens.id, id), eq(installTokens.userId, userId))
        );

      authLogger.success(`Install token revoked`, {
        operation: "install_token_revoke",
        userId,
        tokenId: id,
      });

      res.json({ message: "Install token revoked" });
    } catch (err) {
      authLogger.error("Failed to revoke install token", err, {
        operation: "install_token_revoke",
        userId,
        tokenId: id,
      });
      res.status(500).json({ error: "Failed to revoke install token" });
    }
  }
);

// === AGENTS ===

// GET /agents - List all registered agents for user
router.get(
  "/",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    try {
      const agentList = await getDb()
        .select()
        .from(agents)
        .where(and(eq(agents.userId, userId), isNull(agents.revokedAt)))
        .orderBy(desc(agents.lastSeenAt));

      res.json(
        agentList.map((a) => ({
          id: a.id,
          deviceId: a.deviceId,
          hostname: a.hostname,
          platform: a.platform,
          os: a.os,
          arch: a.arch,
          agentVersion: a.agentVersion,
          folder: a.folder,
          tags: a.tags ? a.tags.split(",").filter(Boolean) : [],
          enableTerminal: a.enableTerminal,
          enableFileManager: a.enableFileManager,
          enableTunnels: a.enableTunnels,
          status: a.status,
          lastSeenAt: a.lastSeenAt,
          createdAt: a.createdAt,
        }))
      );
    } catch (err) {
      authLogger.error("Failed to fetch agents", err, {
        operation: "agents_list",
        userId,
      });
      res.status(500).json({ error: "Failed to fetch agents" });
    }
  }
);

// GET /agents/:id - Get single agent
router.get(
  "/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;

    try {
      const agentList = await getDb()
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.id, id),
            eq(agents.userId, userId),
            isNull(agents.revokedAt)
          )
        )
        .limit(1);

      if (agentList.length === 0) {
        return res.status(404).json({ error: "Agent not found" });
      }

      const a = agentList[0];
      res.json({
        id: a.id,
        deviceId: a.deviceId,
        hostname: a.hostname,
        platform: a.platform,
        os: a.os,
        arch: a.arch,
        agentVersion: a.agentVersion,
        folder: a.folder,
        tags: a.tags ? a.tags.split(",").filter(Boolean) : [],
        enableTerminal: a.enableTerminal,
        enableFileManager: a.enableFileManager,
        enableTunnels: a.enableTunnels,
        status: a.status,
        lastSeenAt: a.lastSeenAt,
        createdAt: a.createdAt,
      });
    } catch (err) {
      authLogger.error("Failed to fetch agent", err, {
        operation: "agent_get",
        userId,
        agentId: id,
      });
      res.status(500).json({ error: "Failed to fetch agent" });
    }
  }
);

// PUT /agents/:id - Update agent config
router.put(
  "/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;
    const { folder, tags, enableTerminal, enableFileManager, enableTunnels } =
      req.body;

    try {
      await getDb()
        .update(agents)
        .set({
          folder: folder || null,
          tags: Array.isArray(tags) ? tags.join(",") : tags || "",
          enableTerminal: enableTerminal ?? true,
          enableFileManager: enableFileManager ?? true,
          enableTunnels: enableTunnels ?? true,
        })
        .where(and(eq(agents.id, id), eq(agents.userId, userId)));

      authLogger.success(`Agent updated`, {
        operation: "agent_update",
        userId,
        agentId: id,
      });

      res.json({ message: "Agent updated" });
    } catch (err) {
      authLogger.error("Failed to update agent", err, {
        operation: "agent_update",
        userId,
        agentId: id,
      });
      res.status(500).json({ error: "Failed to update agent" });
    }
  }
);

// DELETE /agents/:id - Revoke an agent
router.delete(
  "/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { id } = req.params;

    try {
      await getDb()
        .update(agents)
        .set({ revokedAt: new Date().toISOString(), status: "offline" })
        .where(and(eq(agents.id, id), eq(agents.userId, userId)));

      authLogger.success(`Agent revoked`, {
        operation: "agent_revoke",
        userId,
        agentId: id,
      });

      res.json({ message: "Agent revoked" });
    } catch (err) {
      authLogger.error("Failed to revoke agent", err, {
        operation: "agent_revoke",
        userId,
        agentId: id,
      });
      res.status(500).json({ error: "Failed to revoke agent" });
    }
  }
);

export default router;
