'use strict';

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const utils = require('js-core/utils');
utils.reloadEnv(dotenv, fs, path);
// Compatible with previous mgmt versions.
if (fs.existsSync('/srs-terraform/hooks/.env')) {
  dotenv.config({path: '/srs-terraform/hooks/.env'});
}
console.log(`load envs MGMT_PASSWORD=${'*'.repeat(process.env.MGMT_PASSWORD?.length)}`);

const Koa = require('koa');
const Router = require('koa-router');
const Cors = require('koa2-cors');
const BodyParser = require('koa-bodyparser');
const hooks = require('./hooks');
const pkg = require('./package.json');
const hls = require('./hls');
const record = require('./record');
const dvr = require('./dvr');
const vod = require('./vod');
const manager = require('./manager');

const app = new Koa();

app.use(Cors());
app.use(BodyParser());

// For Error handler.
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (e) {
    ctx.status = e.status || 500;
    ctx.body = utils.asResponse(e.code || 1, {
      message: e.message || e.err?.message || 'unknown error',
    });
    console.error(e);
  }
});

const router = new Router();

record.handle(dvr.handle(vod.handle(hls.handle(hooks.handle(router)))));

router.all('/terraform/v1/hooks/versions', async (ctx) => {
  ctx.body = utils.asResponse(0, {version: pkg.version});
});

app.use(router.routes());

///////////////////////////////////////////////////////////////////////////////////////////
const run = async () => {
  console.log(`Run with cwd=${process.cwd()}`);

  manager.run();

  app.listen(2021, () => {
    console.log(`Server start on http://localhost:2021`);
  });
};
run();

