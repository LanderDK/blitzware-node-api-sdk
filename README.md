# blitzware-node-api-sdk

Lightweight Node.js SDK for BlitzWare resource servers (APIs).

This package provides simple middleware for Express and Koa to validate incoming bearer tokens.
It prefers token introspection (avoids shipping a shared signing secret) and also supports the common pattern
of mounting a non-enforcing parser once and enforcing auth on a per-route basis.

## What this package exports

- `expressAuth(options)` -> returns an Express parser middleware. Mount with `app.use(expressAuth(...))`.
- `expressRequireAuth()` -> returns an Express per-route enforcer middleware.
- `expressRequireRole(role)` -> returns an Express per-route role enforcer middleware.
- `koaAuth(options)` -> returns a Koa parser middleware. Mount with `app.use(koaAuth(...))`.
- `koaRequireAuth()` -> returns a Koa per-route enforcer middleware.
- `koaRequireRole(role)` -> returns a Koa per-route role enforcer middleware.
- `createAuth(options)` -> returns an isolated auth instance with parser/enforcer middleware for Express and Koa.
- Types: `AuthOptions`, `AuthPayload`, `AuthContext`, `AuthMiddleware`, `AuthenticatedExpressRequest`, `AuthenticatedKoaState`.

These helpers are implemented in `src/middleware.ts` and re-exported from `src/index.ts` (the package entry).

## Quick concepts and recommended pattern

- Parser (non-enforcing): the middleware returned by `expressAuth()` / `koaAuth()` tries to parse and introspect
  a bearer token on every request and will attach the result to `req.auth` (Express) or `ctx.state.auth` (Koa)
  when a valid token is present. The parser does not block anonymous requests.
- Require (per-route): the middleware returned by `expressRequireAuth()` / `koaRequireAuth()` enforces authentication
  for a specific route. If `req.auth`/`ctx.state.auth` is missing, it will perform on-demand introspection using the
  options previously provided via `expressAuth()`/`koaAuth()` (the helpers store the config internally) and reject
  the request if the token is invalid or missing.

Recommended usage for multi-file projects:

1. In your main entrypoint mount the parser once so it runs on every request:

```js
// app.js
require("dotenv").config();
const express = require("express");
const { expressAuth } = require("blitzware-node-api-sdk");

const app = express();
app.use(express.json());

// mount parser globally (non-enforcing)
app.use(
  expressAuth({
    clientId: process.env.BLITZWARE_CLIENT_ID,
    clientSecret: process.env.BLITZWARE_CLIENT_SECRET,
    // Optional managed auth domain from the BlitzWare dashboard.
    // Defaults to https://auth.blitzware.xyz/api/auth/
    authBaseUrl: process.env.BLITZWARE_AUTH_BASE_URL,
  })
);

app.get("/public", (req, res) => res.json({ ok: true }));

// mount routers or individual route files after this
app.use("/users", require("./routes/users"));

app.listen(process.env.PORT || 3000);
```

2. In each route file, use the per-route enforcer where you need protection:

```js
// routes/users.js
const express = require("express");
const router = express.Router();
const { expressRequireAuth, expressRequireRole } = require("blitzware-node-api-sdk");

router.get("/", (req, res) => res.json({ ok: true, users: [] })); // public

router.get("/me", expressRequireAuth(), (req, res) => {
  // parse middleware attached req.auth earlier if token present
  res.json({ ok: true, me: req.auth && req.auth.payload });
});

module.exports = router;
```

This pattern avoids re-creating auth middleware in every route file while ensuring per-route enforcement works.

For apps that need multiple auth configurations, tests that must avoid global state, or explicit cache ownership,
prefer the factory API:

```js
const express = require("express");
const { createAuth } = require("blitzware-node-api-sdk");

const auth = createAuth({
  clientId: process.env.BLITZWARE_CLIENT_ID,
  clientSecret: process.env.BLITZWARE_CLIENT_SECRET,
  authBaseUrl: process.env.BLITZWARE_AUTH_BASE_URL,
  introspectionCacheTtlMs: 30000,
});

const app = express();
app.use(auth.expressParse);
app.get("/admin", auth.expressRequire(), auth.expressRequireRole("admin"), (req, res) => {
  res.json({ ok: true, me: req.auth.payload });
});
```

## Role-based access control

The SDK provides role checking middleware for both Express and Koa. The middleware checks if the authenticated user has the required role by inspecting the `roles` array in the token's introspection payload.

**Express example:**

```js
const { expressRequireAuth, expressRequireRole } = require("blitzware-node-api-sdk");

// Chain with expressRequireAuth() - role check requires auth to be present
router.post("/admin/dashboard", expressRequireAuth(), expressRequireRole("admin"), (req, res) => {
  res.json({ ok: true, message: "Admin dashboard" });
});
```

