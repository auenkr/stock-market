import { auth } from "@stock-market/auth";

export const GET = (request: Request) => auth.handler(request);
