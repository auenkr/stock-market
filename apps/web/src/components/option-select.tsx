"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@stock-market/ui/components/select";

const emptyValue = "__ledgerline_empty__";

export function OptionSelect({ label, value, onChange, options, id }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  id?: string;
}) {
  return <Select value={value || emptyValue} onValueChange={(next) => onChange(next === emptyValue ? "" : next)}>
    <SelectTrigger id={id} aria-label={label} className="docs-select"><SelectValue /></SelectTrigger>
    <SelectContent position="popper" className="docs-select-menu">{options.map((option) => <SelectItem key={option.value} value={option.value || emptyValue}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
