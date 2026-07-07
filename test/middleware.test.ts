import express from "express";
import request from "supertest";
import {
  createAuth,
  expressAuth,
  expressRequireAuth,
  expressRequireRole,
} from "../src/middleware";
import { introspectToken } from "../src/utils";

const Koa = require("koa");
const Router = require("@koa/router");

// Mock the introspectToken helper used by middleware
jest.mock("../src/utils", () => ({
  introspectToken: jest.fn(async (token: string) => {
    if (token === "admintoken") {
      return { active: true, sub: "123", name: "Bob", roles: ["admin"] };
    }
    if (token === "usertoken") {
      return { active: true, sub: "123", name: "Bob", roles: ["user"] };
    }
    if (token === "stringroles") {
      return { active: true, sub: "123", name: "Bob", roles: "superadmin" };
    }

    return { active: true, sub: "123", name: "Bob" };
  }),
}));

const mockedIntrospectToken = introspectToken as jest.MockedFunction<
  typeof introspectToken
>;

describe("Express middleware (introspection)", () => {
  const app = express();
  app.use(express.json());
  // mount middleware directly on route to simulate protected endpoint
  app.get(
    "/protected",
    expressAuth({ clientId: "test-client", clientSecret: "test-secret" }),
    expressRequireAuth(),
    (req, res) => res.json({ ok: true, payload: (req as any).auth.payload })
  );
  app.get(
    "/admin",
    expressAuth({ clientId: "test-client", clientSecret: "test-secret" }),
    expressRequireAuth(),
    expressRequireRole("admin"),
    (_req, res) => res.json({ ok: true })
  );

  beforeEach(() => {
    mockedIntrospectToken.mockClear();
  });

  it("returns 401 for missing token", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
  });

  it("allows valid token (via introspection)", async () => {
    const res = await request(app)
      .get("/protected")
      .set("Authorization", `Bearer sometoken`);
    expect(res.status).toBe(200);
    expect(res.body.payload.name).toBe("Bob");
  });

  it("allows users with the required role", async () => {
    const res = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer admintoken`);
    expect(res.status).toBe(200);
  });

  it("returns 403 when the required role is missing", async () => {
    const res = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer usertoken`);
    expect(res.status).toBe(403);
  });

  it("does not treat string role claims as role arrays", async () => {
    const res = await request(app)
      .get("/admin")
      .set("Authorization", `Bearer stringroles`);
    expect(res.status).toBe(403);
  });

  it("reuses successful introspection responses within the cache ttl", async () => {
    const auth = createAuth({
      clientId: "test-client",
      clientSecret: "test-secret",
      introspectionCacheTtlMs: 60_000,
    });
    const cachedApp = express();
    cachedApp.get(
      "/cached",
      auth.expressParse,
      auth.expressRequire(),
      (_req, res) => res.json({ ok: true })
    );

    await request(cachedApp)
      .get("/cached")
      .set("Authorization", `Bearer cachetoken`)
      .expect(200);
    await request(cachedApp)
      .get("/cached")
      .set("Authorization", `Bearer cachetoken`)
      .expect(200);

    expect(mockedIntrospectToken).toHaveBeenCalledTimes(1);
  });

  it("passes custom authBaseUrl to introspection", async () => {
    const auth = createAuth({
      clientId: "test-client",
      clientSecret: "test-secret",
      authBaseUrl: "https://acme.auth.blitzware.xyz/api/auth/",
    });
    const customApp = express();
    customApp.get(
      "/custom",
      auth.expressParse,
      auth.expressRequire(),
      (_req, res) => res.json({ ok: true })
    );

    await request(customApp)
      .get("/custom")
      .set("Authorization", `Bearer customtoken`)
      .expect(200);

    expect(mockedIntrospectToken).toHaveBeenCalledWith(
      "customtoken",
      "access_token",
      "test-client",
      "test-secret",
      "https://acme.auth.blitzware.xyz/api/auth/"
    );
  });
});

describe("Koa middleware (introspection)", () => {
  const createKoaApp = () => {
    const auth = createAuth({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    const app = new Koa();
    const router = new Router();

    app.use(auth.koaParse);
    router.get(
      "/admin",
      auth.koaRequire(),
      auth.koaRequireRole("admin"),
      (ctx: any) => {
        ctx.body = { ok: true };
      }
    );
    app.use(router.routes());

    return app;
  };

  beforeEach(() => {
    mockedIntrospectToken.mockClear();
  });

  it("returns 401 for missing token", async () => {
    const res = await request(createKoaApp().callback()).get("/admin");
    expect(res.status).toBe(401);
  });

  it("allows users with the required role", async () => {
    const res = await request(createKoaApp().callback())
      .get("/admin")
      .set("Authorization", `Bearer admintoken`);
    expect(res.status).toBe(200);
  });

  it("returns 403 when the required role is missing", async () => {
    const res = await request(createKoaApp().callback())
      .get("/admin")
      .set("Authorization", `Bearer usertoken`);
    expect(res.status).toBe(403);
  });

  it("does not treat string role claims as role arrays", async () => {
    const res = await request(createKoaApp().callback())
      .get("/admin")
      .set("Authorization", `Bearer stringroles`);
    expect(res.status).toBe(403);
  });
});
