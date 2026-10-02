import Link from "next/link";

export function PublicFooter() {
  return <footer className="product-footer">
    <div className="footer-brand"><Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link><p>Indian market data for the products of tomorrow.</p></div>
    <nav className="footer-groups" aria-label="Footer navigation">
      <div><h2>Product</h2><Link href="/pricing">Pricing</Link><Link href="/dashboard">Dashboard</Link><Link href="/support">Support</Link></div>
      <div><h2>Developers</h2><Link href="/documentation">Documentation</Link><Link href="/docs">API reference</Link><a href="/swagger.json" download="swagger_ledgerline.json">OpenAPI</a></div>
      <div><h2>Legal</h2><Link href="/terms-of-service">Terms of Service</Link><Link href="/privacy-policy">Privacy Policy</Link></div>
    </nav>
    <p className="product-copyright">© {new Date().getFullYear()} Ledgerline. All rights reserved.</p>
  </footer>;
}
