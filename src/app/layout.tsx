import type { Metadata } from "next";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";
import { LanguageProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "HabitFlow",
  description: "Track your daily habits in under 10 seconds",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // No theme script and no suppressHydrationWarning: the app is dark-only, so
    // nothing mutates <html> before hydration and the server and client markup
    // agree. The palette is a single :root block in globals.css.
    <html lang="en" className="h-full antialiased">
      <body
        className="min-h-full flex flex-col safe-bottom"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <TelegramProvider>
          <LanguageProvider>
            {/* Toasts are the only reliable feedback channel on Telegram Web,
                where window.Telegram (and therefore haptics/showAlert) is absent. */}
            <ToastProvider>{children}</ToastProvider>
          </LanguageProvider>
        </TelegramProvider>
      </body>
    </html>
  );
}
