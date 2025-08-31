const express = require("express");
require("dotenv").config();
const { expressAuth, expressRequireAuth } = require("../dist");

const app = express();
app.use(express.json());

app.use(
  expressAuth({
    clientId: process.env.BLITZWARE_CLIENT_ID,
    clientSecret: process.env.BLITZWARE_CLIENT_SECRET,
  })
);

app.get("/public", (req, res) => res.json({ ok: true, public: true }));

app.get("/protected", expressRequireAuth(), (req, res) => {
  res.json({ ok: true, user: req.auth && req.auth.payload });
});

const port = process.env.PORT;
app.listen(port, () =>
  console.log(`Express API example listening on http://localhost:${port}`)
);
