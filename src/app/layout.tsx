import type { Metadata } from "next";
import "./globals.css";
import { TelegramProvider } from "@/components/TelegramProvider";
import { LanguageProvider } from "@/lib/i18n";

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
    <html lang="en" className="h-full antialiased">
      <body
        className="min-h-full flex flex-col safe-bottom"
        style={{ fontFamily: "var(--font-body)" }}
      >
        <TelegramProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </TelegramProvider>
      </body>
    </html>
  );
}
