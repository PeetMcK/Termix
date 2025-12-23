import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import {
  File,
  Folder,
  Link,
  Calculator,
  Loader2,
} from "lucide-react";
import { getAgentDirStats } from "@/ui/main-axios";

interface FileItem {
  name: string;
  type: "file" | "directory" | "link";
  path: string;
  size?: number;
  modified?: string;
  permissions?: string;
  owner?: string;
  group?: string;
  linkTarget?: string;
}

interface PropertiesDialogProps {
  file: FileItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSavePermissions?: (file: FileItem, permissions: string) => Promise<void>;
  agentId?: string;
  sshSessionId?: string;
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "--";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[i]}`;
}

function formatBytes(bytes: number): string {
  return bytes.toLocaleString() + " bytes";
}

function formatDate(dateString?: string): string {
  if (!dateString) return "--";
  try {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

function getFileTypeLabel(file: FileItem, t: (key: string) => string): string {
  if (file.type === "directory") return t("fileManager.folder");
  if (file.type === "link") return t("fileManager.symbolicLink");

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return t("fileManager.file");

  const typeMap: Record<string, string> = {
    txt: "Text Document",
    md: "Markdown Document",
    pdf: "PDF Document",
    doc: "Word Document",
    docx: "Word Document",
    xls: "Excel Spreadsheet",
    xlsx: "Excel Spreadsheet",
    ppt: "PowerPoint Presentation",
    pptx: "PowerPoint Presentation",
    jpg: "JPEG Image",
    jpeg: "JPEG Image",
    png: "PNG Image",
    gif: "GIF Image",
    svg: "SVG Image",
    mp3: "MP3 Audio",
    mp4: "MP4 Video",
    mov: "QuickTime Video",
    zip: "ZIP Archive",
    tar: "TAR Archive",
    gz: "GZip Archive",
    js: "JavaScript File",
    ts: "TypeScript File",
    jsx: "React JSX File",
    tsx: "React TSX File",
    py: "Python File",
    go: "Go File",
    rs: "Rust File",
    json: "JSON File",
    xml: "XML File",
    html: "HTML File",
    css: "CSS File",
    sh: "Shell Script",
  };

  return typeMap[ext] || `${ext.toUpperCase()} File`;
}

const parsePermissions = (
  perms: string
): { owner: number; group: number; other: number } => {
  if (!perms) {
    return { owner: 0, group: 0, other: 0 };
  }

  if (/^\d{3,4}$/.test(perms)) {
    const numStr = perms.slice(-3);
    return {
      owner: parseInt(numStr[0] || "0", 10),
      group: parseInt(numStr[1] || "0", 10),
      other: parseInt(numStr[2] || "0", 10),
    };
  }

  const cleanPerms = perms.replace(/^-/, "").substring(0, 9);

  const calcBits = (str: string): number => {
    let value = 0;
    if (str[0] === "r") value += 4;
    if (str[1] === "w") value += 2;
    if (str[2] === "x") value += 1;
    return value;
  };

  return {
    owner: calcBits(cleanPerms.substring(0, 3)),
    group: calcBits(cleanPerms.substring(3, 6)),
    other: calcBits(cleanPerms.substring(6, 9)),
  };
};

const toOctal = (owner: number, group: number, other: number): string => {
  return `${owner}${group}${other}`;
};

const toSymbolic = (owner: number, group: number, other: number): string => {
  const bits = (val: number) =>
    (val & 4 ? "r" : "-") + (val & 2 ? "w" : "-") + (val & 1 ? "x" : "-");
  return bits(owner) + bits(group) + bits(other);
};

export function PropertiesDialog({
  file,
  open,
  onOpenChange,
  onSavePermissions,
  agentId,
}: PropertiesDialogProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [calculatingSize, setCalculatingSize] = useState(false);
  const [dirStats, setDirStats] = useState<{
    totalSize: number;
    fileCount: number;
    folderCount: number;
  } | null>(null);

  // Permission states
  const initialPerms = parsePermissions(file?.permissions || "644");
  const [ownerRead, setOwnerRead] = useState((initialPerms.owner & 4) !== 0);
  const [ownerWrite, setOwnerWrite] = useState((initialPerms.owner & 2) !== 0);
  const [ownerExecute, setOwnerExecute] = useState((initialPerms.owner & 1) !== 0);

  const [groupRead, setGroupRead] = useState((initialPerms.group & 4) !== 0);
  const [groupWrite, setGroupWrite] = useState((initialPerms.group & 2) !== 0);
  const [groupExecute, setGroupExecute] = useState((initialPerms.group & 1) !== 0);

  const [otherRead, setOtherRead] = useState((initialPerms.other & 4) !== 0);
  const [otherWrite, setOtherWrite] = useState((initialPerms.other & 2) !== 0);
  const [otherExecute, setOtherExecute] = useState((initialPerms.other & 1) !== 0);

  // Reset states when file changes
  useEffect(() => {
    if (file) {
      const perms = parsePermissions(file.permissions || "644");
      setOwnerRead((perms.owner & 4) !== 0);
      setOwnerWrite((perms.owner & 2) !== 0);
      setOwnerExecute((perms.owner & 1) !== 0);
      setGroupRead((perms.group & 4) !== 0);
      setGroupWrite((perms.group & 2) !== 0);
      setGroupExecute((perms.group & 1) !== 0);
      setOtherRead((perms.other & 4) !== 0);
      setOtherWrite((perms.other & 2) !== 0);
      setOtherExecute((perms.other & 1) !== 0);
      setDirStats(null);
    }
  }, [file]);

  const calculateOctal = (): string => {
    const owner = (ownerRead ? 4 : 0) + (ownerWrite ? 2 : 0) + (ownerExecute ? 1 : 0);
    const group = (groupRead ? 4 : 0) + (groupWrite ? 2 : 0) + (groupExecute ? 1 : 0);
    const other = (otherRead ? 4 : 0) + (otherWrite ? 2 : 0) + (otherExecute ? 1 : 0);
    return toOctal(owner, group, other);
  };

  const handleSave = async () => {
    if (!file || !onSavePermissions) return;

    setLoading(true);
    try {
      const permissions = calculateOctal();
      await onSavePermissions(file, permissions);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to update permissions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateSize = async () => {
    if (!file || !agentId) return;

    setCalculatingSize(true);
    try {
      const stats = await getAgentDirStats(agentId, file.path);
      setDirStats(stats);
    } catch (error) {
      console.error("Failed to calculate directory size:", error);
    } finally {
      setCalculatingSize(false);
    }
  };

  if (!file) return null;

  const isDirectory = file.type === "directory";
  const octal = calculateOctal();
  const symbolic = toSymbolic(
    (ownerRead ? 4 : 0) + (ownerWrite ? 2 : 0) + (ownerExecute ? 1 : 0),
    (groupRead ? 4 : 0) + (groupWrite ? 2 : 0) + (groupExecute ? 1 : 0),
    (otherRead ? 4 : 0) + (otherWrite ? 2 : 0) + (otherExecute ? 1 : 0)
  );
  const parentPath = file.path.substring(0, file.path.lastIndexOf("/")) || "/";

  const FileIcon = file.type === "directory" ? Folder : file.type === "link" ? Link : File;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-dark-bg border-2 border-dark-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("fileManager.properties")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File Header */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
            <FileIcon className="w-10 h-10 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {getFileTypeLabel(file, t)}
              </p>
            </div>
          </div>

          {/* General Section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {t("fileManager.general")}
            </h3>
            <Separator className="mb-3" />
            <div className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
              <span className="text-muted-foreground">{t("fileManager.type")}:</span>
              <span>{file.type === "directory" ? t("fileManager.folder") : file.type === "link" ? t("fileManager.symbolicLink") : t("fileManager.file")}</span>

              <span className="text-muted-foreground">{t("fileManager.location")}:</span>
              <span className="truncate font-mono text-xs">{parentPath}</span>

              <span className="text-muted-foreground">{t("fileManager.size")}:</span>
              <span>
                {isDirectory ? (
                  dirStats ? (
                    <>
                      {formatFileSize(dirStats.totalSize)} ({formatBytes(dirStats.totalSize)})
                    </>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )
                ) : (
                  <>
                    {formatFileSize(file.size)}
                    {file.size !== undefined && file.size > 1024 && (
                      <span className="text-muted-foreground ml-1">
                        ({formatBytes(file.size)})
                      </span>
                    )}
                  </>
                )}
              </span>

              {isDirectory && (
                <>
                  <span className="text-muted-foreground">{t("fileManager.contains")}:</span>
                  <span>
                    {dirStats ? (
                      <>
                        {dirStats.fileCount.toLocaleString()} {t("fileManager.files")}, {dirStats.folderCount.toLocaleString()} {t("fileManager.folders")}
                      </>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </span>
                </>
              )}

              {file.type === "link" && file.linkTarget && (
                <>
                  <span className="text-muted-foreground">{t("fileManager.target")}:</span>
                  <span className="truncate font-mono text-xs">{file.linkTarget}</span>
                </>
              )}
            </div>

            {isDirectory && agentId && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleCalculateSize}
                disabled={calculatingSize}
              >
                {calculatingSize ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("fileManager.calculating")}
                  </>
                ) : (
                  <>
                    <Calculator className="w-4 h-4 mr-2" />
                    {t("fileManager.calculateSize")}
                  </>
                )}
              </Button>
            )}
          </div>

          {/* Timestamps Section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {t("fileManager.timestamps")}
            </h3>
            <Separator className="mb-3" />
            <div className="grid grid-cols-[100px_1fr] gap-y-2 text-sm">
              <span className="text-muted-foreground">{t("fileManager.modified")}:</span>
              <span>{formatDate(file.modified)}</span>
            </div>
          </div>

          {/* Permissions Section */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {t("fileManager.permissions")}
            </h3>
            <Separator className="mb-3" />

            <div className="flex items-center gap-4 mb-4 text-sm">
              <span className="text-muted-foreground">{t("fileManager.current")}:</span>
              <span className="font-mono">-{symbolic}</span>
              <span className="font-mono text-muted-foreground">({octal})</span>
            </div>

            {/* Owner */}
            <div className="space-y-2 mb-3">
              <Label className="text-sm font-medium">
                {t("fileManager.owner")} {file.owner && <span className="text-muted-foreground">({file.owner})</span>}
              </Label>
              <div className="flex gap-6 ml-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="owner-read"
                    checked={ownerRead}
                    onCheckedChange={(checked) => setOwnerRead(checked === true)}
                  />
                  <label htmlFor="owner-read" className="text-sm cursor-pointer">
                    {t("fileManager.read")}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="owner-write"
                    checked={ownerWrite}
                    onCheckedChange={(checked) => setOwnerWrite(checked === true)}
                  />
                  <label htmlFor="owner-write" className="text-sm cursor-pointer">
                    {t("fileManager.write")}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="owner-execute"
                    checked={ownerExecute}
                    onCheckedChange={(checked) => setOwnerExecute(checked === true)}
                  />
                  <label htmlFor="owner-execute" className="text-sm cursor-pointer">
                    {t("fileManager.execute")}
                  </label>
                </div>
              </div>
            </div>

            {/* Group */}
            <div className="space-y-2 mb-3">
              <Label className="text-sm font-medium">
                {t("fileManager.group")} {file.group && <span className="text-muted-foreground">({file.group})</span>}
              </Label>
              <div className="flex gap-6 ml-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="group-read"
                    checked={groupRead}
                    onCheckedChange={(checked) => setGroupRead(checked === true)}
                  />
                  <label htmlFor="group-read" className="text-sm cursor-pointer">
                    {t("fileManager.read")}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="group-write"
                    checked={groupWrite}
                    onCheckedChange={(checked) => setGroupWrite(checked === true)}
                  />
                  <label htmlFor="group-write" className="text-sm cursor-pointer">
                    {t("fileManager.write")}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="group-execute"
                    checked={groupExecute}
                    onCheckedChange={(checked) => setGroupExecute(checked === true)}
                  />
                  <label htmlFor="group-execute" className="text-sm cursor-pointer">
                    {t("fileManager.execute")}
                  </label>
                </div>
              </div>
            </div>

            {/* Others */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("fileManager.others")}</Label>
              <div className="flex gap-6 ml-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="other-read"
                    checked={otherRead}
                    onCheckedChange={(checked) => setOtherRead(checked === true)}
                  />
                  <label htmlFor="other-read" className="text-sm cursor-pointer">
                    {t("fileManager.read")}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="other-write"
                    checked={otherWrite}
                    onCheckedChange={(checked) => setOtherWrite(checked === true)}
                  />
                  <label htmlFor="other-write" className="text-sm cursor-pointer">
                    {t("fileManager.write")}
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="other-execute"
                    checked={otherExecute}
                    onCheckedChange={(checked) => setOtherExecute(checked === true)}
                  />
                  <label htmlFor="other-execute" className="text-sm cursor-pointer">
                    {t("fileManager.execute")}
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {t("common.cancel")}
          </Button>
          {onSavePermissions && (
            <Button onClick={handleSave} disabled={loading}>
              {loading ? t("common.saving") : t("fileManager.savePermissions")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
