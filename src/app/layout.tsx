import type { Metadata } from "next";
import Script from "next/script";
import { AppShell } from "@/components/layout/app-shell";
import { ClientRoot } from "@/components/layout/client-root";
import { getSession } from "@/lib/auth/session";
import { SUPPRESS_EXTENSION_CONSOLE } from "@/lib/suppress-extension-console";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atelier · Jewellery Pricing",
  description:
    "Premium internal jewellery image-to-price workspace — upload, verify, price, vary, done.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getSession();
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="min-h-full flex flex-col font-sans"
        suppressHydrationWarning
      >
        <Script
          id="suppress-extension-console"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: SUPPRESS_EXTENSION_CONSOLE }}
        />
        <ClientRoot>
          <AppShell user={user}>{children}</AppShell>
        </ClientRoot>
      </body>
    </html>
  );
}
