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
    // suppressHydrationWarning: the inline script below adds a class to <html>
    // before React hydrates, so the server's className and the client's differ
    // by design.
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before the first paint. globals.css defaults
            to light while the app defaults to dark, so without this a
            dark-preferring user saw a white frame on every open. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('habitflow-theme');" +
              "if(t==='light'||t==='dark'){document.documentElement.classList.add(t)}}catch(e){}",
          }}
        />
      </head>
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
