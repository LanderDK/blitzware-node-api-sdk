# blitzware-node-api-sdk

Lightweight Node.js SDK for BlitzWare resource servers (APIs).

This package provides simple middleware for Express and Koa to validate incoming bearer tokens.
It prefers token introspection (avoids shipping a shared signing secret) and also supports the common pattern
of mounting a non-enforcing parser once and enforcing auth on a per-route basis.

## What this package exports

- `expressAuth(options)` -> returns an Express parser middleware. Mount with `app.use(expressAuth(...))`.
- `expressRequireAuth()` -> returns an Express per-route enforcer middleware.
- `koaAuth(options)` -> returns a Koa parser middleware. Mount with `app.use(koaAuth(...))`.
- `koaRequireAuth()` -> returns a Koa per-route enforcer middleware.

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
const { expressRequireAuth } = require("blitzware-node-api-sdk");

router.get("/", (req, res) => res.json({ ok: true, users: [] })); // public

router.get("/me", expressRequireAuth(), (req, res) => {
  // parse middleware attached req.auth earlier if token present
  res.json({ ok: true, me: req.auth && req.auth.payload });
});

module.exports = router;
```

This pattern avoids re-creating auth middleware in every route file while ensuring per-route enforcement works.

## Introspection behavior

The SDK's introspection helper (`src/utils.ts`) calls your auth server's introspection endpoint.
By default the SDK's helper uses a base URL internal to the project, and it posts a JSON body containing:
`{ token, token_type_hint, client_id, client_secret }` to the `introspect` path. The parser will only attach `req.auth`/`ctx.state.auth`
when the introspection response indicates `active: true`.

If you call `expressRequireAuth()` (or `koaRequireAuth()`) and the parser has not been mounted, the enforcer will
attempt a one-shot introspection using the configured client credentials before rejecting the request.

## Configuration / environment

Do not hardcode sensitive secrets in source. Provide them at runtime via environment variables or a secrets manager.
Common environment variables used in examples:

- `BLITZWARE_CLIENT_ID` — client id used for token introspection
- `BLITZWARE_CLIENT_SECRET` — client secret used for token introspection
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

- If you import the SDK from `../dist` during local development, run `yarn build` in the SDK before starting your example app so
  `dist/` is up to date.
- If you see `Auth middleware not initialized` when calling `expressRequireAuth()`, ensure you called `expressAuth(...)` earlier (it must be called at app bootstrap to configure the global client credentials), or mount the parser returned by `expressAuth(...)`.
- The SDK intentionally leaves the choice of session/caching to the caller; consider adding short-lived caching around introspection for
  performance in heavy-load APIs.

## Contributing

PRs welcome. Keep the SDK focused on verification/introspection helpers for resource servers and avoid adding token issuance.
