"use strict";

const {
  CONTEXT_CENTER_STATE_KEY,
  buildContextCenter,
  normalizeContextCenterPreferences,
  updateContextCenterPreferences,
} = require("../context-center");

function contextCenterItems(vscode, projection) {
  const chips = Array.isArray(projection?.chips) ? projection.chips : [];
  return chips.map((chip) => {
    const removed = chip.status === "removed";
    const buttons = removed
      ? [
          {
            iconPath: new vscode.ThemeIcon("add"),
            tooltip: "Restore this context chip",
            action: "restore",
          },
        ]
      : [
          {
            iconPath: new vscode.ThemeIcon(chip.pinned ? "pinned" : "pin"),
            tooltip: chip.pinned ? "Unpin this chip" : "Pin this chip",
            action: chip.pinned ? "unpin" : "pin",
          },
          {
            iconPath: new vscode.ThemeIcon("close"),
            tooltip: "Remove this context chip",
            action: "remove",
          },
          ...(chip.refreshable
            ? [
                {
                  iconPath: new vscode.ThemeIcon("refresh"),
                  tooltip: "Refresh live context",
                  action: "refresh",
                },
              ]
            : []),
        ];
    const fresh = [
      chip.freshness?.state || "unknown",
      chip.freshness?.capturedAt || null,
    ]
      .filter(Boolean)
      .join(" @ ");
    return {
      label: `${chip.pinned ? "$(pinned) " : ""}${chip.label || chip.kind}`,
      description: `${chip.kind} · ${chip.status}`,
      detail:
        `source=${chip.source} · scope=${chip.scope} · freshness=${fresh} · ` +
        `tokens=${chip.allocatedTokens}/${chip.estimatedTokens} · ${chip.reason}`,
      buttons,
      chip,
    };
  });
}

async function openContextCenter(vscode, { getFacade, state }) {
  const quickPick = vscode.window.createQuickPick();
  quickPick.title = "ChainlessChain Context Center";
  quickPick.placeholder = "Select a chip to inspect its bounded content";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;
  quickPick.keepScrollPosition = true;
  quickPick.buttons = [
    {
      iconPath: new vscode.ThemeIcon("refresh"),
      tooltip: "Refresh all live context",
      action: "refresh",
    },
    {
      iconPath: new vscode.ThemeIcon("settings-gear"),
      tooltip: "Set token budget",
      action: "budget",
    },
    {
      iconPath: new vscode.ThemeIcon("discard"),
      tooltip: "Reset pins, removals, and budget",
      action: "reset",
    },
  ];

  let preferences = normalizeContextCenterPreferences(
    state?.get?.(CONTEXT_CENTER_STATE_KEY, {}) || {},
  );
  let projection = null;
  let disposed = false;

  const save = async (next) => {
    preferences = normalizeContextCenterPreferences(next);
    await state?.update?.(CONTEXT_CENTER_STATE_KEY, preferences);
  };

  const load = async (refreshedIds = []) => {
    const facade = getFacade?.();
    quickPick.busy = true;
    quickPick.enabled = false;
    try {
      if (!facade || typeof facade.getContextCandidates !== "function") {
        throw new Error("The IDE bridge is not running.");
      }
      const [candidates, metadata] = await Promise.all([
        facade.getContextCandidates(),
        typeof facade.getContextMetadata === "function"
          ? facade.getContextMetadata(null, "getContextCenter")
          : null,
      ]);
      projection = buildContextCenter({
        workspaceId: metadata?.workspaceId || null,
        candidates,
        tokenBudget: preferences.tokenBudget,
        pinnedIds: preferences.pinnedIds,
        removedIds: preferences.removedIds,
        refreshedIds,
      });
      quickPick.items = contextCenterItems(vscode, projection);
      quickPick.title =
        "ChainlessChain Context Center · " +
        `${projection.budget.allocatedTokens}/${projection.budget.limitTokens} tokens`;
      quickPick.placeholder = quickPick.items.length
        ? "Pin, remove, refresh, or select a chip to inspect its content"
        : "No live context sources are available";
    } catch (error) {
      projection = null;
      quickPick.items = [
        {
          label: "$(warning) Context Center unavailable",
          detail: error?.message || String(error),
          buttons: [],
          chip: null,
        },
      ];
    } finally {
      if (!disposed) {
        quickPick.busy = false;
        quickPick.enabled = true;
      }
    }
  };

  quickPick.onDidTriggerItemButton(async (event) => {
    const chip = event.item?.chip;
    const action = event.button?.action;
    if (!chip || !action) return;
    if (action === "refresh") {
      await load([chip.id]);
      return;
    }
    await save(updateContextCenterPreferences(preferences, action, chip.id));
    await load();
  });

  quickPick.onDidTriggerButton(async (button) => {
    if (button.action === "refresh") {
      await load();
    } else if (button.action === "reset") {
      await save(updateContextCenterPreferences(preferences, "reset"));
      await load();
    } else if (button.action === "budget") {
      const value = await vscode.window.showInputBox({
        title: "Context Center token budget",
        value: String(preferences.tokenBudget),
        prompt: "Enter a fixed budget from 0 to 32768 tokens",
        validateInput: (input) => {
          const parsed = Number(input);
          return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 32768
            ? null
            : "Use an integer from 0 to 32768";
        },
      });
      if (value == null) return;
      await save(
        updateContextCenterPreferences(preferences, "budget", Number(value)),
      );
      await load();
    }
  });

  quickPick.onDidAccept(async () => {
    const chip = quickPick.selectedItems?.[0]?.chip;
    if (!chip) return;
    const document = await vscode.workspace.openTextDocument({
      language: "json",
      content: `${JSON.stringify(chip, null, 2)}\n`,
    });
    await vscode.window.showTextDocument(document, { preview: true });
  });
  quickPick.onDidHide(() => {
    disposed = true;
    quickPick.dispose();
  });

  quickPick.show();
  await load();
  return { quickPick, getProjection: () => projection };
}

module.exports = { contextCenterItems, openContextCenter };
