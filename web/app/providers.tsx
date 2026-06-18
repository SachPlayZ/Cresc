"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi/config";
import { useState, useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    // Read initial theme from document element
    const initialTheme = document.documentElement.getAttribute("data-theme");
    if (initialTheme === "light" || initialTheme === "dark") {
      setTheme(initialTheme);
    }

    // Set up MutationObserver to watch data-theme attribute on <html> element
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === "data-theme") {
          const newTheme = document.documentElement.getAttribute("data-theme");
          if (newTheme === "light" || newTheme === "dark") {
            setTheme(newTheme);
          }
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => observer.disconnect();
  }, []);

  const customDarkTheme = {
    ...darkTheme({
      accentColor: "#C6F84E",
      accentColorForeground: "#1B2400",
      borderRadius: "medium",
    }),
    colors: {
      ...darkTheme().colors,
      modalBackground: "#15101F", // --c-bg
      modalBorder: "rgba(190, 170, 255, 0.14)", // --c-border
      modalText: "#EEE9FC", // --c-text
      modalTextDim: "rgba(238, 233, 252, 0.62)", // --c-muted
      modalTextSecondary: "rgba(238, 233, 252, 0.40)", // --c-dim
      profileAction: "#221A36", // --c-surface
      profileActionHover: "#2B2245", // --c-surface-hi
      actionButtonSecondaryBackground: "#221A36", // --c-surface
      closeButton: "rgba(238, 233, 252, 0.62)",
      closeButtonBackground: "#221A36",
    },
  };

  const customLightTheme = {
    ...lightTheme({
      accentColor: "#A6E22E",
      accentColorForeground: "#1B2400",
      borderRadius: "medium",
    }),
    colors: {
      ...lightTheme().colors,
      modalBackground: "#FFFFFF", // --c-surface
      modalBorder: "rgba(60, 40, 120, 0.13)", // --c-border
      modalText: "#1E1633", // --c-text
      modalTextDim: "rgba(30, 22, 51, 0.62)", // --c-muted
      modalTextSecondary: "rgba(30, 22, 51, 0.40)", // --c-dim
      profileAction: "#ECE7FA",
      profileActionHover: "#F3EFFC",
      actionButtonSecondaryBackground: "#F3EFFC",
      closeButton: "rgba(30, 22, 51, 0.62)",
      closeButtonBackground: "#F3EFFC",
    },
  };

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme === "dark" ? customDarkTheme : customLightTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
