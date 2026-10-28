import "@vidyam/ui/globals.css";

import { routing } from "@vidyam/app-shell/i18n/routing";
import { Providers } from "@vidyam/app-shell/providers";
import { cn } from "@vidyam/ui/lib/utils";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import type { ReactNode } from "react";

// Latin and Devanagari faces with matching metrics, so mixed Hindi/English text reads evenly.
const latin = Noto_Sans({ subsets: ["latin"], variable: "--font-latin", display: "swap" });
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Vidyam Admin", template: "%s · Vidyam Admin" },
  description: "Run your coaching center on Vidyam: staff, syllabus, paper patterns, AI and budgets.",
  robots: { index: false, follow: false },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await rootLocale();
  if (!hasLocale(routing.locales, locale)) notFound();
  return (
    <html lang={locale} suppressHydrationWarning className={cn(latin.variable, devanagari.variable)}>
      <body className="min-h-svh font-sans antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
