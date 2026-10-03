export type ApiPlan = "free" | "basic" | "personal" | "professional";
export type PaidApiPlan = Exclude<ApiPlan, "free">;
export const plans = {
  free: { name: "Hobby", monthlyPrice: 0, requestsPerMinute: 10, commercial: false },
  basic: { name: "Basic", monthlyPrice: 199, requestsPerMinute: 60, commercial: false },
  personal: { name: "Personal", monthlyPrice: 399, requestsPerMinute: 300, commercial: false },
  professional: { name: "Professional", monthlyPrice: 2499, requestsPerMinute: 500, commercial: true },
} as const;

export function hasDetailedData(plan: ApiPlan): boolean {
  return plan === "personal" || plan === "professional";
}

export function effectivePlan(plan: ApiPlan, expiresAt: Date | null, now = new Date()): ApiPlan {
  return plan !== "free" && expiresAt && expiresAt > now ? plan : "free";
}
