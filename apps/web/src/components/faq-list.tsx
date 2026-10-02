"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";

export function FaqList({ items }: { items: { question: string; answer: string }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  return <div className="faq-list" data-reveal>{items.map((item, index) => {
    const open = active === index;
    return <div className="faq-item" key={item.question} data-open={open}>
      <h3><button type="button" id={`${id}-question-${index}`} aria-expanded={open} aria-controls={`${id}-answer-${index}`} onClick={() => setActive(open ? null : index)}>{item.question}<Plus size={20} aria-hidden="true" /></button></h3>
      <div className="faq-answer" id={`${id}-answer-${index}`} role="region" aria-labelledby={`${id}-question-${index}`} inert={!open}><div><p>{item.answer}</p></div></div>
    </div>;
  })}</div>;
}
