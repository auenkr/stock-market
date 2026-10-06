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

1. All feature, bugs, everything goes through dev branch
2. Only Sync from dev to main push everything in prod.
3. After commit, push create a PR to dev branch, babysit the PR till all checks CICD pass.
