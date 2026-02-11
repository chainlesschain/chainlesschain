/**
 * 媒体控制远程处理器
 *
 * 处理来自 Android 端的媒体控制命令：
 * - media.getVolume: 获取音量 (PUBLIC)
 * - media.setVolume: 设置音量 (NORMAL)
 * - media.mute: 静音 (NORMAL)
 * - media.unmute: 取消静音 (NORMAL)
 * - media.getDevices: 列出音频设备 (PUBLIC)
 * - media.playSound: 播放系统声音 (NORMAL)
 * - media.stopSound: 停止声音 (NORMAL)
 * - media.getPlaybackStatus: 获取播放状态 (PUBLIC)
 * - media.mediaControl: 媒体控制 (NORMAL)
 *
 * @module remote/handlers/media-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 媒体控制处理器类
 */
class MediaHandler {
  constructor(options = {}) {
    this.options = {
      maxVolume: 100,
      minVolume: 0,
      ...options,
    };

    logger.info("[MediaHandler] 媒体控制处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   */
  async handle(action, params, context) {
    logger.debug(`[MediaHandler] 处理命令: ${action}`);

    switch (action) {
      case "getVolume":
        return await this.getVolume(params, context);

      case "setVolume":
        return await this.setVolume(params, context);

      case "mute":
        return await this.mute(params, context);

      case "unmute":
        return await this.unmute(params, context);

      case "toggleMute":
        return await this.toggleMute(params, context);

      case "getDevices":
        return await this.getDevices(params, context);

      case "playSound":
        return await this.playSound(params, context);

      case "stopSound":
        return await this.stopSound(params, context);

      case "getPlaybackStatus":
        return await this.getPlaybackStatus(params, context);

      case "mediaControl":
        return await this.mediaControl(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取当前音量
   */
  async getVolume(params = {}, context) {
    logger.debug(`[MediaHandler] 获取音量`);

    try {
      let volume = 50;
      let muted = false;

      if (isWindows) {
        const result = await this._getWindowsVolume();
        volume = result.volume;
        muted = result.muted;
      } else if (isMac) {
        const result = await this._getMacVolume();
        volume = result.volume;
        muted = result.muted;
      } else if (isLinux) {
        const result = await this._getLinuxVolume();
        volume = result.volume;
        muted = result.muted;
      }

      return {
        success: true,
        volume,
        muted,
        platform: process.platform,
      };
    } catch (error) {
      logger.error("[MediaHandler] 获取音量失败:", error);
      throw new Error(`Failed to get volume: ${error.message}`);
    }
  }

  async _getWindowsVolume() {
    try {
      // 使用 PowerShell 获取音量
      const { stdout } = await execAsync(
        'powershell -command "(Get-AudioDevice -PlaybackVolume).Volume"',
      );
      const volume = parseInt(stdout.trim()) || 50;

      // 获取静音状态
      const { stdout: muteOut } = await execAsync(
        'powershell -command "(Get-AudioDevice -PlaybackMute)"',
      );
      const muted = muteOut.trim().toLowerCase() === "true";

      return { volume, muted };
    } catch {
      // 回退方案：使用 nircmd
      return { volume: 50, muted: false };
    }
  }

  async _getMacVolume() {
    const { stdout } = await execAsync(
      "osascript -e 'output volume of (get volume settings)'",
    );
    const volume = parseInt(stdout.trim()) || 50;

    const { stdout: muteOut } = await execAsync(
      "osascript -e 'output muted of (get volume settings)'",
    );
    const muted = muteOut.trim() === "true";

    return { volume, muted };
  }

  async _getLinuxVolume() {
    try {
      const { stdout } = await execAsync(
        "amixer get Master | grep -o '[0-9]*%' | head -1",
      );
      const volume = parseInt(stdout.replace("%", "")) || 50;

      const { stdout: muteOut } = await execAsync(
        "amixer get Master | grep -o '\\[off\\]' | head -1",
      );
      const muted = muteOut.includes("[off]");

      return { volume, muted };
    } catch {
      // 尝试 PulseAudio
      const { stdout } = await execAsync(
        "pactl get-sink-volume @DEFAULT_SINK@ | grep -o '[0-9]*%' | head -1",
      );
      const volume = parseInt(stdout.replace("%", "")) || 50;
      return { volume, muted: false };
    }
  }

  /**
   * 设置音量
   */
  async setVolume(params, context) {
    const { volume } = params;

    if (volume === undefined || volume === null) {
      throw new Error('Parameter "volume" is required');
    }

    const clampedVolume = Math.max(
      this.options.minVolume,
      Math.min(this.options.maxVolume, volume),
    );

    logger.info(`[MediaHandler] 设置音量: ${clampedVolume}%`);

    try {
      if (isWindows) {
        await this._setWindowsVolume(clampedVolume);
      } else if (isMac) {
        await execAsync(
          `osascript -e 'set volume output volume ${clampedVolume}'`,
        );
      } else if (isLinux) {
        await execAsync(`amixer set Master ${clampedVolume}%`).catch(() =>
          execAsync(`pactl set-sink-volume @DEFAULT_SINK@ ${clampedVolume}%`),
        );
      }

      return {
        success: true,
        volume: clampedVolume,
        message: `Volume set to ${clampedVolume}%`,
      };
    } catch (error) {
      logger.error("[MediaHandler] 设置音量失败:", error);
      throw new Error(`Failed to set volume: ${error.message}`);
    }
  }

  async _setWindowsVolume(volume) {
    // 使用 PowerShell 设置音量
    await execAsync(
      `powershell -command "Set-AudioDevice -PlaybackVolume ${volume}"`,
    ).catch(() => {
      // 回退：使用 nircmd
      return execAsync(
        `nircmd.exe setsysvolume ${Math.round((volume / 100) * 65535)}`,
      );
    });
  }

  /**
   * 静音
   */
  async mute(params = {}, context) {
    logger.info(`[MediaHandler] 静音`);

    try {
      if (isWindows) {
        await execAsync(
          'powershell -command "Set-AudioDevice -PlaybackMute $true"',
        ).catch(() => execAsync("nircmd.exe mutesysvolume 1"));
      } else if (isMac) {
        await execAsync("osascript -e 'set volume output muted true'");
      } else if (isLinux) {
        await execAsync("amixer set Master mute").catch(() =>
          execAsync("pactl set-sink-mute @DEFAULT_SINK@ 1"),
        );
      }

      return {
        success: true,
        muted: true,
        message: "Audio muted",
      };
    } catch (error) {
      logger.error("[MediaHandler] 静音失败:", error);
      throw new Error(`Failed to mute: ${error.message}`);
    }
  }

  /**
   * 取消静音
   */
  async unmute(params = {}, context) {
    logger.info(`[MediaHandler] 取消静音`);

    try {
      if (isWindows) {
        await execAsync(
          'powershell -command "Set-AudioDevice -PlaybackMute $false"',
        ).catch(() => execAsync("nircmd.exe mutesysvolume 0"));
      } else if (isMac) {
        await execAsync("osascript -e 'set volume output muted false'");
      } else if (isLinux) {
        await execAsync("amixer set Master unmute").catch(() =>
          execAsync("pactl set-sink-mute @DEFAULT_SINK@ 0"),
        );
      }

      return {
        success: true,
        muted: false,
        message: "Audio unmuted",
      };
    } catch (error) {
      logger.error("[MediaHandler] 取消静音失败:", error);
      throw new Error(`Failed to unmute: ${error.message}`);
    }
  }

  /**
   * 切换静音状态
   */
  async toggleMute(params = {}, context) {
    logger.info(`[MediaHandler] 切换静音`);

    try {
      const current = await this.getVolume({}, context);

      if (current.muted) {
        return await this.unmute({}, context);
      } else {
        return await this.mute({}, context);
      }
    } catch (error) {
      logger.error("[MediaHandler] 切换静音失败:", error);
      throw new Error(`Failed to toggle mute: ${error.message}`);
    }
  }

  /**
   * 获取音频设备列表
   */
  async getDevices(params = {}, context) {
    logger.debug(`[MediaHandler] 获取音频设备`);

    try {
      let devices = [];

      if (isWindows) {
        devices = await this._getWindowsDevices();
      } else if (isMac) {
        devices = await this._getMacDevices();
      } else if (isLinux) {
        devices = await this._getLinuxDevices();
      }

      return {
        success: true,
        devices,
        total: devices.length,
      };
    } catch (error) {
      logger.error("[MediaHandler] 获取音频设备失败:", error);
      throw new Error(`Failed to get devices: ${error.message}`);
    }
  }

  async _getWindowsDevices() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-AudioDevice -List | Select-Object Name,Type,Default | ConvertTo-Json"',
      );
      const devices = JSON.parse(stdout) || [];
      return Array.isArray(devices) ? devices : [devices];
    } catch {
      return [{ name: "Default Audio Device", type: "output", default: true }];
    }
  }

  async _getMacDevices() {
    try {
      const { stdout } = await execAsync(
        "system_profiler SPAudioDataType -json",
      );
      const data = JSON.parse(stdout);
      const audioData = data.SPAudioDataType?.[0]?._items || [];

      return audioData.map((d) => ({
        name: d._name,
        type: d.coreaudio_output_source ? "output" : "input",
        manufacturer: d.coreaudio_device_manufacturer,
      }));
    } catch {
      return [{ name: "Built-in Audio", type: "output" }];
    }
  }

  async _getLinuxDevices() {
    try {
      const { stdout } = await execAsync("pactl list sinks short");
      const lines = stdout.trim().split("\n");

      return lines.map((line) => {
        const parts = line.split("\t");
        return {
          id: parts[0],
          name: parts[1],
          driver: parts[2],
          format: parts[3],
          state: parts[4],
          type: "output",
        };
      });
    } catch {
      return [{ name: "Default Audio", type: "output" }];
    }
  }

  /**
   * 播放系统声音
   */
  async playSound(params, context) {
    const { sound = "default", file } = params;

    logger.info(`[MediaHandler] 播放声音: ${file || sound}`);

    try {
      if (file) {
        // 播放指定文件
        if (isWindows) {
          await execAsync(
            `powershell -command "(New-Object Media.SoundPlayer '${file}').PlaySync()"`,
          );
        } else if (isMac) {
          await execAsync(`afplay "${file}"`);
        } else if (isLinux) {
          await execAsync(`aplay "${file}" || paplay "${file}"`);
        }
      } else {
        // 播放系统声音
        if (isWindows) {
          const sounds = {
            default: "SystemDefault",
            error: "SystemHand",
            warning: "SystemExclamation",
            info: "SystemAsterisk",
            question: "SystemQuestion",
          };
          const soundName = sounds[sound] || sounds.default;
          await execAsync(
            `powershell -command "[System.Media.SystemSounds]::${soundName}.Play()"`,
          );
        } else if (isMac) {
          const sounds = {
            default: "Ping",
            error: "Basso",
            warning: "Sosumi",
            info: "Glass",
          };
          await execAsync(
            `afplay /System/Library/Sounds/${sounds[sound] || sounds.default}.aiff`,
          );
        } else if (isLinux) {
          await execAsync(
            "paplay /usr/share/sounds/freedesktop/stereo/complete.oga",
          ).catch(() =>
            execAsync("aplay /usr/share/sounds/alsa/Front_Center.wav"),
          );
        }
      }

      return {
        success: true,
        sound: file || sound,
        message: "Sound played",
      };
    } catch (error) {
      logger.error("[MediaHandler] 播放声音失败:", error);
      throw new Error(`Failed to play sound: ${error.message}`);
    }
  }

  /**
   * 停止声音
   */
  async stopSound(params = {}, context) {
    logger.info(`[MediaHandler] 停止声音`);

    // 大多数系统声音是一次性的，无法停止
    // 这里主要是作为占位符，或用于停止长时间播放的媒体

    return {
      success: true,
      message: "Stop sound requested",
    };
  }

  /**
   * 获取播放状态
   */
  async getPlaybackStatus(params = {}, context) {
    logger.debug(`[MediaHandler] 获取播放状态`);

    try {
      const status = {
        playing: false,
        title: null,
        artist: null,
        album: null,
      };

      if (isMac) {
        // 获取 macOS 媒体播放状态
        try {
          const { stdout } = await execAsync(`
            osascript -e 'tell application "Music" to if player state is playing then "playing" else "paused"'
          `);
          status.playing = stdout.trim() === "playing";

          if (status.playing) {
            const { stdout: info } = await execAsync(`
              osascript -e 'tell application "Music" to name of current track & "|" & artist of current track'
            `);
            const [title, artist] = info.trim().split("|");
            status.title = title;
            status.artist = artist;
          }
        } catch {
          // Music app not running
        }
      } else if (isLinux) {
        // 尝试使用 playerctl
        try {
          const { stdout: playerStatus } = await execAsync("playerctl status");
          status.playing = playerStatus.trim().toLowerCase() === "playing";

          if (status.playing) {
            const { stdout: metadata } = await execAsync(
              "playerctl metadata --format '{{title}}|{{artist}}|{{album}}'",
            );
            const [title, artist, album] = metadata.trim().split("|");
            status.title = title;
            status.artist = artist;
            status.album = album;
          }
        } catch {
          // playerctl not installed or no player running
        }
      }

      return {
        success: true,
        ...status,
      };
    } catch (error) {
      logger.error("[MediaHandler] 获取播放状态失败:", error);
      return {
        success: true,
        playing: false,
        error: error.message,
      };
    }
  }

  /**
   * 媒体控制（播放/暂停/上一曲/下一曲）
   */
  async mediaControl(params, context) {
    const { action: controlAction } = params;

    if (!controlAction) {
      throw new Error('Parameter "action" is required');
    }

    const validActions = [
      "play",
      "pause",
      "toggle",
      "next",
      "previous",
      "stop",
    ];
    if (!validActions.includes(controlAction)) {
      throw new Error(
        `Invalid action. Valid actions: ${validActions.join(", ")}`,
      );
    }

    logger.info(`[MediaHandler] 媒体控制: ${controlAction}`);

    try {
      if (isWindows) {
        // Windows 使用虚拟按键
        const keyMap = {
          play: "0xB3",
          pause: "0xB3",
          toggle: "0xB3",
          next: "0xB0",
          previous: "0xB1",
          stop: "0xB2",
        };
        await execAsync(
          `powershell -command "(New-Object -ComObject WScript.Shell).SendKeys([char]${keyMap[controlAction]})"`,
        );
      } else if (isMac) {
        const keyMap = {
          play: "play",
          pause: "pause",
          toggle: "playpause",
          next: "next track",
          previous: "previous track",
          stop: "stop",
        };
        await execAsync(
          `osascript -e 'tell application "Music" to ${keyMap[controlAction]}'`,
        ).catch(() => {
          // 回退到系统级媒体键
          const keyCodes = {
            toggle: "49",
            next: "55",
            previous: "54",
          };
          return execAsync(
            `osascript -e 'tell application "System Events" to key code ${keyCodes[controlAction] || 49} using {control down, shift down}'`,
          );
        });
      } else if (isLinux) {
        const actionMap = {
          play: "play",
          pause: "pause",
          toggle: "play-pause",
          next: "next",
          previous: "previous",
          stop: "stop",
        };
        await execAsync(`playerctl ${actionMap[controlAction]}`);
      }

      return {
        success: true,
        action: controlAction,
        message: `Media ${controlAction} executed`,
      };
    } catch (error) {
      logger.error(`[MediaHandler] 媒体控制失败:`, error);
      throw new Error(`Failed to execute media control: ${error.message}`);
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info("[MediaHandler] 资源已清理");
  }
}

module.exports = { MediaHandler };
