import React, { useState, useEffect, useRef, useCallback } from "react";
import { FileManagerGrid } from "./FileManagerGrid";
import { FileManagerContextMenu } from "./FileManagerContextMenu";
import { AgentFileManagerSidebar } from "./AgentFileManagerSidebar";
import { useFileSelection } from "./hooks/useFileSelection";
import { useDragAndDrop } from "./hooks/useDragAndDrop";
import { WindowManager, useWindowManager } from "./components/WindowManager";
import { FileWindow } from "./components/FileWindow";
import { useConfirmation } from "@/hooks/use-confirmation.ts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CompressDialog } from "./components/CompressDialog";
import {
  Upload,
  FolderPlus,
  FilePlus,
  RefreshCw,
  Search,
  Grid3X3,
  List,
} from "lucide-react";
import type { AgentConfig, FileItem } from "../../../types/index.js";
import {
  listAgentFiles,
  uploadAgentFile,
  createAgentFile,
  createAgentFolder,
  deleteAgentItem,
  copyAgentItem,
  moveAgentItem,
  renameAgentItem,
  getAgentStreamUrl,
} from "@/ui/main-axios.ts";

interface AgentFileManagerProps {
  agentConfig: AgentConfig;
  onClose?: () => void;
}

interface CreateIntent {
  id: string;
  type: "file" | "directory";
  defaultName: string;
  currentName: string;
}

function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formattedSize =
    size < 10 && unitIndex > 0 ? size.toFixed(1) : Math.round(size).toString();
  return `${formattedSize} ${units[unitIndex]}`;
}

