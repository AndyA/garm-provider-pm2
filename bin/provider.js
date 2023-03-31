const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const _ = require("lodash");
const Promise = require("bluebird");
const pm2 = Promise.promisifyAll(require("pm2"));
const axios = require("axios");
const { produce } = require("immer");

const WORK = path.resolve("./work");

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

const logName = new Date().toISOString() + "." + process.pid;

const record = mutStore(path.join(WORK, "logs", `${logName}.json`));
const mention = (msg, data) =>
  record(log => {
    if (!log.messages) log.messages = [];
    log.messages.push({ msg, data });
  });

async function workDir(...name) {
  const dir = path.join(WORK, ...name);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

const runCommand = async (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore", env })
      .on("close", resolve)
      .on("error", reject);
  });

const doCommand = async (cmd, args, env) => {
  const rc = await runCommand(cmd, args, env);
  if (rc !== 0) throw new Error(`${cmd} failed: ${rc}`);
};

const osMap = {
  darwin: "osx",
  win32: "win",
};

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
const sendOutput = async doc => {
  await record(log => {
    log.output = doc;
  });
  process.stdout.write(JSON.stringify(doc, null, 2) + "\n");
};

const pm2Status = {
  "online": "running",
  "stopped": "stopped",
  "stopping": "stopped",
  "waiting restart": "running",
  "launching": "creating",
  "errored": "error",
};

const env2Instance = env => ({
  provider_id: env.GPM2_NAME,
  name: env.GPM2_NAME,
  os_type: env.GPM2_OS,
  os_name: "ubuntu",
  os_version: "22.04",
  os_arch: env.GPM2_ARCHITECTURE,
  status: pm2Status[env.GPM2_STATUS] ?? env.GPM2_STATUS,
  pool_id: env.GPM2_POOL_ID,
  provider_fault: "",
});

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

const getHeaders = env => ({
  Accept: `application/json`,
  Authorization: `Bearer ${env.GPM2_INSTANCE_TOKEN}`,
});

async function getRunnerToken(env) {
  const res = await axios.get(
    `${env.GPM2_METADATA_URL}/runner-registration-token`,
    { headers: getHeaders(env) }
  );
  return res.data;
}

async function updateStatus(env, obj) {
  const res = await axios.post(env.GPM2_CALLBACK_URL, obj, {
    headers: getHeaders(env),
  });
}

async function createInstance() {
  const { tools, ...bootstrap } = readInput();
  await record(log => {
    log.input = { tools, ...bootstrap };
  });

  const stashDir = await workDir("stash");
  const runnerHome = await workDir("job", bootstrap.name);
  const status = "running";

  const tool = getMatchingTool(tools);

  const baseEnv = {
    ...process.env,
    ...gpm2Env({ stashDir, runnerHome, status }),
    ...gpm2Env(tool),
    ...gpm2Env(bootstrap),
  };

  // Download the action runner and create runnerHome
  await doCommand("./bin/download.sh", [], baseEnv);

  await mention(`made work dir`);

  const githubToken = await getRunnerToken(baseEnv);

  await mention(`got token`, githubToken);

  const env = {
    ...baseEnv,
    ...gpm2Env({ githubToken }),
  };

  await mention(`made child env`, env);

  await doCommand("./bin/bootstrap.sh", [], env);

  await mention(`bootstrapped`);

  await pm2.startAsync({
    name: bootstrap.name,
    script: "./run.sh",
    interpreter: "/usr/bin/bash",
    cwd: runnerHome,
    autorestart: false,
    env: { ...env },
  });

  await updateStatus(env, { status: "idle", message: "Runner launched" });

  await sendOutput(env2Instance(env));
}

async function runnerCleanup(id) {
  const dir = await workDir("job", id);
  await fs.promises.rm(dir, { recursive: true });
}

async function killInstance(id) {
  await pm2.stopAsync(id);
  await pm2.deleteAsync(id);
  await runnerCleanup(id);
}

async function deleteInstance() {
  await killInstance(process.env.GARM_INSTANCE_ID);
}

async function getInstances() {
  const procs = await pm2.listAsync();
  return procs
    .map(proc => ({
      ...(proc.pm2_env?.env ?? {}),
      GPM2_STATUS: proc.pm2_env?.status,
    }))
    .filter(env => env.GPM2_POOL_ID === process.env.GARM_POOL_ID);
}

async function listInstances() {
  const runners = await getInstances();
  await sendOutput(runners.map(env2Instance));
}

async function removeAllInstances() {
  const runners = await getInstances();
  await Promise.all(runners.map(env => env.GPM2_NAME).map(killInstance));
}

async function getInstance() {
  const runners = await getInstances();
  const inst = runners.filter(
    env => env.GPM2_NAME === process.env.GARM_INSTANCE_ID
  );
  if (inst.length === 0)
    throw new Error(`Can't find ${process.env.GARM_INSTANCE_ID}`);
  await sendOutput(inst[0]);
}

async function startInstance() {
  await pm2.restartAsync(process.env.GARM_INSTANCE_ID);
}

async function stopInstance() {
  await pm2.stopAsync(process.env.GARM_INSTANCE_ID);
}

async function init() {
  await pm2.connectAsync().catch(e => console.error(e));
}

async function main() {
  await record(log => {
    log.env = process.env;
  });
  await init();

  switch (process.env.GARM_COMMAND) {
    // CreateInstance creates a new compute instance in the provider.
    case "CreateInstance":
      return createInstance();

    // Delete instance will delete the instance in a provider.
    case "DeleteInstance":
      return deleteInstance();

    // GetInstance will return details about one instance.
    case "GetInstance":
      return getInstance();

    // ListInstances will list all instances for a provider.
    case "ListInstances":
      return listInstances();

    // RemoveAllInstances will remove all instances created by this provider.
    case "RemoveAllInstances":
      return removeAllInstances();

    // Stop shuts down the instance.
    case "Stop":
    case "StopInstance":
      return stopInstance();

    // Start boots up an instance.
    case "Start":
    case "StartInstance":
      return startInstance();

    // Unknown
    default:
      throw new Error(
        `Unknown GARM_COMMAND: ${process.env.GARM_COMMAND ?? "*missing*"}`
      );
  }
}

const bail = e => {
  console.error(e);
  process.exit(1);
};

process.on("uncaughtException", bail);

main()
  .catch(bail)
  .finally(() => pm2.disconnect());
