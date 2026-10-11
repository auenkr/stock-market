Use tmux stock-market.(Mostly dev server running here, if not start the dev server inside this session)

In dev mode(set via env).
Use this login credentials to

# Test credentials

Use this account for testing, running automated test.
username: <dev@auenkr.com>
password: test-development-password

test credit card for sandbox payment provider: 4242 4242 4242 4242
cvv: random
expire: any future date

# Tech stack

1. For components ui libarary, use shadcn
2. NX monorepo
3. Typescript
4. Backend: Cloudflare workers
5. Homepage, Doc, auth, etc: Next.js
6. Styling: Tailwindcss

# NOTE

1. All features and fixes go directly through pull requests to main. Do not maintain a dev branch.
2. After commit, push and create a PR to main; monitor it until all CI/CD checks pass.
3. CI publishes the Rust API image to Docker Hub only. The server container is updated manually by the owner. CI deploys MCP to Cloudflare and publishes MCP and CLI to npm.
4. Keep data-scrapping ignored by Git. Never delete its local directory or data.
