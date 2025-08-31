import express from "express";
import request from "supertest";
import { expressAuth, expressRequireAuth } from "../src/middleware";

// Mock the introspectToken helper used by middleware
jest.mock("../src/utils", () => ({
  introspectToken: jest.fn(async (token: string) => {
    // return a simple payload for any token
    return { active: true, sub: "123", name: "Bob" };
  }),
}));

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
});
