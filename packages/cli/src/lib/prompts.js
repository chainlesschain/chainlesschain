import { confirm, select, input, password } from "@inquirer/prompts";

export async function askConfirm(message, defaultValue = true) {
  return confirm({ message, default: defaultValue });
}

export async function askSelect(message, choices) {
  return select({ message, choices });
}

export async function askInput(message, defaultValue = "") {
  return input({ message, default: defaultValue });
}

export async function askPassword(message) {
  return password({ message, mask: "*" });
}
