import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledgerline | Indian Stock Market Data API",
  description: "Build financial apps with Ledgerline's Indian stock market API. Access company fundamentals, financial statements, shareholding data and corporate actions through documented REST endpoints.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('ledgerline-theme')||'system'}catch(e){}` }} /></head><body>{children}</body></html>;
}
