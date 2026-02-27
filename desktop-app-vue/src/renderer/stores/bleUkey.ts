import { defineStore } from 'pinia';

export interface BLEDevice {
  id: string;
  name: string;
  rssi: number;
  distance: number;
  paired: boolean;
  connected: boolean;
  lastSeen: number;
}

const electronAPI = (window as any).electronAPI || (window as any).electron?.ipcRenderer;
function invoke(channel: string, ...args: any[]) {
  if (electronAPI?.invoke) return electronAPI.invoke(channel, ...args);
  return Promise.reject(new Error('IPC not available'));
}

export const useBleUkeyStore = defineStore('bleUkey', {
  state: () => ({
    devices: [] as BLEDevice[],
    scanning: false,
    connectedDevice: null as BLEDevice | null,
    loading: false,
    error: null as string | null,
  }),

  getters: {
    pairedDevices: (state) => state.devices.filter(d => d.paired),
    isConnected: (state) => !!state.connectedDevice,
  },

  actions: {
    async scanDevices(timeout?: number) {
      this.scanning = true;
      this.error = null;
      try {
        const result = await invoke('ble-ukey:scan-devices', { timeout });
        if (result.success) {
          this.devices = result.devices || [];
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.scanning = false;
      }
    },

    async pairDevice(deviceId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('ble-ukey:pair-device', { deviceId });
        if (result.success) await this.scanDevices();
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async connect(deviceId: string) {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('ble-ukey:connect', { deviceId });
        if (result.success) {
          this.connectedDevice = this.devices.find(d => d.id === deviceId) || null;
        } else {
          this.error = result.error;
        }
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },

    async disconnect() {
      this.loading = true;
      this.error = null;
      try {
        const result = await invoke('ble-ukey:disconnect');
        if (result.success) this.connectedDevice = null;
        else this.error = result.error;
        return result;
      } catch (err: any) {
        this.error = err.message;
        return { success: false, error: err.message };
      } finally {
        this.loading = false;
      }
    },
  },
});
