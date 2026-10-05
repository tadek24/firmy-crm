import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Firmy CRM",
  description: "CRM do prospectingu firm z CEIDG i KRS"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
