'use strict';

// For mgmt, it's ok to connect to localhost.
const config = {
  redis:{
    host: 'localhost', // For mgmt, we always use localhost, rather than docker container name.
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
  },
};

const { isMainThread, parentPort } = require("worker_threads");
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const execFile = util.promisify(require('child_process').execFile);
const metadata = require('./metadata');
const platform = require('./platform');
const ioredis = require('ioredis');
const redis = require('js-core/redis').create({config: config.redis, redis: ioredis});
const utils = require('js-core/utils');
const keys = require('js-core/keys');
const pkg = require('./package.json');

if (!isMainThread) {
  threadMain();
}

async function threadMain() {
  // Setup the OS for redis, which should never depends on redis.
  await platform.initOs();

  // Always restart the redis container.
  if (true) {
    // Note that we should never use 'docker rm -f redis', or data maybe discard. Instead, we should use command similar
    // to 'docker stop redis' to allow redis to save data to disk.
    const starttime = new Date();
    await utils.stopContainerQuiet(execFile, metadata.market.redis.name, true, 15);

    // Now we start redis again, to keep it with the latest configurations and params.
    const runtime = new Date();
    const dockerArgs = await utils.generateDockerArgs(platform, null, metadata.market.redis);
    await startContainer(metadata.market.redis.name, dockerArgs);
    console.log(`Thread #market: restart redis container, stop=${runtime - starttime}ms, start=${new Date() - runtime}ms`);
  }

  // Wait for redis to be ready.
  while (true) {
    const [all, running] = await queryContainer(metadata.market.redis.name);
    if (all?.ID && running?.ID) {
      console.log(`Thread #market: Redis is running, id=${all.ID}`);
      break;
    }
    new Promise(resolve => setTimeout(resolve, 300));
  }

  // We must initialize the thread first.
  const {region, registry} = await platform.init();
  console.log(`Thread #market: initialize region=${region}, registry=${registry}, version=v${pkg.version}`);

  // Note that we always restart the platform container.
  await utils.removeContainerQuiet(execFile, metadata.market.platform.name, true);
  console.log(`Thread #market: Restart container ${metadata.market.platform.name}`);

  while (true) {
    try {
      await doThreadMain();
    } catch (e) {
      console.error(`Thread #market: err`, e);
      await new Promise(resolve => setTimeout(resolve, 30 * 1000));
    } finally {
      await new Promise(resolve => setTimeout(resolve, 10 * 1000));
    }
  }
}

async function doThreadMain() {
  // Try to restart the redis container.
  const r0 = await doContainerMain(metadata.market.redis);
  if (r0) {
    parentPort.postMessage({metadata: {redis: r0}});
  }

  // Try to restart the platform container.
  const r1 = await doContainerMain(metadata.market.platform);
  if (r1) {
    parentPort.postMessage({metadata: {platform: r1}});
  }
}

async function doContainerMain(conf) {
  let container = null;

  // Query the container from docker.
  let [all, running] = await queryContainer(conf.name);
  if (all?.ID) {
    container = all;
    console.log(`Thread #market: query ID=${all.ID}, State=${all.State}, Status=${all.Status}, running=${running?.ID}`);
  }

  // Restart the SRS container.
  if (!all?.ID || !running?.ID) {
    // Query container enabled status from redis.
    const disabled = await redis.hget(keys.redis.SRS_CONTAINER_DISABLED, conf.name);
    if (disabled === 'true') {
      console.log(`Thread #market: container ${conf.name} disable`);
      return container;
    }

    console.log(`Thread #market: start container`);
    const privateIPv4 = await platform.ipv4();
    const dockerArgs = await utils.generateDockerArgs(platform, privateIPv4, conf);
    await startContainer(conf.name, dockerArgs);

    // Cleaup the previous unused images.
    await cleanupImages(conf);

    all = (await queryContainer(conf.name))[0];
    if (all && all.ID) container = all;
    console.log(`Thread #market: create ID=${all.ID}, State=${all.State}, Status=${all.Status}`);
  }

  return container;
}

// See https://docs.docker.com/config/formatting/
async function queryContainer(name) {
  let all, running;

  try {
    const {stdout} = await exec(`docker ps -a -f name=${name} --format '{{json .}}'`);
    all = stdout ? JSON.parse(stdout) : {};
  } catch (e) {
    console.log(`Thread #market: Ignore query container ${name} err`, e);
  }

  try {
    const {stdout} = await exec(`docker ps -f name=${name} --format '{{json .}}'`);
    running = stdout ? JSON.parse(stdout) : {};
  } catch (e) {
    console.log(`Thread #market: Ignore query container ${name} err`, e);
  }

  return [all, running];
}
exports.queryContainer = queryContainer;

async function startContainer(name, dockerArgs) {
  console.log(`Thread #market: docker ${dockerArgs.join(' ')}`);

  // Only remove the container when got ID, to avoid fail for CentOS.
  const all = (await queryContainer(name))[0];
  if (all?.ID) {
    await utils.removeContainerQuiet(execFile, name);
    console.log(`Thread #market: docker run remove ID=${all.ID}`);
  }

  await execFile('docker', dockerArgs);
  console.log(`Thread #market: docker run ok`);
}
exports.startContainer = startContainer;

async function cleanupImages(conf) {
  const previousImage = await redis.hget(keys.redis.SRS_DOCKER_IMAGES, conf.name);

  const newImage = await conf.image();
  if (newImage) await redis.hset(keys.redis.SRS_DOCKER_IMAGES, conf.name, newImage);

  if (!previousImage || !newImage || previousImage === newImage) {
    return console.log(`Thread #market: Keep image ${newImage}, previous is ${previousImage}`);
  }

  try {
    const {stdout} = await execFile('docker', ['rmi', previousImage]);
    console.log(`Thread #market: Remove previous image ${previousImage}, ${stdout}`);
  } catch (e) {
    console.warn(`Thread #market: Ignore docker rmi ${previousImage}, err`, e);
  }
}

