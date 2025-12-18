import React from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Key,
  Trash2,
  Copy,
  Terminal,
  FolderOpen,
  FolderPlus,
  Network,
  Server,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import {
  getInstallTokens,
  createInstallToken,
  revokeInstallToken,
  getAgents,
  revokeAgent,
  getSSHFolders,
  type InstallToken,
  type Agent,
} from "@/ui/main-axios.ts";

// ============================================================================
// INSTALL TOKENS MANAGER
// ============================================================================

export function InstallTokensManager() {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [tokens, setTokens] = React.useState<InstallToken[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreateDialog, setShowCreateDialog] = React.useState(false);
  const [showTokenDialog, setShowTokenDialog] = React.useState(false);
  const [newToken, setNewToken] = React.useState<InstallToken | null>(null);
  const [folders, setFolders] = React.useState<string[]>([]);

  // Form state
  const [name, setName] = React.useState("");
  const [maxUses, setMaxUses] = React.useState<string>("");
  const [expiryMinutes, setExpiryMinutes] = React.useState<string>("60");
  const [folder, setFolder] = React.useState<string>("");
  const [tags, setTags] = React.useState<string>("");
  const [enableTerminal, setEnableTerminal] = React.useState(true);
  const [enableFileManager, setEnableFileManager] = React.useState(true);
  const [enableTunnels, setEnableTunnels] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");

  React.useEffect(() => {
    fetchTokens();
    fetchFolders();
  }, []);

  const fetchTokens = async () => {
    try {
      setLoading(true);
      const data = await getInstallTokens();
      setTokens(data);
    } catch (err) {
      toast.error("Failed to fetch install tokens");
    } finally {
      setLoading(false);
    }
  };

  const fetchFolders = async () => {
    try {
      const data = await getSSHFolders();
      setFolders(data.map((f) => f.name));
    } catch {
      // Ignore
    }
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    setCreating(true);
    try {
      const result = await createInstallToken({
        name: name.trim(),
        maxUses: maxUses ? parseInt(maxUses) : null,
        expiresInMinutes: expiryMinutes ? parseInt(expiryMinutes) : null,
        configTemplate: {
          folder: folder || null,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          enableTerminal,
          enableFileManager,
          enableTunnels,
        },
      });

      setNewToken(result);
      setShowCreateDialog(false);
      setShowTokenDialog(true);
      resetForm();
      fetchTokens();

      toast.success("Install token created");
    } catch (err) {
      toast.error("Failed to create install token");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (token: InstallToken) => {
    confirmWithToast(
      `Revoke install token "${token.name}"?`,
      async () => {
        try {
          await revokeInstallToken(token.id);
          toast.success("Install token revoked");
          fetchTokens();
        } catch (err) {
          toast.error("Failed to revoke token");
        }
      },
      "destructive"
    );
  };

  const resetForm = () => {
    setName("");
    setMaxUses("");
    setExpiryMinutes("60");
    setFolder("");
    setTags("");
    setEnableTerminal(true);
    setEnableFileManager(true);
    setEnableTunnels(true);
    setIsCreatingFolder(false);
    setNewFolderName("");
  };

  const copyToken = () => {
    if (newToken?.token) {
      navigator.clipboard.writeText(newToken.token);
      toast.success("Token copied to clipboard");
    }
  };

  const copyEnrollCommand = () => {
    if (newToken?.token) {
      const command = `termix-agent enroll --token "${newToken.token}" --server YOUR_SERVER:30007`;
      navigator.clipboard.writeText(command);
      toast.success("Enrollment command copied to clipboard");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Install Tokens</h3>
        <Button onClick={() => setShowCreateDialog(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create Token
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Install tokens are used to enroll new agents. Create a token, then run
        the enrollment command on the target machine.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Uses</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Features</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => (
            <TableRow key={token.id}>
              <TableCell className="font-medium">{token.name}</TableCell>
              <TableCell>
                {token.currentUses}/{token.maxUses ?? "∞"}
              </TableCell>
              <TableCell>
                {token.expiresAt
                  ? new Date(token.expiresAt).toLocaleString()
                  : "Never"}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {token.configTemplate.enableTerminal && (
                    <Terminal className="h-4 w-4 text-muted-foreground" />
                  )}
                  {token.configTemplate.enableFileManager && (
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  )}
                  {token.configTemplate.enableTunnels && (
                    <Network className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </TableCell>
              <TableCell>
                {token.isExpired ? (
                  <Badge variant="destructive">Expired</Badge>
                ) : token.isExhausted ? (
                  <Badge variant="secondary">Exhausted</Badge>
                ) : (
                  <Badge variant="default">Active</Badge>
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRevoke(token)}
                  className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {tokens.length === 0 && !loading && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                No install tokens created yet
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Install Token</DialogTitle>
            <DialogDescription>
              Create a token for enrolling new agents
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Production Servers"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Max Uses</Label>
                <Input
                  type="number"
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="Unlimited"
                />
              </div>
              <div className="space-y-2">
                <Label>Expires In (minutes)</Label>
                <Input
                  type="number"
                  value={expiryMinutes}
                  onChange={(e) => setExpiryMinutes(e.target.value)}
                  placeholder="Never"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Folder</Label>
              {isCreatingFolder ? (
                <div className="flex gap-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Enter new folder name"
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (newFolderName.trim()) {
                        setFolder(newFolderName.trim());
                        setFolders((prev) => [...prev, newFolderName.trim()]);
                      }
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                  >
                    Add
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Select
                  value={folder || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__create__") {
                      setIsCreatingFolder(true);
                    } else {
                      setFolder(v === "__none__" ? "" : v);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No folder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__create__">
                      <span className="flex items-center gap-2 text-primary">
                        <FolderPlus className="h-4 w-4" />
                        Create new folder...
                      </span>
                    </SelectItem>
                    <Separator className="my-1" />
                    <SelectItem value="__none__">No folder</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="production, web, agent"
              />
            </div>

            <div className="space-y-3">
              <Label>Features</Label>
              <div className="flex items-center justify-between">
                <span className="text-sm">Terminal Access</span>
                <Switch
                  checked={enableTerminal}
                  onCheckedChange={setEnableTerminal}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">File Manager</span>
                <Switch
                  checked={enableFileManager}
                  onCheckedChange={setEnableFileManager}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Tunnels</span>
                <Switch
                  checked={enableTunnels}
                  onCheckedChange={setEnableTunnels}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creating..." : "Create Token"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Token Display Dialog */}
      <Dialog open={showTokenDialog} onOpenChange={setShowTokenDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install Token Created</DialogTitle>
            <DialogDescription>
              Copy this token now. It will not be shown again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-lg font-mono text-sm break-all">
              {newToken?.token}
            </div>
            <Button onClick={copyToken} className="w-full">
              <Copy className="mr-2 h-4 w-4" />
              Copy Token
            </Button>

            <Separator />

            <div className="space-y-2">
              <Label>Enrollment Command</Label>
              <div className="p-3 bg-muted rounded-lg font-mono text-xs break-all">
                termix-agent enroll --token "{newToken?.token}" --server
                YOUR_SERVER:30007
              </div>
              <Button
                onClick={copyEnrollCommand}
                variant="outline"
                className="w-full"
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Command
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setShowTokenDialog(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// AGENTS MANAGER
// ============================================================================

export function AgentsManager() {
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchAgents = async () => {
    try {
      const data = await getAgents();
      setAgents(data);
    } catch (err) {
      toast.error("Failed to fetch agents");
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (agent: Agent) => {
    confirmWithToast(
      `Revoke agent "${agent.hostname || agent.deviceId}"? This will disconnect and deauthorize the agent.`,
      async () => {
        try {
          await revokeAgent(agent.id);
          toast.success("Agent revoked");
          fetchAgents();
        } catch (err) {
          toast.error("Failed to revoke agent");
        }
      },
      "destructive"
    );
  };

  const formatLastSeen = (timestamp: string | null) => {
    if (!timestamp) return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getPlatformIcon = (platform: string | null) => {
    switch (platform) {
      case "darwin":
        return "\uD83C\uDF4E"; // Apple emoji
      case "linux":
        return "\uD83D\uDC27"; // Penguin emoji
      case "windows":
        return "\uD83E\uDE9F"; // Window emoji
      default:
        return "\uD83D\uDCBB"; // Computer emoji
    }
  };

  const onlineCount = agents.filter((a) => a.status === "online").length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Registered Agents</h3>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            {onlineCount} online / {agents.length} total
          </Badge>
          <Button variant="ghost" size="icon" onClick={fetchAgents}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Agents that have been enrolled and can connect to this server.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Platform</TableHead>
            <TableHead>Features</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Seen</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((agent) => (
            <TableRow key={agent.id}>
              <TableCell>
                <div>
                  <div className="font-medium">
                    {agent.hostname || agent.deviceId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {agent.folder && <span>{agent.folder} / </span>}
                    {agent.tags.length > 0 && agent.tags.join(", ")}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span>{getPlatformIcon(agent.platform)}</span>
                  <span className="text-sm">{agent.os || agent.platform}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  {agent.enableTerminal && (
                    <Terminal
                      className="h-4 w-4 text-muted-foreground"
                      title="Terminal"
                    />
                  )}
                  {agent.enableFileManager && (
                    <FolderOpen
                      className="h-4 w-4 text-muted-foreground"
                      title="File Manager"
                    />
                  )}
                  {agent.enableTunnels && (
                    <Network
                      className="h-4 w-4 text-muted-foreground"
                      title="Tunnels"
                    />
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant={agent.status === "online" ? "default" : "secondary"}
                >
                  {agent.status}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {formatLastSeen(agent.lastSeenAt)}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRevoke(agent)}
                  className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {agents.length === 0 && !loading && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                No agents registered yet
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
