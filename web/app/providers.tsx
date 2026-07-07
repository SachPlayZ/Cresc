"use client";

import { CookiesProvider } from "react-cookie";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <CookiesProvider>
      {children}
      <Toaster position="bottom-right" />
    </CookiesProvider>
  );
}
