import { introspectToken } from "./utils";

type AuthOptions = {
  clientId: string;
  clientSecret: string;
};

let globalAuthOptions: AuthOptions | undefined;

/**
 * Factory that returns a parser (non-enforcing) and a per-route enforcer.
 * Parser is safe to mount globally (app.use(parser)) and will introspect once per request.
 * requireAuth() is used per-route to enforce authentication.
 */
export function createAuth(options: AuthOptions) {
  // parser: attach req.auth / ctx.state.auth when a valid token exists
  const expressParse = async (req: any, _res: any, next: any) => {
    try {
      const authHeader =
        req.headers && (req.headers.authorization || req.headers.Authorization);
      if (!authHeader || !authHeader.startsWith("Bearer ")) return next();
      const token = authHeader.substr(7);
      try {
        const data = await introspectToken(
          token,
          "access_token",
          String(options.clientId),
          String(options.clientSecret)
        );
        if (data && data.active) req.auth = { token, payload: data };
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
        const authHeader =
          req.headers &&
          (req.headers.authorization || req.headers.Authorization);
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return res.status(401).send("Unauthorized");
        }
        const token = authHeader.substr(7);
        try {
          const data = await introspectToken(
            token,
            "access_token",
            String(options.clientId),
            String(options.clientSecret)
          );
          if (!data || !data.active)
            return res.status(401).send("Unauthorized");
          req.auth = { token, payload: data };
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

  // Koa equivalents
  const koaParse = async (ctx: any, next: any) => {
    try {
      const authHeader =
        ctx.headers && (ctx.headers.authorization || ctx.headers.Authorization);
      if (!authHeader || !authHeader.startsWith("Bearer ")) return await next();
      const token = authHeader.substr(7);
      try {
        const data = await introspectToken(
          token,
          "access_token",
          String(options.clientId),
          String(options.clientSecret)
        );
        if (data && data.active) ctx.state.auth = { token, payload: data };
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
        const authHeader =
          ctx.headers &&
          (ctx.headers.authorization || ctx.headers.Authorization);
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
          ctx.status = 401;
          ctx.body = "Unauthorized";
          return;
        }
        const token = authHeader.substr(7);
        try {
          const data = await introspectToken(
            token,
            "access_token",
            String(options.clientId),
            String(options.clientSecret)
          );
          if (!data || !data.active) {
            ctx.status = 401;
            ctx.body = "Unauthorized";
            return;
          }
          ctx.state.auth = { token, payload: data };
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

  return {
    expressParse,
    expressRequire,
    koaParse,
    koaRequire,
  };
}

/**
 * Backwards-compatible helpers:
 * expressAuth/koaAuth set the global options and return the parser middleware so
 * app.use(expressAuth(...)) works as expected in a multi-file project.
 */
export function expressAuth(options: AuthOptions) {
  globalAuthOptions = options;
  return createAuth(options).expressParse;
}

export function expressRequireAuth() {
  if (!globalAuthOptions) {
    throw new Error("Auth middleware not initialized");
  }
  return createAuth(globalAuthOptions).expressRequire();
}

export function koaAuth(options: AuthOptions) {
  globalAuthOptions = options;
  return createAuth(options).koaParse;
}

export function koaRequireAuth() {
  if (!globalAuthOptions) {
    throw new Error("Auth middleware not initialized");
  }
  return createAuth(globalAuthOptions).koaRequire();
}
