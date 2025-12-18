import React, { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Home,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { listAgentFiles } from "@/ui/main-axios.ts";

export interface SidebarItem {
  id: string;
  name: string;
  path: string;
  isExpanded?: boolean;
  children?: SidebarItem[];
  isLoading?: boolean;
}

interface AgentFileManagerSidebarProps {
  agentId: string;
  currentPath: string;
  onPathChange: (path: string) => void;
}

export function AgentFileManagerSidebar({
  agentId,
  currentPath,
  onPathChange,
}: AgentFileManagerSidebarProps) {
  const { t } = useTranslation();
  const [directoryTree, setDirectoryTree] = useState<SidebarItem[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["root"])
  );
  const [loadingFolders, setLoadingFolders] = useState<Set<string>>(new Set());

  // Load root directory tree on mount
  useEffect(() => {
    loadDirectoryTree();
  }, [agentId]);

  // Auto-expand folders in current path
  useEffect(() => {
    if (currentPath && currentPath !== "/") {
      const pathParts = currentPath.split("/").filter(Boolean);
      const newExpanded = new Set(expandedFolders);
      newExpanded.add("root");

      let buildPath = "";
      for (const part of pathParts) {
        buildPath += "/" + part;
        const folderId = `folder-${buildPath.replace(/\//g, "-")}`;
        newExpanded.add(folderId);
      }
      setExpandedFolders(newExpanded);
    }
  }, [currentPath]);

  const loadDirectoryTree = async () => {
    try {
      const response = await listAgentFiles(agentId, "/");
      const rootFiles = response.files || [];
      const rootFolders = rootFiles.filter((item) => item.type === "directory");

      const rootTreeItems: SidebarItem[] = rootFolders.map((folder) => ({
        id: `folder-${folder.path.replace(/\//g, "-")}`,
        name: folder.name,
        path: folder.path,
        isExpanded: false,
        children: [],
      }));

      setDirectoryTree([
        {
          id: "root",
          name: "/",
          path: "/",
          isExpanded: true,
          children: rootTreeItems,
        },
      ]);
    } catch (error) {
      console.error("Failed to load directory tree:", error);
      setDirectoryTree([
        {
          id: "root",
          name: "/",
          path: "/",
          isExpanded: false,
          children: [],
        },
      ]);
    }
  };

  const loadSubdirectory = useCallback(async (folderPath: string, folderId: string) => {
    if (loadingFolders.has(folderId)) return;

    setLoadingFolders((prev) => new Set([...prev, folderId]));

    try {
      const response = await listAgentFiles(agentId, folderPath);
      const subFiles = response.files || [];
      const subFolders = subFiles.filter((item) => item.type === "directory");

      const subTreeItems: SidebarItem[] = subFolders.map((folder) => ({
        id: `folder-${folder.path.replace(/\//g, "-")}`,
        name: folder.name,
        path: folder.path,
        isExpanded: false,
        children: [],
      }));

      setDirectoryTree((prevTree) => {
        const updateChildren = (items: SidebarItem[]): SidebarItem[] => {
          return items.map((item) => {
            if (item.id === folderId) {
              return { ...item, children: subTreeItems, isLoading: false };
            } else if (item.children) {
              return { ...item, children: updateChildren(item.children) };
            }
            return item;
          });
        };
        return updateChildren(prevTree);
      });
    } catch (error) {
      console.error("Failed to load subdirectory:", error);
    } finally {
      setLoadingFolders((prev) => {
        const newSet = new Set(prev);
        newSet.delete(folderId);
        return newSet;
      });
    }
  }, [agentId, loadingFolders]);

  const handleItemClick = (item: SidebarItem) => {
    toggleFolder(item.id, item.path);
    onPathChange(item.path);
  };

  const toggleFolder = async (folderId: string, folderPath?: string) => {
    const newExpanded = new Set(expandedFolders);

    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);

      // Load children if not already loaded
      if (folderPath && folderPath !== "/") {
        const existingItem = findItemById(directoryTree, folderId);
        if (existingItem && (!existingItem.children || existingItem.children.length === 0)) {
          await loadSubdirectory(folderPath, folderId);
        }
      }
    }

    setExpandedFolders(newExpanded);
  };

  const findItemById = (items: SidebarItem[], id: string): SidebarItem | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const found = findItemById(item.children, id);
        if (found) return found;
      }
    }
    return null;
  };

  const renderSidebarItem = (item: SidebarItem, level: number = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const isActive = currentPath === item.path;
    const isLoading = loadingFolders.has(item.id);

    return (
      <div key={item.id}>
        <div
          className={cn(
            "flex items-center gap-2 py-1.5 text-sm cursor-pointer hover:bg-dark-hover rounded",
            isActive && "bg-primary/20 text-primary",
            "text-white"
          )}
          style={{ paddingLeft: `${12 + level * 16}px`, paddingRight: "12px" }}
          onClick={() => handleItemClick(item)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleFolder(item.id, item.path);
            }}
            className="p-0.5 hover:bg-dark-hover rounded"
          >
            {isLoading ? (
              <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>

          {item.path === "/" ? (
            <Home className="w-4 h-4" />
          ) : isExpanded ? (
            <FolderOpen className="w-4 h-4" />
          ) : (
            <Folder className="w-4 h-4" />
          )}

          <span className="truncate">{item.name}</span>
        </div>

        {isExpanded && item.children && (
          <div>
            {item.children.map((child) => renderSidebarItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-dark-bg border-r border-dark-border">
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-1.5 overflow-y-auto thin-scrollbar">
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <Folder className="w-3 h-3" />
            {t("fileManager.directories")}
          </div>
          <div className="mt-1">
            {directoryTree.map((item) => renderSidebarItem(item))}
          </div>
        </div>
      </div>
    </div>
  );
}
