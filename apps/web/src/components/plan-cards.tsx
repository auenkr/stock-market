import Link from "next/link";
import { plans, type ApiPlan } from "@stock-market/db/plans";

export function PlanCards({ current, action }: { current?: ApiPlan; action?: (plan: "personal" | "professional") => React.ReactNode }) {
  return <div className="plan-grid">{(Object.keys(plans) as ApiPlan[]).map((id) => {
    const plan = plans[id];
    return <article className={`card plan-card ${id === "personal" ? "plan-featured" : ""}`} key={id}>
      <span className="eyebrow">{id === "personal" ? "FOR YOUR NEXT IDEA" : id === "professional" ? "BUILT FOR BUSINESS" : "START EXPLORING"}</span>
      <h2>{plan.name}</h2><p className="plan-price">₹{plan.monthlyPrice.toLocaleString("en-IN")}<span> / month</span></p>
      <p className="subtle">{id === "free" ? "Free forever. No payment details needed." : "Monthly subscription. Cancel anytime."}</p>
      <ul><li><strong>{plan.requestsPerMinute} requests / minute</strong></li>
        <li>{id === "free" ? "Basic endpoints and five supported companies" : "Everything in Basic + all endpoints and supported companies"}</li>
        <li>{plan.commercial ? "Personal + commercial use permitted" : "Personal, non-commercial use only"}</li>
        <li>One allowance shared across your API keys</li></ul>
      {current === id ? <span className="pill">Current plan</span> : id !== "free" && action ? action(id) : <Link className="button secondary" href={current ? "/dashboard/billing" : id === "free" ? "/signup" : `/signin?next=/dashboard/billing`}>{id === "free" ? "Start with Basic" : `Choose ${plan.name}`}</Link>}
    </article>;
  })}</div>;
}
