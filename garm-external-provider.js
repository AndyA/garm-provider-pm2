const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const _ = require("lodash");
const Promise = require("bluebird");
const pm2 = Promise.promisifyAll(require("pm2"));
const axios = require("axios");
const { produce } = require("immer");

// const WORK = path.resolve("./work");
const WORK = "/home/andy/Works/Github/garm-provider-pm2/work";
const TMP = "/home/andy/Works/Github/garm-provider-pm2/tmp";

const saveJSON = async (name, data) => {
  await fs.promises.mkdir(path.dirname(name), { recursive: true });
  const tmp = `${name}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.promises.rename(tmp, name);
};

const loadJSON = name => fs.promises.readFile(name, "utf-8").then(JSON.parse);

const mutStore = name => async mutator => {
  const data = await loadJSON(name).catch(e => ({}));
  const next = produce(data, mutator);
  if (next !== data) await saveJSON(name, next);
};

const record = mutStore(path.join(TMP, "log.json"));

// const logFile = path.join(TMP, "log.json");
// const log = await loadJSON(logFile).catch(e => ({}));
// (log.commands = log.commands || []).push(process.env.GARM_COMMAND);
// await saveJSON(logFile, log);

async function test() {
  const conn = await pm2.connectAsync();

  const env = _.pickBy(process.env, (v, k) => /^GARM_/.test(k));

  await pm2.startAsync({
    name: "test",
    script: "./bin/bootstrap.sh",
    interpreter: "/usr/bin/bash",
    autorestart: false,
    env,
  });

  const running = await pm2.listAsync();
  console.log(JSON.stringify(running, null, 2));
  await pm2.stopAsync("test");
}

async function workDir(...name) {
  const dir = path.join(WORK, ...name);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

const runCommand = async (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", env })
      .on("close", resolve)
      .on("error", reject);
  });

const osMap = {
  darwin: "osx",
  win32: "win",
};

const idChars = "0123456789abcdefghijklmnopqrstuvwxyz";

const makeIdent = length =>
  Array.from({ length })
    .map(() => idChars.charAt(Math.random() * idChars.length))
    .join("");

const makeEnv = prefix => obj =>
  _(obj)
    .toPairs()
    .map(([k, v]) => [
      prefix + _.snakeCase(k).toUpperCase(),
      Array.isArray(v) ? v.join(",") : v,
    ])
    .fromPairs()
    .value();

const gpm2Env = makeEnv("GPM2_");

function getProfile() {
  const architecture = os.arch();
  const platform = os.platform();
  return { architecture, os: osMap[platform] ?? platform };
}

const readInput = () => JSON.parse(fs.readFileSync(process.stdin.fd, "utf-8"));
const sendOutput = doc =>
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");

function getMatchingTool(tools) {
  const profile = getProfile();
  const avail = tools.filter(
    ({ os, architecture }) =>
      os === profile.os && architecture === profile.architecture
  );

  if (avail.length !== 1) {
    const sig = `${profile.os}/${profile.architecture}`;
    if (avail.length === 0) throw new Error(`No workers available for ${sig}`);
    console.warn(`${avail.length} workers available for ${sig}`);
  }

  return avail[0];
}

async function getRunnerToken(env) {
  const headers = {
    Accept: `application/json`,
    Authorization: `Bearer ${env.GPM2_INSTANCE_TOKEN}`,
  };

  const res = await axios.get(
    `${env.GPM2_METADATA_URL}/runner-registration-token`,
    { headers }
  );
  console.log(res.data);
  return res.data;
}

async function createInstance() {
  const { tools, ...bootstrap } = readInput();

  await saveJSON("tmp/job.json", { tools, ...bootstrap });

  const runnerId = `garm-${makeIdent(20)}`;
  const stashDir = await workDir("stash");
  const runnerHome = await workDir("job", runnerId);

  const tool = getMatchingTool(tools);

  const env = {
    ...process.env,
    ...gpm2Env({ runnerId, stashDir, runnerHome }),
    ...gpm2Env(tool),
    ...gpm2Env(bootstrap),
  };

  // Download the action runner and create runnerHome
  await runCommand("./bin/download.sh", [], env);

  const tok = await getRunnerToken(env);
  await record(log => {
    if (!log.tokens) log.tokens = [];
    log.tokens.push(tok);
  });
}

async function init() {
  console.log(`connecting...`);
  // const conn = await pm2.connectAsync().catch(e => console.log(e));
  // console.log(`connected:`, conn);
}

async function main() {
  console.log(`in hook`);
  await init();
  console.log(`done init`);

  await record(log => {
    if (!log.invoke) log.invoke = [];
    log.invoke.push(process.env);
  });
  console.log(`updated log, dispatching ${process.env.GARM_COMMAND}`);

  switch (process.env.GARM_COMMAND) {
    // CreateInstance creates a new compute instance in the provider.
    case "CreateInstance":
      return createInstance();

    // Delete instance will delete the instance in a provider.
    case "DeleteInstance":
      break;
    // GetInstance will return details about one instance.
    case "GetInstance":
      break;
    // ListInstances will list all instances for a provider.
    case "ListInstances":
      break;
    // RemoveAllInstances will remove all instances created by this provider.
    case "RemoveAllInstances":
      break;
    // Stop shuts down the instance.
    case "Stop":
      break;
    // Start boots up an instance.
    case "Start":
      break;

    // Unknown
    default:
      throw new Error(
        `Unknown GARM_COMMAND: ${process.env.GARM_COMMAND ?? "*missing*"}`
      );
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    pm2.disconnect();
  });
