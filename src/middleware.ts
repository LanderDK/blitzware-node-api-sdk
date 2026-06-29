import { introspectToken } from "./utils";

export type AuthPayload = {
  active: boolean;
  roles?: string[];
  exp?: number;
  [claim: string]: unknown;
};

export type AuthContext<TPayload extends AuthPayload = AuthPayload> = {
  token: string;
  payload: TPayload;
};

export type AuthOptions = {
  clientId: string;
  clientSecret: string;
  /**
   * Max time to cache successful introspection responses. Defaults to 30s.
   * Set to 0 to disable caching.
   */
  introspectionCacheTtlMs?: number;
};

export type AuthenticatedExpressRequest<
  TPayload extends AuthPayload = AuthPayload
> = {
  auth?: AuthContext<TPayload>;
};

export type AuthenticatedKoaState<
  TPayload extends AuthPayload = AuthPayload
> = {
  auth?: AuthContext<TPayload>;
};

export type AuthMiddleware = ReturnType<typeof createAuth>;

const DEFAULT_INTROSPECTION_CACHE_TTL_MS = 30_000;

let globalAuth: AuthMiddleware | undefined;

type CachedIntrospection = {
  payload: AuthPayload;
  expiresAt: number;
};

function getBearerToken(headers: any): string | undefined {
  const authHeader = headers && (headers.authorization || headers.Authorization);
  if (!authHeader || !authHeader.startsWith("Bearer ")) return undefined;
  return authHeader.substr(7);
}

function getRoles(payload: AuthPayload): string[] {
  return Array.isArray(payload.roles) ? payload.roles : [];
}

function getCacheExpiry(payload: AuthPayload, ttlMs: number, now: number) {
  const ttlExpiry = now + ttlMs;
  const tokenExpiry =
    typeof payload.exp === "number" && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : ttlExpiry;
  return Math.min(ttlExpiry, tokenExpiry);
}

/**
 * Factory that returns a parser (non-enforcing) and a per-route enforcer.
 * Parser is safe to mount globally (app.use(parser)) and will introspect once per request.
 * requireAuth() is used per-route to enforce authentication.
 */
