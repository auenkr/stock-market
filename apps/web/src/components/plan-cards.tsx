import Link from "next/link";
import { plans, type ApiPlan, type PaidApiPlan } from "@stock-market/db/plans";

export function PlanCards({ current, action }: { current?: ApiPlan; action?: (plan: PaidApiPlan) => React.ReactNode }) {
  return <div className="plan-grid">{(Object.keys(plans) as ApiPlan[]).map((id) => {
    const plan = plans[id];
    return <article className={`card plan-card ${id === "personal" ? "plan-featured" : ""}`} key={id}>
      <div className="plan-card-header"><span className="eyebrow">{id === "personal" ? "FOR YOUR NEXT IDEA" : id === "professional" ? "BUILT FOR BUSINESS" : "START EXPLORING"}</span>{current === id && <span className="pill">Current plan</span>}</div>
      <h2>{plan.name}</h2><p className="plan-price">₹{plan.monthlyPrice.toLocaleString("en-IN")}<span> / month</span></p>
      <p className="subtle">{id === "free" ? "Free forever. No payment details needed." : "Monthly subscription. Cancel anytime."}</p>
      <ul><li><strong>{plan.requestsPerMinute} requests / minute</strong></li>
        <li>{id === "free" ? "Basic-data endpoints · 5 companies" : id === "basic" ? "Basic-data endpoints · all supported companies" : "All endpoints and supported companies"}</li>
        <li>REST API + ChatGPT agent tools + MCP</li>
        <li>{plan.commercial ? "Personal + commercial use permitted" : "Personal, non-commercial use only"}</li>
        </ul>
      {current !== id && (id !== "free" && action ? action(id) : <Link className="button secondary" href={current ? "/dashboard/billing" : id === "free" ? "/signup" : `/signin?next=/dashboard/billing`}>{id === "free" ? "Start with Hobby" : `Choose ${plan.name}`}</Link>)}
    </article>;
  })}</div>;
}
