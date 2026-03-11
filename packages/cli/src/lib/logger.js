import chalk from "chalk";

let verboseEnabled = false;
let quietEnabled = false;

export function setVerbose(enabled) {
  verboseEnabled = enabled;
}

export function setQuiet(enabled) {
  quietEnabled = enabled;
}

export function info(message, ...args) {
  if (!quietEnabled) {
    console.log(chalk.blue("ℹ"), message, ...args);
  }
}

export function success(message, ...args) {
  if (!quietEnabled) {
    console.log(chalk.green("✔"), message, ...args);
  }
}

export function warn(message, ...args) {
  console.log(chalk.yellow("⚠"), message, ...args);
}

export function error(message, ...args) {
  console.error(chalk.red("✖"), message, ...args);
}

export function verbose(message, ...args) {
  if (verboseEnabled) {
    console.log(chalk.gray("⋯"), message, ...args);
  }
}

export function log(message, ...args) {
  if (!quietEnabled) {
    console.log(message, ...args);
  }
}

export function newline() {
  if (!quietEnabled) {
    console.log();
  }
}

export const logger = {
  info,
  success,
  warn,
  error,
  verbose,
  log,
  newline,
  setVerbose,
  setQuiet,
};
export default logger;
