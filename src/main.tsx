/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import DesktopApp from "@/ui/desktop/DesktopApp.tsx";
import { MobileApp } from "@/ui/mobile/MobileApp.tsx";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { ElectronVersionCheck } from "@/ui/desktop/user/ElectronVersionCheck.tsx";
import "./i18n/i18n";
import { isElectron } from "./ui/main-axios.ts";

function useWindowWidth() {
  const [width, setWidth] = useState(window.innerWidth);
  const lastSwitchTime = useRef(0);
  const isCurrentlyMobile = useRef(window.innerWidth < 768);
  const hasSwitchedOnce = useRef(false);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const newWidth = window.innerWidth;
        const newIsMobile = newWidth < 768;
        const now = Date.now();

        if (hasSwitchedOnce.current && now - lastSwitchTime.current < 10000) {
          setWidth(newWidth);
          return;
        }

        if (
          newIsMobile !== isCurrentlyMobile.current &&
          now - lastSwitchTime.current > 5000
        ) {
          lastSwitchTime.current = now;
          isCurrentlyMobile.current = newIsMobile;
          hasSwitchedOnce.current = true;
          setWidth(newWidth);
        } else {
          setWidth(newWidth);
        }
      }, 2000);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return width;
}

function RootApp() {
  const width = useWindowWidth();
  const isMobile = width < 768;
  const [showVersionCheck, setShowVersionCheck] = useState(true);
  const { theme } = useTheme();

  const userAgent =
    navigator.userAgent || navigator.vendor || (window as any).opera || "";
  const isTermixMobile = /Termix-Mobile/.test(userAgent);

  const renderApp = () => {
    if (isElectron()) {
      return <DesktopApp />;
    }

    if (isTermixMobile) {
      return <MobileApp key="mobile" />;
    }

    return isMobile ? <MobileApp key="mobile" /> : <DesktopApp key="desktop" />;
  };

  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const stripeColor = isDark ? "rgba(255, 255, 255, 0.03)" : "rgba(0, 0, 0, 0.03)";

  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundColor: "var(--background)",
          backgroundImage: `linear-gradient(
            135deg,
            transparent 0%,
            transparent 49%,
            ${stripeColor} 49%,
            ${stripeColor} 51%,
            transparent 51%,
            transparent 100%
          )`,
          backgroundSize: "80px 80px",
          zIndex: 0,
        }}
      />
      <div className="relative min-h-screen" style={{ zIndex: 1 }}>
        {isElectron() && showVersionCheck ? (
          <ElectronVersionCheck
            onContinue={() => setShowVersionCheck(false)}
            isAuthenticated={false}
          />
        ) : (
          renderApp()
        )}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <RootApp />
    </ThemeProvider>
  </StrictMode>,
);
