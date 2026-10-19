import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pro247 | Gestão financeira e contábil em beta",
  description:
    "Conheça a plataforma Pro247 para MEIs, profissionais autônomos, prestadores de serviços e pequenos comerciantes. Em beta e em desenvolvimento.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
