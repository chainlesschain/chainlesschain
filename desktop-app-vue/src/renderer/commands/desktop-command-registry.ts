/**
 * Desktop command registry shared by the legacy, /v2 and /v6-preview shells.
 *
 * A surface owns the concrete handler while the registry owns discovery,
 * availability, permission preflight and telemetry semantics. Registrations
 * are stacked so a newly mounted surface can replace an implementation and
 * reliably restore the previous one when it unmounts.
 */

export type DesktopCommandSurface = "legacy" | "v2" | "v6-preview" | string;

export interface DesktopCommandAvailability {
  enabled: boolean;
  reason?: string;
}

export type DesktopCommandAvailabilityResolver = () =>
  boolean | DesktopCommandAvailability;

export interface DesktopCommandAuthorization {
  allowed: boolean;
  reason?: string;
}

export type DesktopCommandAuthorizationResolver = (
  requiredPermissions: readonly string[],
  context: DesktopCommandExecutionContext,
) =>
  | boolean
  | DesktopCommandAuthorization
  | Promise<boolean | DesktopCommandAuthorization>;

export interface DesktopCommandExecutionContext {
  source?: "palette" | "shortcut" | "menu" | "test" | string;
  args?: string;
}

export interface DesktopCommandDefinition {
  id: string;
  title: string;
  category: string;
  surfaces: readonly DesktopCommandSurface[];
  handler: (context: DesktopCommandExecutionContext) => void | Promise<void>;
  description?: string;
  shortcut?: string;
  keywords?: readonly string[];
  requiredPermissions?: readonly string[];
  availability?: DesktopCommandAvailabilityResolver;
  authorize?: DesktopCommandAuthorizationResolver;
  telemetryEvent: string;
}

export interface DesktopCommandView {
  id: string;
  title: string;
  category: string;
  description?: string;
  shortcut?: string;
  keywords: readonly string[];
  requiredPermissions: readonly string[];
  telemetryEvent: string;
  enabled: boolean;
  disabledReason?: string;
}

export interface DesktopCommandExecutionResult {
  ok: boolean;
  commandId: string;
  reason?: string;
}

interface RegisteredDesktopCommand {
  token: symbol;
  definition: DesktopCommandDefinition;
}

export const DESKTOP_COMMAND_TELEMETRY_EVENT =
  "chainlesschain:desktop-command-telemetry";

const DEFAULT_DISABLED_REASON = "当前界面暂不支持此命令";
const PERMISSION_RESOLVER_MISSING_REASON = "命令缺少权限校验器";

function normalizeAvailability(
  definition: DesktopCommandDefinition,
): DesktopCommandAvailability {
  if (
    (definition.requiredPermissions?.length ?? 0) > 0 &&
    !definition.authorize
  ) {
    return {
      enabled: false,
      reason: PERMISSION_RESOLVER_MISSING_REASON,
    };
  }

  if (!definition.availability) {
    return { enabled: true };
  }

  try {
    const value = definition.availability();
    if (typeof value === "boolean") {
      return {
        enabled: value,
        reason: value ? undefined : DEFAULT_DISABLED_REASON,
      };
    }
    return {
      enabled: value.enabled,
      reason:
        value.enabled === true
          ? undefined
          : value.reason?.trim() || DEFAULT_DISABLED_REASON,
    };
  } catch {
    return {
      enabled: false,
      reason: "命令可用性检查失败",
    };
  }
}

