/**
 * QrScannerModal component — unit tests.
 *
 * The QR-decode core (canvas/getImageData/jsQR/rAF) isn't reachable in jsdom
 * (video.readyState stays 0 so scanLoop bails before touching the canvas), so
 * these cover the testable + leak-sensitive parts: getUserMedia constraints,
 * the error path, camera enumeration, the cancel/close cleanup (tracks
 * stopped), and switching cameras.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('jsqr', () => ({ default: vi.fn(() => null) }))

import QrScannerModal from '../../src/components/QrScannerModal.vue'

const stubs = {
  'a-modal': { props: ['open'], emits: ['cancel'], template: '<div class="modal" v-if="open"><slot /></div>' },
  'a-alert': { props: ['message'], template: '<div class="alert">{{ message }}</div>' },
  'a-button': { template: '<button class="abtn" @click="$emit(\'click\')"><slot /></button>' },
  'a-select': { props: ['value'], emits: ['change'], template: '<select class="csel" @change="$emit(\'change\', $event.target.value)"><slot /></select>' },
  'a-select-option': { template: '<option><slot /></option>' },
}

let track
let getUserMedia
let enumerateDevices

function makeStream() {
  track = { stop: vi.fn(), getSettings: () => ({ deviceId: 'cam1' }) }
  return { getTracks: () => [track], getVideoTracks: () => [track] }
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  getUserMedia = vi.fn().mockResolvedValue(makeStream())
  enumerateDevices = vi.fn().mockResolvedValue([
    { kind: 'videoinput', deviceId: 'cam1', label: 'Back' },
    { kind: 'videoinput', deviceId: 'cam2', label: 'Front' },
    { kind: 'audioinput', deviceId: 'mic' },
  ])
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia, enumerateDevices },
    configurable: true,
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function openScanner() {
  const w = mount(QrScannerModal, { props: { open: false }, global: { stubs } })
  await w.setProps({ open: true })
  await flushPromises()
  return w
}

describe('QrScannerModal — start', () => {
  it('requests the environment-facing camera and enumerates devices', async () => {
    await openScanner()
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: 'environment' } })
    expect(enumerateDevices).toHaveBeenCalled()
  })

  it('shows the multi-camera selector when >1 videoinput', async () => {
    const w = await openScanner()
    expect(w.find('.csel').exists()).toBe(true)
  })

  it('surfaces a getUserMedia failure as an error alert', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('NotAllowed'))
    const w = await openScanner()
    expect(w.find('.alert').text()).toContain('NotAllowed')
  })
})

describe('QrScannerModal — cleanup', () => {
  it('cancel stops the camera tracks and emits cancel', async () => {
    const w = await openScanner()
    const cancelBtn = w.findAll('.abtn').find((b) => b.text().includes('取消'))
    await cancelBtn.trigger('click')
    expect(track.stop).toHaveBeenCalled()
    expect(w.emitted('cancel')).toBeTruthy()
  })

  it('closing the modal stops the camera tracks', async () => {
    const w = await openScanner()
    await w.setProps({ open: false })
    await flushPromises()
    expect(track.stop).toHaveBeenCalled()
  })
})

describe('QrScannerModal — switch camera', () => {
  it('changing camera restarts with an exact deviceId constraint', async () => {
    const w = await openScanner()
    getUserMedia.mockClear()
    await w.find('.csel').setValue('cam2')
    await flushPromises()
    expect(track.stop).toHaveBeenCalled() // old stream cleaned up
    expect(getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: 'cam2' } } })
  })
})
