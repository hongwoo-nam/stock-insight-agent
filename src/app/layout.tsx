import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Stock Insight Agent | 슈카월드 기반 주식·경제 분석",
  description: "슈카월드 YouTube 채널 기반 AI 주식·경제 정보 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full">
      <body className={`${inter.className} min-h-full bg-white text-gray-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
