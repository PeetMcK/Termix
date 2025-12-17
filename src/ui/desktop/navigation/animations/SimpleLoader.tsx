import React from "react";
import { cn } from "@/lib/utils.ts";

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
  if (!visible) {
    return null;
  }

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
        `}
      </style>

      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center z-50 bg-background",
          className,
        )}
        style={backgroundColor ? { backgroundColor } : undefined}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-border border-t-foreground rounded-full animate-spin"></div>
          {message && (
            <p className="text-sm text-muted-foreground font-medium">{message}</p>
          )}
        </div>
      </div>
    </>
  );
}
