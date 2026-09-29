import { KeyManager } from "@/components/key-manager";

export default function KeysPage() {
  return <><section className="hero"><div className="hero-copy"><span className="eyebrow">Access management</span><h1>API keys that stay in your control.</h1><p className="subtle">Create isolated credentials for each product, revoke them instantly, and keep the secret out of your source code.</p></div></section><KeyManager /></>;
}
