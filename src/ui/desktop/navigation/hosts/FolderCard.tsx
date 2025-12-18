import React, { useState } from "react";
import { CardTitle } from "@/components/ui/card.tsx";
import {
  ChevronDown,
  Folder,
  Server,
  Cloud,
  Database,
  Box,
  Package,
  Layers,
  Archive,
  HardDrive,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Host } from "@/ui/desktop/navigation/hosts/Host.tsx";
import { AgentHost } from "@/ui/desktop/navigation/hosts/AgentHost.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import type { Agent } from "@/ui/main-axios";

interface SSHHost {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: Array<{
    sourcePort: number;
    endpointPort: number;
    endpointHost: string;
    maxRetries: number;
    retryInterval: number;
    autoStart: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

export type FolderItem =
  | { type: "ssh"; data: SSHHost }
  | { type: "agent"; data: Agent };

interface FolderCardProps {
  folderName: string;
  hosts: SSHHost[];
  agents?: Agent[];
  isFirst: boolean;
  isLast: boolean;
  folderColor?: string;
  folderIcon?: string;
}

export function FolderCard({
  folderName,
  hosts,
  agents = [],
  folderColor,
  folderIcon,
}: FolderCardProps): React.ReactElement {
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const iconMap: Record<
    string,
    React.ComponentType<{
      size?: number;
      strokeWidth?: number;
      className?: string;
      style?: React.CSSProperties;
    }>
  > = {
    Folder,
    Server,
    Cloud,
    Database,
    Box,
    Package,
    Layers,
    Archive,
    HardDrive,
    Globe,
  };

  const FolderIcon =
    folderIcon && iconMap[folderIcon] ? iconMap[folderIcon] : Folder;

  // Combine hosts and agents into a unified list
  const items: FolderItem[] = [
    ...hosts.map((h) => ({ type: "ssh" as const, data: h })),
    ...agents.map((a) => ({ type: "agent" as const, data: a })),
  ];

  // Sort: pinned SSH hosts first, then by name
  items.sort((a, b) => {
    // SSH hosts with pin come first
    const aPin = a.type === "ssh" && a.data.pin ? 1 : 0;
    const bPin = b.type === "ssh" && b.data.pin ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;

    // Then sort by name
    const aName =
      a.type === "ssh"
        ? a.data.name || a.data.ip
        : a.data.hostname || a.data.deviceId;
    const bName =
      b.type === "ssh"
        ? b.data.name || b.data.ip
        : b.data.hostname || b.data.deviceId;
    return aName.localeCompare(bName);
  });

  return (
    <div className="bg-dark-bg-darker border-2 border-dark-border rounded-lg overflow-hidden p-0 m-0">
      <div
        className={`px-4 py-3 relative ${isExpanded ? "border-b-2" : ""} bg-dark-bg-header`}
      >
        <div className="flex gap-2 pr-10">
          <div className="flex-shrink-0 flex items-center">
            <FolderIcon
              size={16}
              strokeWidth={3}
              style={folderColor ? { color: folderColor } : undefined}
            />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="mb-0 leading-tight break-words text-md">
              {folderName}
            </CardTitle>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-[28px] h-[28px] absolute right-4 top-1/2 -translate-y-1/2 flex-shrink-0"
          onClick={toggleExpanded}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isExpanded ? "" : "rotate-180"}`}
          />
        </Button>
      </div>
      {isExpanded && (
        <div className="flex flex-col p-2 gap-y-3">
          {items.map((item, index) => (
            <React.Fragment
              key={
                item.type === "ssh"
                  ? `${folderName}-host-${item.data.id}-${item.data.name || item.data.ip}`
                  : `${folderName}-agent-${item.data.id}-${item.data.hostname || item.data.deviceId}`
              }
            >
              {item.type === "ssh" ? (
                <Host host={item.data} />
              ) : (
                <AgentHost agent={item.data} />
              )}
              {index < items.length - 1 && (
                <div className="relative -mx-2">
                  <Separator className="p-0.25 absolute inset-x-0" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
