import { PublicFooter } from "./public-footer";
import { PublicNavbar } from "./public-navbar";
import "../app/landing.css";
import "../app/pricing.css";

export function PublicPage({ children }: { children: React.ReactNode }) {
  return <main className="product-page public-page">
    <PublicNavbar />
    {children}
    <PublicFooter />
  </main>;
}
