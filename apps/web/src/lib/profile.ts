export const PROFILE_NAME_MAX_LENGTH = 80;
export const PROFILE_COMPANY_MAX_LENGTH = 120;

export type ProfileDetails = { name: string; company: string | null };
type ProfileValidation =
  | { ok: true; data: ProfileDetails }
  | { ok: false; error: string };

export function validateProfileInput(input: unknown): ProfileValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Please provide your profile details" };
  }

  const { name, company } = input as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || name.trim().length > PROFILE_NAME_MAX_LENGTH) {
    return { ok: false, error: "A name between 1 and 80 characters is required" };
  }
  if (company != null && typeof company !== "string") {
    return { ok: false, error: "Company must be text" };
  }
  const trimmedCompany = typeof company === "string" ? company.trim() : "";
  if (trimmedCompany.length > PROFILE_COMPANY_MAX_LENGTH) {
    return { ok: false, error: "Company must be 120 characters or fewer" };
  }

  return { ok: true, data: { name: name.trim(), company: trimmedCompany || null } };
}
