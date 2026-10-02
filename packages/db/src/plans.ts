export type ApiPlan = "free" | "personal" | "professional";
export const plans = {
  free: { name: "Basic", monthlyPrice: 0, requestsPerMinute: 10, commercial: false },
  personal: { name: "Personal", monthlyPrice: 2000, requestsPerMinute: 300, commercial: false },
  professional: { name: "Professional", monthlyPrice: 5000, requestsPerMinute: 500, commercial: true },
} as const;

export function effectivePlan(plan: ApiPlan, expiresAt: Date | null, now = new Date()): ApiPlan {
  return plan !== "free" && expiresAt && expiresAt > now ? plan : "free";
}
