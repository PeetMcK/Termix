import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { toast } from "sonner";
import { getCookie, isElectron } from "@/ui/main-axios.ts";
import {
  TERMINAL_THEMES,
  DEFAULT_TERMINAL_CONFIG,
  TERMINAL_FONTS,
} from "@/constants/terminal-themes";
import { SimpleLoader } from "@/ui/desktop/navigation/animations/SimpleLoader.tsx";
import type { AgentConfig } from "@/types";

interface AgentTerminalHandle {
  disconnect: () => void;
  fit: () => void;
  sendInput: (data: string) => void;
  notifyResize: () => void;
  refresh: () => void;
}

interface AgentTerminalProps {
  agentConfig: AgentConfig;
  isVisible: boolean;
  title?: string;
  showTitle?: boolean;
  splitScreen?: boolean;
  onClose?: () => void;
}

function getAgentTerminalWsUrl(): string {
  const isDev =
    !isElectron() &&
    (window.location.port === "3000" ||
      window.location.port === "5173" ||
      window.location.hostname === "localhost");

  if (isElectron()) {
    const configuredUrl = (window as any).configuredServerUrl;
    if (configuredUrl) {
      const url = new URL(configuredUrl);
      return `${url.protocol === "https:" ? "wss" : "ws"}://${url.host}/ws/agent-terminal`;
    }
    return "ws://localhost:30008";
  }

  if (isDev) {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://localhost:30008`;
  }

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws/agent-terminal`;
}

export const AgentTerminal = forwardRef<AgentTerminalHandle, AgentTerminalProps>(
  function AgentTerminal(
    { agentConfig, isVisible, splitScreen = false, onClose },
    ref
  ) {
    const { instance: terminal, ref: xtermRef } = useXTerm();
    const config = DEFAULT_TERMINAL_CONFIG;
    const themeColors =
      TERMINAL_THEMES[config.theme]?.colors || TERMINAL_THEMES.termix.colors;
    const backgroundColor = themeColors.background;

    const fitAddonRef = useRef<FitAddon | null>(null);
    const webSocketRef = useRef<WebSocket | null>(null);
    const resizeTimeout = useRef<NodeJS.Timeout | null>(null);
    const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [visible, setVisible] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const isVisibleRef = useRef<boolean>(false);
    const isFittingRef = useRef(false);
    const isUnmountingRef = useRef(false);
    const sessionIdRef = useRef<string>("");

    const doFit = useCallback(() => {
      if (isFittingRef.current) return;
      isFittingRef.current = true;
      try {
        fitAddonRef.current?.fit();
      } finally {
        isFittingRef.current = false;
      }
    }, []);

    const notifyResize = useCallback(() => {
      if (!terminal || !webSocketRef.current || !isConnected) return;
      try {
        const cols = terminal.cols;
        const rows = terminal.rows;
        if (cols && rows && webSocketRef.current.readyState === WebSocket.OPEN) {
          webSocketRef.current.send(
            JSON.stringify({ type: "resize", data: { cols, rows } })
          );
        }
      } catch (err) {
        console.error("Error notifying resize:", err);
      }
    }, [terminal, isConnected]);

    const sendInput = useCallback(
      (data: string) => {
        if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) return;
        webSocketRef.current.send(JSON.stringify({ type: "input", data }));
      },
      []
    );

    useImperativeHandle(
      ref,
      () => ({
        disconnect: () => {
          if (webSocketRef.current) {
            webSocketRef.current.close();
          }
        },
        fit: doFit,
        sendInput,
        notifyResize,
        refresh: () => {
          terminal?.refresh(0, terminal.rows - 1);
        },
      }),
      [doFit, sendInput, notifyResize, terminal]
    );

    // Initialize terminal
    useEffect(() => {
      if (!terminal) return;

      terminal.options.allowProposedApi = true;
      terminal.options.cursorBlink = config.cursorBlink;
      terminal.options.cursorStyle = config.cursorStyle;
      terminal.options.fontSize = config.fontSize;
      terminal.options.fontFamily =
        TERMINAL_FONTS[config.fontFamily] || config.fontFamily;
      terminal.options.letterSpacing = config.letterSpacing;
      terminal.options.lineHeight = config.lineHeight;
      terminal.options.scrollback = config.scrollback;
      terminal.options.minimumContrastRatio = config.minimumContrastRatio;
      terminal.options.theme = themeColors;

      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new ClipboardAddon());
      terminal.loadAddon(new Unicode11Addon());
      terminal.loadAddon(
        new WebLinksAddon((_, uri) => {
          window.open(uri, "_blank");
        })
      );

      setTimeout(() => {
        doFit();
        setIsReady(true);
      }, 100);
    }, [terminal, config, themeColors, doFit]);

    // Connect to agent terminal WebSocket
    useEffect(() => {
      if (!terminal || !isReady || isConnecting || isConnected) return;
      if (agentConfig.status !== "online") {
        terminal.writeln("\r\n\x1b[31mAgent is offline\x1b[0m");
        return;
      }

      setIsConnecting(true);
      terminal.writeln(`\r\nConnecting to agent ${agentConfig.hostname || agentConfig.deviceId}...`);

      const jwt = getCookie("jwt");
      const wsUrl = getAgentTerminalWsUrl();

      // Pass token as query parameter (server expects ?token=...)
      const wsUrlWithToken = jwt ? `${wsUrl}?token=${encodeURIComponent(jwt)}` : wsUrl;
      const ws = new WebSocket(wsUrlWithToken);
      webSocketRef.current = ws;

      ws.onopen = () => {
        // Send connect request with agent ID
        const sessionId = `agent-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        sessionIdRef.current = sessionId;

        ws.send(
          JSON.stringify({
            type: "connectToAgent",
            data: {
              agentId: agentConfig.id,
              sessionId,
              cols: terminal.cols,
              rows: terminal.rows,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "connected":
              setIsConnected(true);
              setIsConnecting(false);
              terminal.writeln("\r\n\x1b[32mConnected to agent\x1b[0m\r\n");

              // Start ping interval
              pingIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "ping" }));
                }
              }, 30000);
              break;

            case "data":
              // Terminal output from agent
              if (msg.data) {
                terminal.write(msg.data);
              }
              break;

            case "exit":
              terminal.writeln(`\r\n\x1b[33mSession ended (code: ${msg.code || 0})\x1b[0m`);
              setIsConnected(false);
              break;

            case "error":
              terminal.writeln(`\r\n\x1b[31mError: ${msg.message || "Unknown error"}\x1b[0m`);
              setIsConnecting(false);
              break;

            case "pong":
              // Ignore pong responses
              break;

            default:
              console.log("Unknown message type:", msg.type);
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        terminal.writeln("\r\n\x1b[31mConnection error\x1b[0m");
        setIsConnecting(false);
      };

      ws.onclose = () => {
        if (!isUnmountingRef.current) {
          terminal.writeln("\r\n\x1b[33mDisconnected from agent\x1b[0m");
        }
        setIsConnected(false);
        setIsConnecting(false);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
      };

      return () => {
        isUnmountingRef.current = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "disconnect" }));
          ws.close();
        }
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }
      };
    }, [terminal, isReady, isConnecting, isConnected, agentConfig]);

    // Handle terminal input
    useEffect(() => {
      if (!terminal || !isConnected) return;

      const disposable = terminal.onData((data) => {
        sendInput(data);
      });

      return () => disposable.dispose();
    }, [terminal, isConnected, sendInput]);

    // Handle resize
    useEffect(() => {
      if (!terminal || !isConnected) return;

      const handleResize = () => {
        if (resizeTimeout.current) {
          clearTimeout(resizeTimeout.current);
        }
        resizeTimeout.current = setTimeout(() => {
          doFit();
          notifyResize();
        }, 100);
      };

      const resizeObserver = new ResizeObserver(handleResize);
      if (xtermRef.current) {
        resizeObserver.observe(xtermRef.current);
      }

      return () => {
        resizeObserver.disconnect();
        if (resizeTimeout.current) {
          clearTimeout(resizeTimeout.current);
        }
      };
    }, [terminal, isConnected, doFit, notifyResize, xtermRef]);

    // Visibility handling
    useEffect(() => {
      isVisibleRef.current = isVisible;
      if (isVisible) {
        setTimeout(() => {
          doFit();
          setVisible(true);
        }, 50);
      }
    }, [isVisible, doFit]);

    return (
      <div
        className="w-full h-full overflow-hidden relative flex flex-col"
        style={{ backgroundColor }}
      >
        {!visible && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <SimpleLoader />
          </div>
        )}
        <div
          ref={xtermRef}
          className="w-full h-full"
          style={{
            opacity: visible ? 1 : 0,
            transition: "opacity 200ms ease-in-out",
          }}
        />
      </div>
    );
  }
);
