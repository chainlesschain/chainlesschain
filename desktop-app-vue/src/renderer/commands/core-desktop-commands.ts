import {
  desktopCommandRegistry,
  type DesktopCommandAvailabilityResolver,
  type DesktopCommandExecutionContext,
  type DesktopCommandSurface,
} from "./desktop-command-registry";

interface CoreCommandHandler {
  run: (context: DesktopCommandExecutionContext) => void | Promise<void>;
  availability?: DesktopCommandAvailabilityResolver;
}

export interface CoreDesktopCommandHandlers {
  surface: DesktopCommandSurface;
  newSession?: CoreCommandHandler;
  toggleArtifact?: CoreCommandHandler;
  openSettings?: CoreCommandHandler;
  chooseProject?: CoreCommandHandler;
}

const CORE_COMMAND_METADATA = {
  newSession: {
    id: "desktop.new-session",
    title: "新会话",
    category: "系统",
    telemetryEvent: "desktop.command.new_session",
  },
  toggleArtifact: {
    id: "desktop.toggle-artifact",
    title: "切换 Artifact 面板",
    category: "系统",
    telemetryEvent: "desktop.command.toggle_artifact",
  },
  openSettings: {
    id: "desktop.open-settings",
    title: "打开设置",
    category: "导航",
    telemetryEvent: "desktop.command.open_settings",
  },
  chooseProject: {
    id: "desktop.choose-project",
    title: "选择项目",
    category: "导航",
    telemetryEvent: "desktop.command.choose_project",
  },
} as const;

/** Register only commands that the active shell can execute for real. */
export function registerCoreDesktopCommands(
  handlers: CoreDesktopCommandHandlers,
): () => void {
  const unregisters: Array<() => void> = [];

  for (const key of Object.keys(CORE_COMMAND_METADATA) as Array<
    keyof typeof CORE_COMMAND_METADATA
  >) {
    const handler = handlers[key];
    if (!handler) {
      continue;
    }
    const metadata = CORE_COMMAND_METADATA[key];
    unregisters.push(
      desktopCommandRegistry.register({
        ...metadata,
        surfaces: [handlers.surface],
        handler: handler.run,
        availability: handler.availability,
        keywords: [metadata.title, metadata.category],
      }),
    );
  }

  return () => {
    for (const unregister of unregisters.reverse()) {
      unregister();
    }
  };
}
