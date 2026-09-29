import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@stock-market/auth";

export const { GET, POST } = toNextJsHandler(auth);
