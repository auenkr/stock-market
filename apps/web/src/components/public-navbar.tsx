"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Menu } from "lucide-react";
import { ThemePicker } from "./theme-picker";
import { Button } from "@stock-market/ui/components/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@stock-market/ui/components/sheet";

const links = [{ href: "/pricing", label: "Pricing" }, { href: "/documentation", label: "Documentation" }, { href: "/support", label: "Support" }, { href: "/#faq", label: "FAQ" }];

export function PublicNavbar() {
  const [open, setOpen] = useState(false);
  return <nav className="product-nav" aria-label="Main navigation">
    <Link className="brand" href="/"><span className="brand-mark">LL</span>Ledgerline</Link>
    <div className="product-nav-links">{links.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}</div>
    <div className="product-nav-actions"><ThemePicker /><Link className="signin-link" href="/signin">Sign in</Link><Button asChild className="button secondary public-nav-cta"><Link href="/signup">Get an API key <ExternalLink size={14} aria-hidden="true" /></Link></Button>
      <Sheet open={open} onOpenChange={setOpen}><SheetTrigger asChild><Button variant="ghost" size="icon" className="public-menu-trigger" aria-label="Open navigation menu"><Menu aria-hidden="true" /></Button></SheetTrigger>
        <SheetContent className="public-mobile-menu"><div className="public-mobile-heading"><SheetTitle className="brand"><span className="brand-mark">LL</span>Ledgerline</SheetTitle><SheetDescription>Indian market data.<br />Developer-first.</SheetDescription></div>
          <nav aria-label="Mobile navigation" className="public-mobile-links">{links.map(link => <SheetClose asChild key={link.href}><Link href={link.href}>{link.label}</Link></SheetClose>)}</nav>
          <div className="public-mobile-theme"><span>Appearance</span><ThemePicker /></div>
          <div className="public-mobile-actions"><SheetClose asChild><Button asChild variant="outline"><Link href="/signin">Sign in</Link></Button></SheetClose><SheetClose asChild><Button asChild className="button secondary"><Link href="/signup">Get an API key <ExternalLink size={14} aria-hidden="true" /></Link></Button></SheetClose></div>
        </SheetContent>
      </Sheet>
    </div>
  </nav>;
}
