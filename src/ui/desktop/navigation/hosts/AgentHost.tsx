import React from "react";
import { Status, StatusIndicator } from "@/components/ui/shadcn-io/status";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { EllipsisVertical, Terminal, Cpu, FolderOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext";
import type { Agent } from "@/ui/main-axios";

interface AgentHostProps {
  agent: Agent;
}

export function AgentHost({ agent }: AgentHostProps): React.ReactElement {
  const { addTab } = useTabs();
  const tags = Array.isArray(agent.tags) ? agent.tags : [];
  const hasTags = tags.length > 0;

  const title = agent.hostname || agent.deviceId;

  const handleTerminalClick = () => {
    addTab({
      type: "agent_terminal",
      title,
      agentConfig: agent,
    });
  };

  const handleFileManagerClick = () => {
    addTab({
      type: "agent_file_manager",
      title: `${title} - Files`,
      agentConfig: agent,
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <Status
          status={agent.status === "online" ? "online" : "offline"}
          className="!bg-transparent !p-0.75 flex-shrink-0"
        >
          <StatusIndicator />
        </Status>

        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Cpu className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          <p className="font-semibold break-words text-sm">
            {agent.hostname || agent.deviceId}
          </p>
        </div>

        <ButtonGroup className="flex-shrink-0">
          {agent.enableTerminal && (
            <Button
              variant="outline"
              className="!px-2 border-1 border-dark-border"
              onClick={handleTerminalClick}
              disabled={agent.status !== "online"}
              title={
                agent.status !== "online"
                  ? "Agent is offline"
                  : "Open terminal"
              }
            >
              <Terminal />
            </Button>
          )}

          {agent.enableFileManager && (
            <Button
              variant="outline"
              className={`!px-2 border-1 border-dark-border ${
                agent.enableTerminal ? "rounded-tl-none rounded-bl-none" : ""
              }`}
              onClick={handleFileManagerClick}
              disabled={agent.status !== "online"}
              title={
                agent.status !== "online"
                  ? "Agent is offline"
                  : "Open file manager"
              }
            >
              <FolderOpen />
            </Button>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className={`!px-2 border-1 border-dark-border ${
                  (agent.enableTerminal || agent.enableFileManager) ? "rounded-tl-none rounded-bl-none" : ""
                }`}
              >
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="start"
              side="right"
              className="w-56 bg-dark-bg border-dark-border text-white"
            >
              <DropdownMenuItem
                disabled
                className="flex items-center gap-2 px-3 py-2 text-gray-500"
              >
                <span className="text-xs">
                  {agent.platform} / {agent.arch}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>

      {hasTags && (
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {tags.map((tag: string) => (
            <div
              key={tag}
              className="bg-dark-bg border-1 border-dark-border pl-2 pr-2 rounded-[10px]"
            >
              <p className="text-sm">{tag}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
