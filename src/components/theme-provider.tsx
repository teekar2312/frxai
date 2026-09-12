"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      // Next.js 16 + next-themes 0.4.x: the script tag warning is cosmetic.
      // The theme still works correctly — it's just a dev console warning
      // about next-themes injecting an inline <script> for flash-prevention.
    >
      {children}
    </NextThemesProvider>
  );
}
