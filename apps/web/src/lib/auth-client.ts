"use client";

import { createAuthClient } from "better-auth/react";
import { polarClient } from "@polar-sh/better-auth/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";

export const authClient = createAuthClient({ plugins: [polarClient(), oauthProviderClient()] });
