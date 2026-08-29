"use strict";

const path = require("node:path");

module.exports = async function notarizeDesktop(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }
  if (process.env.CC_REQUIRE_DESKTOP_NOTARIZATION !== "1") {
    return;
  }

  const appleId = String(process.env.APPLE_ID || "").trim();
  const appleIdPassword = String(
    process.env.APPLE_APP_SPECIFIC_PASSWORD || "",
  ).trim();
  const teamId = String(process.env.APPLE_TEAM_ID || "").trim();
  if (!appleId || !appleIdPassword || !/^[A-Z0-9]{10}$/u.test(teamId)) {
    throw new Error(
      "Desktop notarization requires APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID",
    );
  }

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const { notarize } = require("@electron/notarize");
  await notarize({
    appPath,
    appleId,
    appleIdPassword,
    teamId,
  });
};
