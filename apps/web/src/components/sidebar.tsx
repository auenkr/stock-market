import Link from "next/link";

export function Sidebar() {
  return <aside className="sidebar">
    <Link className="brand" href="/dashboard"><span className="brand-mark">ll</span> ledgerline</Link>
    <nav className="nav">
      <span className="eyebrow" style={{ color: "#73858d", padding: "0 13px 5px" }}>Workspace</span>
      <Link href="/dashboard">Overview</Link>
      <Link href="/dashboard/keys">API keys</Link>
      <span className="eyebrow" style={{ color: "#73858d", padding: "18px 13px 5px" }}>Resources</span>
      <Link href="/docs">Documentation</Link>
    </nav>
    <div className="sidebar-foot">MARKET DATA INFRASTRUCTURE<br />v1.0.0 · INDIA EQUITIES</div>
  </aside>;
}
