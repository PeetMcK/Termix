import { TERMINAL_THEMES, TERMINAL_FONTS } from "@/constants/terminal-themes";
import { useTheme } from "@/components/theme-provider";

interface TerminalPreviewProps {
  theme: string;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: "block" | "underline" | "bar";
  cursorBlink?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
}

export function TerminalPreview({
  theme = "termix",
  fontSize = 14,
  fontFamily = "Caskaydia Cove Nerd Font Mono",
  cursorStyle = "bar",
  cursorBlink = true,
  letterSpacing = 0,
  lineHeight = 1.2,
}: TerminalPreviewProps) {
  const { theme: appTheme } = useTheme();

  // Auto-switch terminal theme based on app theme when using "termix" (default)
  const isDarkMode = appTheme === "dark" ||
    (appTheme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  let themeColors;
  if (theme === "termix") {
    themeColors = isDarkMode
      ? TERMINAL_THEMES.termixDark.colors
      : TERMINAL_THEMES.termixLight.colors;
  } else {
    themeColors = TERMINAL_THEMES[theme]?.colors || TERMINAL_THEMES.termixDark.colors;
  }

  return (
    <div className="border border-input rounded-md overflow-hidden">
      <div
        className="p-4 font-mono text-sm"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily:
            TERMINAL_FONTS.find((f) => f.value === fontFamily)?.fallback ||
            TERMINAL_FONTS[0].fallback,
          letterSpacing: `${letterSpacing}px`,
          lineHeight,
          background: themeColors.background,
          color: themeColors.foreground,
        }}
      >
        <div>
          <span style={{ color: themeColors.green }}>
            user@termix
          </span>
          <span>:</span>
          <span style={{ color: themeColors.blue }}>~</span>
          <span>$ ls -la</span>
        </div>
        <div>
          <span style={{ color: themeColors.blue }}>
            drwxr-xr-x
          </span>
          <span> 5 user </span>
          <span style={{ color: themeColors.cyan }}>
            docs
          </span>
        </div>
        <div>
          <span style={{ color: themeColors.green }}>
            -rwxr-xr-x
          </span>
          <span> 1 user </span>
          <span style={{ color: themeColors.green }}>
            script.sh
          </span>
        </div>
        <div>
          <span>-rw-r--r--</span>
          <span> 1 user </span>
          <span>README.md</span>
        </div>
        <div>
          <span style={{ color: themeColors.green }}>
            user@termix
          </span>
          <span>:</span>
          <span style={{ color: themeColors.blue }}>~</span>
          <span>$ </span>
          <span
            className="inline-block"
            style={{
              width: cursorStyle === "block" ? "0.6em" : "0.1em",
              height:
                cursorStyle === "underline"
                  ? "0.15em"
                  : cursorStyle === "bar"
                    ? `${fontSize}px`
                    : `${fontSize}px`,
              background: themeColors.cursor || themeColors.foreground,
              animation: cursorBlink ? "blink 1s step-end infinite" : "none",
              verticalAlign:
                cursorStyle === "underline" ? "bottom" : "text-bottom",
            }}
          />
        </div>
      </div>
      <style>{`
        @keyframes blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
