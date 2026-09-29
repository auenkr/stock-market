import Link from "next/link";

export function Sidebar() {
  return <aside className="sidebar">
    <Link className="brand" href="/dashboard"><span className="brand-mark">ll</span> ledgerline</Link>
    <nav className="nav">
      <Link href="/dashboard">Overview</Link>
      <Link href="/dashboard/keys">API keys</Link>
      <Link href="/docs">Documentation</Link>
    </nav>
    <div className="sidebar-foot">MARKET DATA INFRASTRUCTURE<br />v1.0.0 · INDIA EQUITIES</div>
  </aside>;
}
