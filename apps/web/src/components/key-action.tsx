"use client";

import { Check, Copy, Trash2 } from "lucide-react";
import { Button } from "@stock-market/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@stock-market/ui/components/tooltip";

export function KeyAction({ action, copied = false, ...props }: Omit<React.ComponentProps<typeof Button>, "children"> & { action: "copy" | "revoke"; copied?: boolean }) {
  const label = action === "revoke" ? "Revoke key" : copied ? "Copied" : "Copy key";
  const Icon = action === "revoke" ? Trash2 : copied ? Check : Copy;
  return <Tooltip>
    <TooltipTrigger asChild><Button type="button" {...props} aria-label={label}><Icon size={16} aria-hidden="true" /><span className="sr-only" role="status">{copied ? "Key copied" : ""}</span></Button></TooltipTrigger>
    <TooltipContent className="key-action-tooltip">{label}</TooltipContent>
  </Tooltip>;
}
