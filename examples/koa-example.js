const Koa = require("koa");
const Router = require("@koa/router");
const bodyParser = require("koa-bodyparser");
require("dotenv").config();
const { koaAuth, koaRequireAuth } = require("../dist");

const app = new Koa();
const router = new Router();
app.use(bodyParser());

app.use(
  koaAuth({
    clientId: process.env.BLITZWARE_CLIENT_ID,
    clientSecret: process.env.BLITZWARE_CLIENT_SECRET,
  })
);

router.get("/public", (ctx) => {
  ctx.body = { ok: true, public: true };
});

router.get("/protected", koaRequireAuth(), (ctx) => {
  ctx.body = { ok: true, user: ctx.state.auth && ctx.state.auth.payload };
});

app.use(router.routes()).use(router.allowedMethods());

const port = process.env.PORT;
app.listen(port, () =>
  console.log(`Koa API example listening on http://localhost:${port}`)
);