**Koa example:**

```js
const { koaRequireAuth, koaRequireRole } = require("blitzware-node-api-sdk");

// Chain with koaRequireAuth() - role check requires auth to be present
router.post("/admin/dashboard", koaRequireAuth(), koaRequireRole("admin"), (ctx) => {
  ctx.body = { ok: true, message: "Admin dashboard" };
});
```

For user access tokens, BlitzWare introspection payloads can include identity metadata such as `sub`, `username`, `email`, `roles`, and token metadata such as `exp`, `iat`, `aud`, `iss`, and `jti`. The SDK does not fetch `userinfo`; it validates the token and passes the introspection payload through unchanged.

The role middleware will:
- Return `401 Unauthorized` if `req.auth`/`ctx.state.auth` is not set (user must be authenticated first)
- Return `403 Forbidden` if the user doesn't have the required role
- Allow the request to proceed if the user has the role

**Important:** Role checking middleware requires that authentication has already been performed. Always use it **after** `expressRequireAuth()`/`koaRequireAuth()` or ensure the global auth parser has run. The role middleware does NOT perform token introspection itself to avoid duplicate API calls.

**Note:** The role checking assumes the token introspection response includes a `roles` array in the payload. If a user has no roles, an empty array is assumed.

## Introspection behavior

The SDK's introspection helper (`src/utils.ts`) calls your auth server's introspection endpoint.
By default the SDK's helper uses a base URL internal to the project, and it posts a JSON body containing:
`{ token, token_type_hint, client_id, client_secret }` to the `introspect` path. The parser will only attach `req.auth`/`ctx.state.auth`
when the introspection response indicates `active: true`.

If you call `expressRequireAuth()` (or `koaRequireAuth()`) and the parser has not been mounted, the enforcer will
attempt a one-shot introspection using the configured client credentials before rejecting the request.

Successful introspection responses are cached per auth instance for up to 30 seconds by default. The cache is capped by
the token's `exp` claim when present, does not cache failed introspection attempts, and coalesces concurrent checks for
the same token. Configure it with `introspectionCacheTtlMs`, or set `introspectionCacheTtlMs: 0` to disable caching.

```js
const auth = createAuth({
  clientId: process.env.BLITZWARE_CLIENT_ID,
  clientSecret: process.env.BLITZWARE_CLIENT_SECRET,
  introspectionCacheTtlMs: 10000,
});
```

## TypeScript

The SDK exports auth context types that can be used with custom request or state typing:

```ts
import type {
  AuthenticatedExpressRequest,
  AuthenticatedKoaState,
  AuthPayload,
} from "blitzware-node-api-sdk";

type MyClaims = AuthPayload & {
  sub: string;
  username: string;
  email: string | null;
  roles: string[];
};

type AuthedRequest = AuthenticatedExpressRequest<MyClaims>;
type AuthedKoaState = AuthenticatedKoaState<MyClaims>;
```

## Configuration / environment

Do not hardcode sensitive secrets in source. Provide them at runtime via environment variables or a secrets manager.
Common environment variables used in examples:

- `BLITZWARE_CLIENT_ID` — client id used for token introspection
- `BLITZWARE_CLIENT_SECRET` — client secret used for token introspection
- `BLITZWARE_AUTH_BASE_URL` — optional managed auth base URL, for example `https://acme.auth.blitzware.xyz/api/auth/`
- `PORT` — example server port

## Examples

- `examples/express-example.js` shows mounting `expressAuth(...)` once and protecting a route with `expressRequireAuth()`.
- `examples/koa-example.js` shows the equivalent Koa usage.

## Tests

Tests are written with Jest and mock the introspection HTTP client. Run:

```bash
yarn install
yarn test
```

## Notes and troubleshooting

- `authBaseUrl` is optional. Omit it to keep introspecting tokens at `https://auth.blitzware.xyz/api/auth/`; set it to the managed auth domain shown in the BlitzWare dashboard, such as `https://acme.auth.blitzware.xyz/api/auth/`.
- This SDK continues to use token introspection. It does not add JWKS validation, ID token validation, or OIDC discovery requirements.
- If you import the SDK from `../dist` during local development, run `yarn build` in the SDK before starting your example app so
  `dist/` is up to date.
- If you see `Auth middleware not initialized` when calling `expressRequireAuth()`, ensure you called `expressAuth(...)` earlier (it must be called at app bootstrap to configure the global client credentials), or mount the parser returned by `expressAuth(...)`.
- Use `createAuth(options)` when you want isolated middleware instances instead of the backwards-compatible global helper pattern.

## Contributing

PRs welcome. Keep the SDK focused on verification/introspection helpers for resource servers and avoid adding token issuance.
