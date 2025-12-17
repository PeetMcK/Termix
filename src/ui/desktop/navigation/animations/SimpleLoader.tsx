import React from "react";
import { cn } from "@/lib/utils.ts";
import { useTheme } from "@/components/theme-provider";

interface SimpleLoaderProps {
  visible: boolean;
  message?: string;
  className?: string;
  backgroundColor?: string;
}

export function SimpleLoader({
  visible,
  message,
  className,
  backgroundColor,
}: SimpleLoaderProps) {
  const { theme } = useTheme();

  if (!visible) {
    return null;
  }

  // Detect if we're in dark mode
  const isDark = theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  // Theme-aware spinner colors
  const spinnerBorderBase = isDark
    ? "rgba(255, 255, 255, 0.1)"
    : "rgba(0, 0, 0, 0.1)";
  const spinnerBorderTop = isDark
    ? "rgba(255, 255, 255, 0.8)"
    : "rgba(0, 0, 0, 0.8)";

  return (
    <>
      <style>
        {`
          @keyframes spin {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }

          .simple-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid ${spinnerBorderBase};
            border-top-color: ${spinnerBorderTop};
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
          }
        `}
      </style>

      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center z-50 bg-muted/95 backdrop-blur-sm",
          className,
        )}
        style={backgroundColor ? { backgroundColor } : undefined}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="simple-spinner"></div>
          {message && (
            <p className="text-sm text-foreground font-medium">{message}</p>
          )}
        </div>
      </div>
    </>
  );
}
