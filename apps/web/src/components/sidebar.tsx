import Link from "next/link";
import { ExternalLink } from "lucide-react";

export function Sidebar() {
  return <aside className="sidebar">
    <Link className="brand" href="/dashboard"><span className="brand-mark">LL</span>Ledgerline</Link>
    <nav className="nav">
      <span className="eyebrow" style={{ padding: "0 13px 5px" }}>Workspace</span>
      <Link href="/dashboard/keys">API keys</Link>
      <Link href="/dashboard/billing">Plans & billing</Link>
      <Link href="/dashboard/profile">Profile</Link>
      <span className="eyebrow" style={{ padding: "18px 13px 5px" }}>Resources</span>
      <Link href="/documentation" target="_blank" rel="noopener noreferrer">Documentation <ExternalLink size={14} aria-hidden="true" /></Link>
      <Link href="/terms-of-service">Terms of Service</Link>
      <Link href="/privacy-policy">Privacy Policy</Link>
    </nav>
    <div className="sidebar-foot">INDIAN MARKET DATA<br />Built for your next product</div>
  </aside>;
}
