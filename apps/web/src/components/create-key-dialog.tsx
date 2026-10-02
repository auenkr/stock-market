"use client";

import { useState } from "react";
import { Button } from "@stock-market/ui/components/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@stock-market/ui/components/dialog";
import { Input } from "@stock-market/ui/components/input";
import { Label } from "@stock-market/ui/components/label";
import { RadioGroup, RadioGroupItem } from "@stock-market/ui/components/radio-group";
import { keyExpirationOptions, type KeyExpiration } from "@/lib/key-expiration";

export type CreatedKey = { key: string; expiresAt: string | null };

export function CreateKeyDialog({ onCreated }: { onCreated: (key: CreatedKey) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiration, setExpiration] = useState<KeyExpiration>("30d");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function changeOpen(value: boolean) {
    if (pending) return;
    setOpen(value);
    if (value) { setName(""); setExpiration("30d"); setError(null); }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/keys", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, expiration }),
      });
      const body = await response.json() as Partial<CreatedKey> & { error?: string };
      if (!response.ok || !body.key) throw new Error(body.error ?? "Could not create your key.");
      onCreated({ key: body.key, expiresAt: body.expiresAt ?? null });
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create your key.");
    } finally { setPending(false); }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button className="button secondary" type="button">Create secret key</Button></DialogTrigger>
    <DialogContent className="create-key-dialog" showCloseButton={!pending}>
      <DialogHeader>
        <span className="eyebrow">Application access</span>
        <DialogTitle>Create an API key</DialogTitle>
        <DialogDescription>Give your key a name and choose when it should expire.</DialogDescription>
      </DialogHeader>
      <form className="form key-create-form" onSubmit={create}>
        <div className="key-form-field">
          <Label htmlFor="api-key-name">Key name</Label>
          <Input id="api-key-name" className="input" required maxLength={80} placeholder="e.g. Research dashboard" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} autoComplete="off" />
        </div>
        <fieldset className="key-expiration-field" disabled={pending}>
          <legend>Expiration</legend>
          <RadioGroup className="expiration-options" value={expiration} onValueChange={(value) => setExpiration(value as KeyExpiration)} aria-label="Key expiration" disabled={pending}>
            {keyExpirationOptions.map((option) => <Label key={option.value} htmlFor={`expiration-${option.value}`} className={`expiration-option${option.days === null ? " expiration-never" : ""}`} data-selected={expiration === option.value}>
              <RadioGroupItem id={`expiration-${option.value}`} value={option.value} aria-label={option.days === null ? "Never — until manually revoked" : option.label} />
              <span>{option.label}{option.days === null && <small>Until you manually revoke it</small>}</span>
            </Label>)}
          </RadioGroup>
          <p className="key-expiration-hint">{expiration === "never" ? "No automatic expiration. You can revoke this key at any time." : `Expires ${keyExpirationOptions.find((option) => option.value === expiration)?.label.toLowerCase()} after creation. You can revoke it sooner.`}</p>
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>Cancel</Button></DialogClose>
          <Button className="button secondary" type="submit" disabled={pending || !name.trim()}>{pending ? "Creating key…" : "Create key"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