function AgentFileManagerContent({ agentConfig, onClose }: AgentFileManagerProps) {
  const { openWindow } = useWindowManager();
  const { t } = useTranslation();
  const { confirmWithToast } = useConfirmation();

  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    const saved = localStorage.getItem("fileManagerViewMode");
    return saved === "grid" || saved === "list" ? saved : "grid";
  });

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    isVisible: boolean;
    files: FileItem[];
  }>({
    x: 0,
    y: 0,
    isVisible: false,
    files: [],
  });

  const [clipboard, setClipboard] = useState<{
    files: FileItem[];
    operation: "copy" | "cut";
  } | null>(null);

  const [createIntent, setCreateIntent] = useState<CreateIntent | null>(null);
  const [editingFile, setEditingFile] = useState<FileItem | null>(null);
  const [compressDialogFiles, setCompressDialogFiles] = useState<FileItem[]>([]);

  const { selectedFiles, clearSelection, setSelection } = useFileSelection();

  const { dragHandlers } = useDragAndDrop({
    onFilesDropped: handleFilesDropped,
    onError: (error) => toast.error(error),
    maxFileSize: 5120,
  });

  const initialLoadDoneRef = useRef(false);
  const currentLoadingPathRef = useRef<string>("");

  const loadDirectory = useCallback(
    async (path: string) => {
      if (isLoading && currentLoadingPathRef.current !== path) {
        return;
      }

      currentLoadingPathRef.current = path;
      setIsLoading(true);
      setCreateIntent(null);

      try {
        const response = await listAgentFiles(agentConfig.id, path);

        if (currentLoadingPathRef.current !== path) {
          return;
        }

        // Transform agent file items to FileItem format
        const fileItems: FileItem[] = (response.files || []).map((f) => ({
          name: f.name,
          path: f.path,
          type: f.type as "file" | "directory" | "link",
          size: f.size,
          modTime: f.modTime,
          permissions: f.permissions,
          owner: f.owner,
          group: f.group,
          executable: f.executable,
          linkTarget: f.linkTarget,
        }));

        setFiles(fileItems);
        clearSelection();
      } catch (error: unknown) {
        if (currentLoadingPathRef.current === path) {
          console.error("Failed to load directory:", error);
          const err = error as { message?: string };
          toast.error(
            t("fileManager.failedToLoadDirectory") + ": " + (err.message || error)
          );
        }
      } finally {
        if (currentLoadingPathRef.current === path) {
          setIsLoading(false);
          currentLoadingPathRef.current = "";
        }
      }
    },
    [agentConfig.id, isLoading, clearSelection, t]
  );

  useEffect(() => {
    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      loadDirectory(currentPath);
    }
  }, []);

  useEffect(() => {
    if (initialLoadDoneRef.current) {
      loadDirectory(currentPath);
    }
  }, [currentPath]);

  const handleRefreshDirectory = useCallback(() => {
    const now = Date.now();
    const DEBOUNCE_MS = 500;

    if (now - lastRefreshTime < DEBOUNCE_MS) {
      return;
    }

    setLastRefreshTime(now);
    loadDirectory(currentPath);
  }, [currentPath, lastRefreshTime, loadDirectory]);

  function handleFilesDropped(fileList: FileList) {
    Array.from(fileList).forEach((file) => {
      handleUploadFile(file);
    });
  }

  async function handleUploadFile(file: File) {
    const progressToast = toast.loading(
      t("fileManager.uploadingFile", {
        name: file.name,
        size: formatFileSize(file.size),
      }),
      { duration: Infinity }
    );

    try {
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);

        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) {
            const bytes = new Uint8Array(reader.result);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            resolve(base64);
          } else {
            reject(new Error("Failed to read file"));
          }
        };
        reader.readAsArrayBuffer(file);
      });

      await uploadAgentFile(agentConfig.id, currentPath, file.name, fileContent);

      toast.dismiss(progressToast);
      toast.success(t("fileManager.fileUploadedSuccessfully", { name: file.name }));
      handleRefreshDirectory();
    } catch (error: unknown) {
      toast.dismiss(progressToast);
      const err = error as { message?: string };
      toast.error(t("fileManager.failedToUploadFile") + ": " + (err.message || ""));
      console.error("Upload failed:", error);
    }
  }

  async function handleDownloadFile(file: FileItem) {
    try {
      // Use HTTP streaming endpoint for downloads (avoids WebSocket message size limits)
      const streamUrl = getAgentStreamUrl(agentConfig.id, file.path, true);
      const link = document.createElement("a");
      link.href = streamUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(t("fileManager.fileDownloadedSuccessfully", { name: file.name }));
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(t("fileManager.failedToDownloadFile") + ": " + (err.message || ""));
      console.error("Download failed:", error);
    }
  }

  async function handleDeleteFiles(filesToDelete: FileItem[]) {
    if (filesToDelete.length === 0) return;

    let confirmMessage: string;
    if (filesToDelete.length === 1) {
      const file = filesToDelete[0];
      if (file.type === "directory") {
        confirmMessage = t("fileManager.confirmDeleteFolder", { name: file.name });
      } else {
        confirmMessage = t("fileManager.confirmDeleteSingleItem", { name: file.name });
      }
    } else {
      const hasDirectory = filesToDelete.some((file) => file.type === "directory");
      const translationKey = hasDirectory
        ? "fileManager.confirmDeleteMultipleItemsWithFolders"
        : "fileManager.confirmDeleteMultipleItems";

      confirmMessage = t(translationKey, { count: filesToDelete.length });
    }

    const fullMessage = `${confirmMessage}\n\n${t("fileManager.permanentDeleteWarning")}`;

    confirmWithToast(
      fullMessage,
      async () => {
        try {
          for (const file of filesToDelete) {
            await deleteAgentItem(agentConfig.id, file.path, file.type === "directory");
          }

          toast.success(
            t("fileManager.itemsDeletedSuccessfully", { count: filesToDelete.length })
          );
          handleRefreshDirectory();
          clearSelection();
        } catch (error: unknown) {
          const err = error as { message?: string };
          toast.error(t("fileManager.failedToDeleteItems") + ": " + (err.message || ""));
          console.error("Delete failed:", error);
        }
      },
      "destructive"
    );
  }

  function handleCreateNewFolder() {
    const defaultName = generateUniqueName(t("fileManager.newFolderDefault"), "directory");
    const newCreateIntent = {
      id: Date.now().toString(),
      type: "directory" as const,
      defaultName,
      currentName: defaultName,
    };
    setCreateIntent(newCreateIntent);
  }

  function handleCreateNewFile() {
    const defaultName = generateUniqueName(t("fileManager.newFileDefault"), "file");
    const newCreateIntent = {
      id: Date.now().toString(),
      type: "file" as const,
      defaultName,
      currentName: defaultName,
    };
    setCreateIntent(newCreateIntent);
  }

  async function handleFileOpen(file: FileItem) {
    if (file.type === "directory") {
      setCurrentPath(file.path);
    } else {
      // Check if file is a video
      const videoExtensions = ["mp4", "avi", "mov", "wmv", "flv", "mkv", "webm", "m4v"];
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const isVideo = videoExtensions.includes(extension);

      let windowWidth: number;
      let windowHeight: number;
      let offsetX: number;
      let offsetY: number;

      if (isVideo) {
        // Video files: 1/4 canvas size, positioned in lower right
        windowWidth = Math.floor(window.innerWidth / 2);
        windowHeight = Math.floor(window.innerHeight / 2);
        offsetX = Math.floor(window.innerWidth / 2);
        offsetY = Math.floor(window.innerHeight / 2);
      } else {
        // Other files: default sizing with cascading position
        windowWidth = 800;
        windowHeight = 600;
        const windowCount = Date.now() % 10;
        const baseOffsetX = 120 + windowCount * 30;
        const baseOffsetY = 120 + windowCount * 30;
        const maxOffsetX = Math.max(0, window.innerWidth - windowWidth - 100);
        const maxOffsetY = Math.max(0, window.innerHeight - windowHeight - 100);
        offsetX = Math.min(baseOffsetX, maxOffsetX);
        offsetY = Math.min(baseOffsetY, maxOffsetY);
      }

      const createWindowComponent = (windowId: string) => (
        <FileWindow
          windowId={windowId}
          file={file}
          sshSessionId={`agent:${agentConfig.id}`}
          sshHost={null}
          initialX={offsetX}
          initialY={offsetY}
          agentId={agentConfig.id}
        />
      );

      openWindow({
        title: file.name,
        x: offsetX,
        y: offsetY,
        width: windowWidth,
        height: windowHeight,
        isMaximized: false,
        isMinimized: false,
        component: createWindowComponent,
      });
    }
  }

  function handleContextMenu(event: React.MouseEvent, file?: FileItem) {
    event.preventDefault();

    let contextFiles: FileItem[];
    if (file) {
      const isFileSelected = selectedFiles.some((f) => f.path === file.path);
      contextFiles = isFileSelected ? selectedFiles : [file];
    } else {
      contextFiles = selectedFiles;
    }

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      isVisible: true,
      files: contextFiles,
    });
  }

  function handleCopyFiles(filesToCopy: FileItem[]) {
    setClipboard({ files: filesToCopy, operation: "copy" });
    toast.success(t("fileManager.filesCopiedToClipboard", { count: filesToCopy.length }));
  }

  function handleCutFiles(filesToCut: FileItem[]) {
    setClipboard({ files: filesToCut, operation: "cut" });
    toast.success(t("fileManager.filesCutToClipboard", { count: filesToCut.length }));
  }

  function handleCopyPath(filesToCopy: FileItem[]) {
    if (filesToCopy.length === 0) return;

    const paths = filesToCopy.map((file) => file.path).join("\n");

    navigator.clipboard.writeText(paths).then(
      () => {
        toast.success(
          filesToCopy.length === 1
            ? t("fileManager.pathCopiedToClipboard")
            : t("fileManager.pathsCopiedToClipboard", { count: filesToCopy.length })
        );
      },
      (err) => {
        console.error("Failed to copy path to clipboard:", err);
        toast.error(t("fileManager.failedToCopyPath"));
      }
    );
  }

  async function handlePasteFiles() {
    if (!clipboard) return;

    try {
      const { files: clipboardFiles, operation } = clipboard;
      let successCount = 0;
      const copiedItems: string[] = [];

      for (const file of clipboardFiles) {
        try {
          if (operation === "copy") {
            const result = await copyAgentItem(agentConfig.id, file.path, currentPath);
            copiedItems.push(result.uniqueName || file.name);
            successCount++;
          } else {
            const targetPath = currentPath.endsWith("/")
              ? `${currentPath}${file.name}`
              : `${currentPath}/${file.name}`;

            if (file.path !== targetPath) {
              await moveAgentItem(agentConfig.id, file.path, targetPath);
              successCount++;
            }
          }
        } catch (error: unknown) {
          console.error(`Failed to ${operation} file ${file.name}:`, error);
          const err = error as { message?: string };
          toast.error(
            t("fileManager.operationFailed", {
              operation: operation === "copy" ? t("fileManager.copy") : t("fileManager.move"),
              name: file.name,
              error: err.message,
            })
          );
        }
      }

      if (successCount > 0) {
        const operationText =
          operation === "copy" ? t("fileManager.copy") : t("fileManager.move");
        toast.success(
          t("fileManager.operationCompleted", { operation: operationText, count: successCount })
        );
      }

      handleRefreshDirectory();
      clearSelection();

      if (operation === "cut") {
        setClipboard(null);
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      toast.error(
        `${t("fileManager.pasteFailed")}: ${err.message || t("fileManager.unknownError")}`
      );
    }
  }

  function handleRenameFile(file: FileItem) {
    setEditingFile(file);
  }

  async function handleConfirmCreate(name: string) {
    if (!createIntent) return;

    try {
      if (createIntent.type === "file") {
        await createAgentFile(agentConfig.id, currentPath, name, "");
        toast.success(t("fileManager.fileCreatedSuccessfully", { name }));
      } else {
        await createAgentFolder(agentConfig.id, currentPath, name);
        toast.success(t("fileManager.folderCreatedSuccessfully", { name }));
      }

      setCreateIntent(null);
      handleRefreshDirectory();
    } catch (error: unknown) {
      console.error("Create failed:", error);
      toast.error(t("fileManager.failedToCreateItem"));
    }
  }

  function handleCancelCreate() {
    setCreateIntent(null);
  }

  async function handleRenameConfirm(file: FileItem, newName: string) {
    try {
      await renameAgentItem(agentConfig.id, file.path, newName);

      toast.success(t("fileManager.itemRenamedSuccessfully", { name: newName }));
      setEditingFile(null);
      handleRefreshDirectory();
    } catch (error: unknown) {
      console.error("Rename failed:", error);
      toast.error(t("fileManager.failedToRenameItem"));
    }
  }

  function handleStartEdit(file: FileItem) {
    setEditingFile(file);
  }

  function handleCancelEdit() {
    setEditingFile(null);
  }

  function generateUniqueName(baseName: string, type: "file" | "directory"): string {
    const existingNames = files.map((f) => f.name.toLowerCase());
    let candidateName = baseName;
    let counter = 1;

    while (existingNames.includes(candidateName.toLowerCase())) {
      if (type === "file" && baseName.includes(".")) {
        const lastDotIndex = baseName.lastIndexOf(".");
        const nameWithoutExt = baseName.substring(0, lastDotIndex);
        const extension = baseName.substring(lastDotIndex);
        candidateName = `${nameWithoutExt}${counter}${extension}`;
      } else {
        candidateName = `${baseName}${counter}`;
      }
      counter++;
    }

    return candidateName;
  }

  async function handleFileDrop(draggedFiles: FileItem[], targetFolder: FileItem) {
    if (targetFolder.type !== "directory") return;

    try {
      let successCount = 0;

      for (const file of draggedFiles) {
        try {
          const targetPath = targetFolder.path.endsWith("/")
            ? `${targetFolder.path}${file.name}`
            : `${targetFolder.path}/${file.name}`;

          if (file.path !== targetPath) {
            await moveAgentItem(agentConfig.id, file.path, targetPath);
            successCount++;
          }
        } catch (error: unknown) {
          console.error(`Failed to move file ${file.name}:`, error);
          const err = error as { message?: string };
          toast.error(
            t("fileManager.moveFileFailed", { name: file.name }) + ": " + err.message
          );
        }
      }

      if (successCount > 0) {
        toast.success(
          t("fileManager.successfullyMovedItems", {
            count: successCount,
            target: targetFolder.name,
          })
        );
        handleRefreshDirectory();
        clearSelection();
      }
    } catch (error: unknown) {
      console.error("Drag move operation failed:", error);
      const err = error as { message?: string };
      toast.error(t("fileManager.moveOperationFailed") + ": " + err.message);
    }
  }

  useEffect(() => {
    setCreateIntent(null);
  }, [currentPath]);

  useEffect(() => {
    localStorage.setItem("fileManagerViewMode", viewMode);
  }, [viewMode]);

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const agentName = agentConfig.hostname || agentConfig.deviceId;

  return (
    <div className="h-full flex flex-col bg-dark-bg">
      <div className="flex-shrink-0 border-b border-dark-border">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-white">{agentName}</h2>
            <span className="text-sm text-muted-foreground">(Agent)</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("fileManager.searchFiles")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-48 h-9 bg-dark-bg-button border-dark-border"
              />
            </div>

            <div className="flex border border-dark-border rounded-md">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                className="rounded-r-none h-9"
              >
                <Grid3X3 className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                className="rounded-l-none h-9"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.onchange = (e) => {
                  const uploadFiles = (e.target as HTMLInputElement).files;
                  if (uploadFiles) handleFilesDropped(uploadFiles);
                };
                input.click();
              }}
              className="h-9"
            >
              <Upload className="w-4 h-4 mr-2" />
              {t("fileManager.upload")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateNewFolder}
              className="h-9"
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              {t("fileManager.newFolder")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateNewFile}
              className="h-9"
            >
              <FilePlus className="w-4 h-4 mr-2" />
              {t("fileManager.newFile")}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshDirectory}
              className="h-9"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex" {...dragHandlers}>
        <div className="w-64 flex-shrink-0 h-full">
          <AgentFileManagerSidebar
            agentId={agentConfig.id}
            currentPath={currentPath}
            onPathChange={setCurrentPath}
          />
        </div>

        <div className="flex-1 relative">
          <FileManagerGrid
            files={filteredFiles}
            selectedFiles={selectedFiles}
            onFileSelect={() => {}}
            onFileOpen={handleFileOpen}
            onSelectionChange={setSelection}
            currentPath={currentPath}
            isLoading={isLoading}
            onPathChange={setCurrentPath}
            onRefresh={handleRefreshDirectory}
            onUpload={handleFilesDropped}
            onDownload={(downloadFiles) => downloadFiles.forEach(handleDownloadFile)}
            onContextMenu={handleContextMenu}
            viewMode={viewMode}
            onRename={handleRenameConfirm}
            editingFile={editingFile}
            onStartEdit={handleStartEdit}
            onCancelEdit={handleCancelEdit}
            onDelete={handleDeleteFiles}
            onCopy={handleCopyFiles}
            onCut={handleCutFiles}
            onPaste={handlePasteFiles}
            onUndo={() => {}}
            hasClipboard={!!clipboard}
            onFileDrop={handleFileDrop}
            onFileDiff={() => {}}
            onSystemDragStart={() => {}}
            onSystemDragEnd={() => {}}
            createIntent={createIntent}
            onConfirmCreate={handleConfirmCreate}
            onCancelCreate={handleCancelCreate}
            onNewFile={handleCreateNewFile}
            onNewFolder={handleCreateNewFolder}
          />

          <FileManagerContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            files={contextMenu.files}
            isVisible={contextMenu.isVisible}
            onClose={() => setContextMenu((prev) => ({ ...prev, isVisible: false }))}
            onDownload={(downloadFiles) => downloadFiles.forEach(handleDownloadFile)}
            onRename={handleRenameFile}
            onCopy={handleCopyFiles}
            onCut={handleCutFiles}
            onPaste={handlePasteFiles}
            onDelete={handleDeleteFiles}
            onUpload={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.multiple = true;
              input.onchange = (e) => {
                const uploadFiles = (e.target as HTMLInputElement).files;
                if (uploadFiles) handleFilesDropped(uploadFiles);
              };
              input.click();
            }}
            onNewFolder={handleCreateNewFolder}
            onNewFile={handleCreateNewFile}
            onRefresh={handleRefreshDirectory}
            hasClipboard={!!clipboard}
            onDragToDesktop={() => {}}
            onOpenTerminal={() => {}}
            onRunExecutable={() => {}}
            onPinFile={() => {}}
            onUnpinFile={() => {}}
            onAddShortcut={() => {}}
            isPinned={() => false}
            currentPath={currentPath}
            onProperties={() => {}}
            onExtractArchive={() => {}}
            onCompress={() => setCompressDialogFiles(contextMenu.files)}
            onCopyPath={handleCopyPath}
          />
        </div>
      </div>

      <CompressDialog
        open={compressDialogFiles.length > 0}
        onOpenChange={(open) => !open && setCompressDialogFiles([])}
        fileNames={compressDialogFiles.map((f) => f.name)}
        onCompress={() => {
          toast.info("Compression not yet supported for agents");
          setCompressDialogFiles([]);
        }}
      />
    </div>
  );
}

export function AgentFileManager({ agentConfig, onClose }: AgentFileManagerProps) {
  return (
    <WindowManager>
      <AgentFileManagerContent agentConfig={agentConfig} onClose={onClose} />
    </WindowManager>
  );
}