function normalizeAuthorization(
  value: boolean | DesktopCommandAuthorization,
): DesktopCommandAuthorization {
  if (typeof value === "boolean") {
    return {
      allowed: value,
      reason: value ? undefined : "缺少执行命令所需权限",
    };
  }
  return {
    allowed: value.allowed,
    reason:
      value.allowed === true
        ? undefined
        : value.reason?.trim() || "缺少执行命令所需权限",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DesktopCommandRegistry {
  private readonly registrations = new Map<
    string,
    RegisteredDesktopCommand[]
  >();

  private readonly listeners = new Set<() => void>();

  register(definition: DesktopCommandDefinition): () => void {
    if (!definition.id.trim()) {
      throw new Error("Desktop command id must not be empty");
    }
    if (!definition.title.trim()) {
      throw new Error(`Desktop command ${definition.id} must have a title`);
    }
    if (!definition.category.trim()) {
      throw new Error(`Desktop command ${definition.id} must have a category`);
    }
    if (definition.surfaces.length === 0) {
      throw new Error(
        `Desktop command ${definition.id} must declare a surface`,
      );
    }
    if (!definition.telemetryEvent.trim()) {
      throw new Error(
        `Desktop command ${definition.id} must declare a telemetry event`,
      );
    }

    const registration: RegisteredDesktopCommand = {
      token: Symbol(definition.id),
      definition: {
        ...definition,
        surfaces: [...definition.surfaces],
        keywords: [...(definition.keywords ?? [])],
        requiredPermissions: [...(definition.requiredPermissions ?? [])],
      },
    };
    const stack = this.registrations.get(definition.id) ?? [];
    stack.push(registration);
    this.registrations.set(definition.id, stack);
    this.notify();

    return () => {
      const current = this.registrations.get(definition.id);
      if (!current) {
        return;
      }
      const next = current.filter((item) => item.token !== registration.token);
      if (next.length === current.length) {
        return;
      }
      if (next.length === 0) {
        this.registrations.delete(definition.id);
      } else {
        this.registrations.set(definition.id, next);
      }
      this.notify();
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(surface: DesktopCommandSurface): DesktopCommandView[] {
    const commands: DesktopCommandView[] = [];
    for (const registrations of this.registrations.values()) {
      const registration = this.resolveRegistration(registrations, surface);
      if (!registration) {
        continue;
      }
      commands.push(this.toView(registration.definition));
    }
    return commands.sort(
      (left, right) =>
        left.category.localeCompare(right.category, "zh-CN") ||
        left.title.localeCompare(right.title, "zh-CN") ||
        left.id.localeCompare(right.id),
    );
  }

  async execute(
    commandId: string,
    surface: DesktopCommandSurface,
    context: DesktopCommandExecutionContext = {},
  ): Promise<DesktopCommandExecutionResult> {
    const startedAt = Date.now();
    const registration = this.resolveRegistration(
      this.registrations.get(commandId) ?? [],
      surface,
    );
    if (!registration) {
      return {
        ok: false,
        commandId,
        reason: "当前界面未注册此命令",
      };
    }

    const definition = registration.definition;
    const availability = normalizeAvailability(definition);
    if (!availability.enabled) {
      const result = {
        ok: false,
        commandId,
        reason: availability.reason ?? DEFAULT_DISABLED_REASON,
      };
      this.emitTelemetry(definition, surface, result, startedAt);
      return result;
    }

    const requiredPermissions = definition.requiredPermissions ?? [];
    if (requiredPermissions.length > 0) {
      try {
        const authorization = normalizeAuthorization(
          await definition.authorize!(requiredPermissions, context),
        );
        if (!authorization.allowed) {
          const result = {
            ok: false,
            commandId,
            reason: authorization.reason ?? "缺少执行命令所需权限",
          };
          this.emitTelemetry(definition, surface, result, startedAt);
          return result;
        }
      } catch {
        const result = {
          ok: false,
          commandId,
          reason: "权限校验失败",
        };
        this.emitTelemetry(definition, surface, result, startedAt);
        return result;
      }
    }

    try {
      await definition.handler(context);
      const result = { ok: true, commandId };
      this.emitTelemetry(definition, surface, result, startedAt);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        commandId,
        reason: errorMessage(error) || "命令执行失败",
      };
      this.emitTelemetry(definition, surface, result, startedAt);
      return result;
    }
  }

  private resolveRegistration(
    registrations: RegisteredDesktopCommand[],
    surface: DesktopCommandSurface,
  ): RegisteredDesktopCommand | undefined {
    for (let index = registrations.length - 1; index >= 0; index -= 1) {
      const registration = registrations[index];
      if (registration.definition.surfaces.includes(surface)) {
        return registration;
      }
    }
    return undefined;
  }

  private toView(definition: DesktopCommandDefinition): DesktopCommandView {
    const availability = normalizeAvailability(definition);
    return {
      id: definition.id,
      title: definition.title,
      category: definition.category,
      description: definition.description,
      shortcut: definition.shortcut,
      keywords: definition.keywords ?? [],
      requiredPermissions: definition.requiredPermissions ?? [],
      telemetryEvent: definition.telemetryEvent,
      enabled: availability.enabled,
      disabledReason: availability.reason,
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private emitTelemetry(
    definition: DesktopCommandDefinition,
    surface: DesktopCommandSurface,
    result: DesktopCommandExecutionResult,
    startedAt: number,
  ): void {
    if (
      typeof window === "undefined" ||
      typeof window.dispatchEvent !== "function" ||
      typeof CustomEvent === "undefined"
    ) {
      return;
    }
    window.dispatchEvent(
      new CustomEvent(DESKTOP_COMMAND_TELEMETRY_EVENT, {
        detail: {
          commandId: definition.id,
          telemetryEvent: definition.telemetryEvent,
          surface,
          ok: result.ok,
          reason: result.reason,
          durationMs: Math.max(0, Date.now() - startedAt),
          requiredPermissions: [...(definition.requiredPermissions ?? [])],
        },
      }),
    );
  }
}

export const desktopCommandRegistry = new DesktopCommandRegistry();