export function createAuth(options: AuthOptions) {
  const cacheTtlMs =
    options.introspectionCacheTtlMs ?? DEFAULT_INTROSPECTION_CACHE_TTL_MS;
  const cache = new Map<string, CachedIntrospection>();
  const inFlight = new Map<string, Promise<AuthPayload>>();

  const authenticateToken = async (token: string): Promise<AuthContext> => {
    const now = Date.now();
    const cached = cache.get(token);
    if (cached && cached.expiresAt > now) {
      return { token, payload: cached.payload };
    }
    if (cached) {
      cache.delete(token);
    }

    let payloadPromise = inFlight.get(token);
    if (!payloadPromise) {
      payloadPromise = introspectToken(
        token,
        "access_token",
        String(options.clientId),
        String(options.clientSecret)
      ) as Promise<AuthPayload>;
      inFlight.set(token, payloadPromise);
    }

    try {
      const payload = await payloadPromise;
      if (payload && payload.active && cacheTtlMs > 0) {
        const expiresAt = getCacheExpiry(payload, cacheTtlMs, Date.now());
        if (expiresAt > Date.now()) {
          cache.set(token, { payload, expiresAt });
        }
      }
      return { token, payload };
    } finally {
      inFlight.delete(token);
    }
  };

  // parser: attach req.auth / ctx.state.auth when a valid token exists
  const expressParse = async (req: any, _res: any, next: any) => {
    try {
      const token = getBearerToken(req.headers);
      if (!token) return next();
      try {
        const auth = await authenticateToken(token);
        if (auth.payload.active) req.auth = auth;
      } catch {
        // invalid token -> leave req.auth undefined
      }
    } catch (err) {
      // parser must not throw
      console.error("Auth parser error:", err);
    }
    return next();
  };

  const expressRequire = () => {
    return async (req: any, res: any, next: any) => {
      // Handle authentication first
      if (!req.auth) {
        // attempt introspection on-demand if parser wasn't mounted
        const token = getBearerToken(req.headers);
        if (!token) {
          return res.status(401).send("Unauthorized");
        }
        try {
          const auth = await authenticateToken(token);
          if (!auth.payload.active)
            return res.status(401).send("Unauthorized");
          req.auth = auth;
        } catch (introspectionErr) {
          console.error("Token introspection failed:", introspectionErr);
          return res.status(401).send("Unauthorized");
        }
      }
      
      // Authentication successful, proceed to next middleware
      // Don't catch errors from downstream handlers
      return next();
    };
  };

  const expressRequireRole = (role: string) => {
    return async (req: any, res: any, next: any) => {
      // Ensure user is authenticated first
      if (!req.auth) {
        return res.status(401).send("Unauthorized");
      }

      // Check if user has the required role
      const roles = getRoles(req.auth.payload);
      if (!roles.includes(role)) {
        return res.status(403).send("Forbidden");
      }

      return next();
    };
  };

  // Koa equivalents
  const koaParse = async (ctx: any, next: any) => {
    try {
      const token = getBearerToken(ctx.headers);
      if (!token) return await next();
      try {
        const auth = await authenticateToken(token);
        if (auth.payload.active) ctx.state.auth = auth;
      } catch {
        // ignore invalid token
      }
    } catch (err) {
      console.error("Auth parser error:", err);
    }
    await next();
  };

  const koaRequire = () => {
    return async (ctx: any, next: any) => {
      // Handle authentication first
      if (!ctx.state?.auth) {
        const token = getBearerToken(ctx.headers);
        if (!token) {
          ctx.status = 401;
          ctx.body = "Unauthorized";
          return;
        }
        try {
          const auth = await authenticateToken(token);
          if (!auth.payload.active) {
            ctx.status = 401;
            ctx.body = "Unauthorized";
            return;
          }
          ctx.state.auth = auth;
        } catch (introspectionErr) {
          console.error("Token introspection failed:", introspectionErr);
          ctx.status = 401;
          ctx.body = "Unauthorized";
          return;
        }
      }
      
      // Authentication successful, proceed to next middleware
      // Don't catch errors from downstream handlers
      await next();
    };
  };

  const koaRequireRole = (role: string) => {
    return async (ctx: any, next: any) => {
      // Ensure user is authenticated first
      if (!ctx.state?.auth) {
        ctx.status = 401;
        ctx.body = "Unauthorized";
        return;
      }

      // Check if user has the required role
      const roles = getRoles(ctx.state.auth.payload);
      if (!roles.includes(role)) {
        ctx.status = 403;
        ctx.body = "Forbidden";
        return;
      }

      await next();
    };
  };

  return {
    expressParse,
    expressRequire,
    expressRequireRole,
    koaParse,
    koaRequire,
    koaRequireRole,
  };
}

/**
 * Backwards-compatible helpers:
 * expressAuth/koaAuth set the global options and return the parser middleware so
 * app.use(expressAuth(...)) works as expected in a multi-file project.
 */
export function expressAuth(options: AuthOptions) {
  globalAuth = createAuth(options);
  return globalAuth.expressParse;
}

export function expressRequireAuth() {
  if (!globalAuth) {
    throw new Error("Auth middleware not initialized");
  }
  return globalAuth.expressRequire();
}

export function expressRequireRole(role: string) {
  if (!globalAuth) {
    throw new Error("Auth middleware not initialized");
  }
  return globalAuth.expressRequireRole(role);
}

export function koaAuth(options: AuthOptions) {
  globalAuth = createAuth(options);
  return globalAuth.koaParse;
}

export function koaRequireAuth() {
  if (!globalAuth) {
    throw new Error("Auth middleware not initialized");
  }
  return globalAuth.koaRequire();
}

export function koaRequireRole(role: string) {
  if (!globalAuth) {
    throw new Error("Auth middleware not initialized");
  }
  return globalAuth.koaRequireRole(role);
}
